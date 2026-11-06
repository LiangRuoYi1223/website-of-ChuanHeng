import assert from 'node:assert/strict';
import {test} from 'node:test';
import {selectFeaturedRoutes} from '../src/tracks/featured-routes.js';

test('featured routes retain published selections in catalog order without creating or altering records', () => {
  const first = Object.freeze({id: 'selected-z', title: '后字母但先发布', published: true, featured: true});
  const last = Object.freeze({id: 'selected-a', title: '先字母但后发布', published: true, featured: true});
  const input = Object.freeze([first, {id: 'not-selected', title: '普通路线', published: true}, last]);
  const selected = selectFeaturedRoutes(input);
  assert.deepEqual(selected.map(row => row.id), ['selected-z', 'selected-a']);
  assert.equal(selected[0], first);
  assert.equal(selected[1], last);
  assert.equal(input.length, 3);
});

test('featured routes require explicit boolean publication and selection', () => {
  const base = {id: 'test-route', title: '合成路线', published: true, featured: true};
  for (const [field, values] of [['published', [undefined, false, 'true', 1]], ['featured', [undefined, false, 'true', 1]]]) {
    for (const value of values) assert.deepEqual(selectFeaturedRoutes([{...base, [field]: value}]), [], `${field}=${String(value)} is not an explicit selection`);
  }
  assert.deepEqual(selectFeaturedRoutes(), []);
});

test('featured routes exclude illustrative, browser-only and archived records even when both flags are true', () => {
  const base = {id: 'test-route', title: '合成路线', published: true, featured: true};
  for (const field of ['isDemo', 'localDraft', 'archived']) {
    assert.deepEqual(selectFeaturedRoutes([{...base, [field]: true}]), [], `${field} cannot become a featured association route`);
  }
});

test('featured routes discard absent or malformed identifiers and titles before the page links to them', () => {
  const base = {id: 'test-route', title: '合成路线', published: true, featured: true};
  for (const field of ['id', 'title']) {
    for (const value of [undefined, null, '', '   ', 1, {}]) assert.deepEqual(selectFeaturedRoutes([{...base, [field]: value}]), [], `${field} must be usable text`);
  }
  assert.deepEqual(selectFeaturedRoutes([null, undefined]), []);
});
