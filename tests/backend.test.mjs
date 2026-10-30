import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolvePublicBackendConfiguration,
  supabase,
  isBackendConfigured,
} from '../src/backend.js';

// Synthetic values only. These keys do not identify a real project or user.
const projectUrl = 'https://example.supabase.co';
const publishableKey = 'sb_publishable_local_test-only';
const configuration = (url = projectUrl, key = publishableKey) => ({
  VITE_SUPABASE_URL: url,
  VITE_SUPABASE_PUBLISHABLE_KEY: key,
});
const jwt = payload => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify(payload)).toString('base64url'),
  'synthetic-signature',
].join('.');

test('Node import without Vite configuration leaves the backend disconnected', () => {
  assert.equal(supabase, null);
  assert.equal(isBackendConfigured, false);
});

for (const [name, value] of [
  ['omitted environment', undefined],
  ['empty environment', {}],
  ['URL without a key', { VITE_SUPABASE_URL: projectUrl }],
  ['key without a URL', { VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey }],
  ['blank values', configuration('  ', '\t')],
]) {
  test(`${name} returns an unconfigured result without throwing`, () => {
    let result;
    assert.doesNotThrow(() => { result = resolvePublicBackendConfiguration(value); });
    assert.equal(result.configured, false);
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0);
  });
}

test('HTTPS with a publishable key is accepted and surrounding whitespace is removed', () => {
  const result = resolvePublicBackendConfiguration(configuration(`  ${projectUrl}  `, `\t${publishableKey} `));
  assert.deepEqual(result, { configured: true, url: projectUrl, key: publishableKey, error: '' });
});

test('a legacy anon JWT is accepted as a public key configuration', () => {
  // This checks key classification only; Auth and RLS still validate real requests.
  const key = jwt({ role: 'anon', iss: 'supabase', ref: 'synthetic' });
  const result = resolvePublicBackendConfiguration(configuration(projectUrl, key));
  assert.equal(result.configured, true);
  assert.equal(result.key, key);
});

for (const [name, key] of [
  ['a secret key', 'sb_secret_synthetic-sensitive-key'],
  ['a service_role JWT', jwt({ role: 'service_role' })],
  ['an authenticated-user JWT', jwt({ role: 'authenticated' })],
  ['an administrator JWT', jwt({ role: 'admin' })],
  ['a role-less JWT', jwt({ iss: 'supabase' })],
  ['a null JWT payload', jwt(null)],
  ['an empty publishable key', 'sb_publishable_'],
  ['a publishable key containing spaces', 'sb_publishable_invalid key'],
  ['an unrecognized key', 'not-a-public-key'],
  ['a JWT with invalid base64', 'e30.!!!.signature'],
  ['a JWT with non-JSON payload', 'e30.bm90LWpzb24.signature'],
  ['a truncated JWT', 'e30.e30'],
]) {
  test(`${name} is rejected without throwing or returning the supplied key`, () => {
    let result;
    assert.doesNotThrow(() => { result = resolvePublicBackendConfiguration(configuration(projectUrl, key)); });
    assert.equal(result.configured, false);
    assert.equal(result.key, undefined);
    assert.equal(typeof result.error, 'string');
    assert.ok(!result.error.includes(key));
  });
}

for (const [name, url] of [
  ['public HTTP', 'http://example.supabase.co'],
  ['an FTP URL', 'ftp://example.supabase.co'],
  ['a URL username and password', 'https://username:password@example.supabase.co'],
  ['a URL username alone', 'https://username@example.supabase.co'],
  ['a URL password alone', 'https://:password@example.supabase.co'],
  ['a malformed URL', 'not-a-url'],
  ['an incomplete HTTPS URL', 'https://'],
]) {
  test(`${name} is rejected without throwing or exposing credentials`, () => {
    let result;
    assert.doesNotThrow(() => { result = resolvePublicBackendConfiguration(configuration(url)); });
    assert.equal(result.configured, false);
    assert.equal(result.key, undefined);
    assert.equal(result.url, undefined);
    assert.ok(!result.error.includes('username'));
    assert.ok(!result.error.includes('password'));
  });
}

for (const url of ['http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321']) {
  test(`local Supabase development retains the explicit HTTP exception for ${url}`, () => {
    assert.equal(resolvePublicBackendConfiguration(configuration(url)).configured, true);
  });
}
