import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'https://frontend.invalid/login', pretendToBeVisual: true });
const originals = new Map();
function expose(key, value) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'HTMLInputElement', 'FormData', 'File', 'Blob', 'Event', 'MouseEvent']) expose(key, key === 'window' ? dom.window : key === 'document' ? dom.window.document : key === 'navigator' ? dom.window.navigator : dom.window[key]);
expose('localStorage', dom.window.localStorage);
expose('IS_REACT_ACT_ENVIRONMENT', true);
expose('fetch', () => { throw Error('No real network requests are allowed in production-auth tests'); });
dom.window.HTMLDialogElement.prototype.showModal = function(){this.setAttribute('open','');};
dom.window.HTMLDialogElement.prototype.close = function(){this.removeAttribute('open');};
const { createRoot } = await import('react-dom/client');
const { MemoryRouter, Routes, Route } = await import('react-router-dom');
const member = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'member@example.invalid', app_metadata: {}, user_metadata: { role: 'admin' } };
const admin = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'admin@example.invalid', app_metadata: { role: 'admin' }, user_metadata: {} };
const activity = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: '合成公开活动', registrationCapacity: 5, published: true, isDemo: false, status: '报名中', registrationOpen: true, registrationStart: new Date(Date.now() - 86400000).toISOString(), registrationDeadline: new Date(Date.now() + 86400000).toISOString(), dateStart: new Date(Date.now() + 2 * 86400000).toISOString(), dateEnd: new Date(Date.now() + 3 * 86400000).toISOString() };
const controller = { session: null, verified: null, calls: [], applications: new Map(), subscribers: new Set(), signupConfirmation: true, writeError: null, insertBarrier: null };
const mockBackend = {
  auth: {
    getSession: async () => ({ data: { session: controller.session ? { user: controller.session, access_token: 'synthetic-test-token' } : null }, error: null }),
    getUser: async () => { controller.calls.push({ operation: 'getUser' }); return { data: { user: controller.verified }, error: controller.verified ? null : { name: 'AuthSessionMissingError' } }; },
    onAuthStateChange(callback) { controller.subscribers.add(callback); return { data: { subscription: { unsubscribe: () => controller.subscribers.delete(callback) } } }; },
    async signInWithPassword(credentials) { controller.calls.push({ operation: 'signIn', credentials }); controller.session = member; controller.verified = member; for (const callback of controller.subscribers) callback('SIGNED_IN', { user: member }); return { data: { user: member }, error: null }; },
    async signUp(credentials) { controller.calls.push({ operation: 'signUp', credentials }); if (controller.signupBarrier) await controller.signupBarrier; if (controller.signupConfirmation) return { data: { user: member, session: null }, error: null }; controller.session = member; controller.verified = member; return { data: { user: member, session: { user: member } }, error: null }; },
    async verifyOtp(credentials) {
      controller.calls.push({ operation: 'verifyOtp', credentials });
      const error = controller.otpError;
      const user = { ...member, email: credentials.email };
      const session = controller.otpSessionMissing ? null : { user, access_token: 'synthetic-otp-token' };
      const verified = controller.verifiedIdentityOverride === undefined ? user : controller.verifiedIdentityOverride;
      if (controller.verifyBarrier) await controller.verifyBarrier;
      if (error) return { data: { user: null, session: null }, error };
      controller.session = session?.user || null; controller.verified = verified;
      return { data: { user, session }, error: null };
    },
    async resend(credentials) {
      controller.calls.push({ operation: 'resend', credentials });
      const error = controller.resendError;
      if (controller.resendBarrier) await controller.resendBarrier;
      return { data: {}, error };
    },
  },
  async rpc(name,args) {
    const verified=controller.verified;
    if(name==='get_member_profile')return {data:{userId:verified.id,username:'合成会员',realName:'合成姓名',phone:'13800138000',updatedAt:null},error:null};
    const key=`${args.p_activity_id}:${verified?.id}`;
    const state=()=>{
      const application=controller.applications.get(key)||null;
      const active=[...controller.applications.values()].filter(row=>row.status==='active');
      return {capacity:5,activeCount:active.length,confirmedCount:Math.min(active.length,5),waitlistCount:Math.max(active.length-5,0),canWithdraw:application?.status==='active',application};
    };
    if(name==='get_activity_registration') {controller.calls.push({operation:'application-read',rpc:name,args,userId:verified?.id});return {data:state(),error:null};}
    assert.equal(name,'register_activity');
    assert.deepEqual(args,{p_activity_id:activity.id,p_expected_user_id:verified.id,p_real_name:'合成姓名',p_id_number:'11010519491231002X',p_phone:'13800138000',p_consent:true});
    controller.calls.push({operation:'application-insert',rpc:name,args});
    if(controller.insertBarrier)await controller.insertBarrier;
    if(controller.writeError)return {data:null,error:controller.writeError};
    if(!controller.applications.has(key))controller.applications.set(key,{id:crypto.randomUUID(),userId:verified.id,email:verified.email,displayName:'合成会员',createdAt:new Date().toISOString(),registeredAt:new Date().toISOString(),status:'active',paymentStatus:'unpaid',position:1,selectionStatus:'confirmed'});
    return {data:state(),error:null};
  },
  from(table) {
    if (table === 'content_items') return { select(columns) { controller.calls.push({ operation: 'content-read', columns }); return { order: async () => ({ data: [], error: null }) }; } };
    assert.equal(table, 'applications');
    return {
      select(columns) {
        const filters = {};
        const chain = { eq(key, value) { filters[key] = value; return chain; }, async maybeSingle() { controller.calls.push({ operation: 'application-read', columns, filters }); return { data: controller.applications.get(`${filters.activity_id}:${filters.user_id}`) || null, error: null }; } };
        return chain;
      },
      insert(payload) {
        controller.calls.push({ operation: 'application-insert', payload });
        return { select: () => ({ async single() {
          if (controller.insertBarrier) await controller.insertBarrier;
          if (controller.writeError) return { data: null, error: controller.writeError };
          const key = `${payload.activity_id}:${payload.user_id}`;
          if (controller.applications.has(key)) return { data: null, error: { code: '23505' } };
          const row = { id: crypto.randomUUID(), created_at: new Date().toISOString() };
          controller.applications.set(key, row);
          return { data: row, error: null };
        } }) };
      },
    };
  },
};
expose('__PRODUCTION_AUTH_BACKEND', mockBackend);
const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifactsRoot = path.join(projectRoot, 'artifacts');
await mkdir(artifactsRoot, { recursive: true });
const scratch = await mkdtemp(path.join(artifactsRoot, 'production-auth-dom-'));
const bundlePath = path.join(scratch, 'components.mjs');
let root;
after(async () => {
  if (root) await act(async () => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  assert.equal(path.dirname(scratch), artifactsRoot);
  await unlink(bundlePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(scratch);
});
const output = await build({
  stdin: { contents: "export {AdminPage,LoginPage} from './src/pages/Admin.jsx'; export {default as ActivityApplication} from './src/applications/ActivityApplication.jsx';", resolveDir: projectRoot, sourcefile: 'production-auth-dom.jsx', loader: 'jsx' },
  absWorkingDir: projectRoot, bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' },
  define: { 'import.meta.env': JSON.stringify({ PROD: true, DEV: false, MODE: 'production', VITE_CONTENT_MODE: 'preview', VITE_TERRAIN_TILE_URL: 'offline' }) }, logLevel: 'silent',
  plugins: [{ name: 'synthetic-backend-only', setup(builder) {
    builder.onResolve({ filter: /(?:^|[\\/])backend\.js$/ }, () => ({ path: 'backend', namespace: 'production-test' }));
    builder.onLoad({ filter: /^backend$/, namespace: 'production-test' }, () => ({ contents: "export const supabase=globalThis.__PRODUCTION_AUTH_BACKEND; export const isBackendConfigured=true; export const backendConfigurationError='';", loader: 'js' }));
  } }],
});
await writeFile(bundlePath, output.outputFiles[0].text, 'utf8');
const { AdminPage, LoginPage, ActivityApplication } = await import(pathToFileURL(bundlePath).href);
const container = dom.window.document.getElementById('app');
const text = node => node.textContent.replace(/\s+/g, ' ').trim();
const button = label => [...container.querySelectorAll('button')].find(node => text(node) === label);
async function click(node) { assert.ok(node); await act(async () => { node.focus(); node.click(); }); }
async function waitFor(predicate, reason) { const deadline = performance.now() + 4000; while (performance.now() < deadline) { if (predicate()) return; await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); } assert.fail(`Timed out waiting for ${reason}: ${text(container).slice(-900)}`); }
async function fill(name, value) { const input = container.querySelector(`[name="${name}"]`); assert.ok(input); await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }); }
const signupEmail = 'synthetic-new@example.invalid';
async function signup(location = '/login?mode=register', email = signupEmail) {
  await mount(location);
  await fill('email', email);
  await fill('password', 'Synthetic-test-password-123');
  await fill('confirmation', 'Synthetic-test-password-123');
  await click(button('创建账号'));
  assert.ok(container.querySelector('[name="token"]'), 'signup without a session must offer the email OTP form');
}
async function submitOtp(token = '123456') {
  await fill('token', token);
  const form = container.querySelector('[name="token"]').form;
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}
const authTab = label => [...container.querySelectorAll('.login-tabs a')].find(node => text(node) === label);
function deferred() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
async function submitRegistrationDetails(){
  await click(button('确认提交报名申请'));
  await waitFor(()=>document.querySelector('[name="phone"]')?.value==='13800138000','profile prefill');
  const id=document.querySelector('[name="idNumber"]');
  await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(id,'11010519491231002x');id.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>document.querySelector('[name="consent"]').click());
  await act(async()=>document.querySelector('.registration-details-dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
}
async function mount(location) {
  if (root) await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [location] }, createElement(Routes, null,
    createElement(Route, { path: '/login', element: createElement(LoginPage) }),
    createElement(Route, { path: '/admin/*', element: createElement(AdminPage) }),
    createElement(Route, { path: '/activities/:id', element: createElement(ActivityApplication, { activity }) }),
    createElement(Route, { path: '/', element: createElement('p', null, '已返回网站首页') }),
  ))));
}
function reset() { controller.calls = []; controller.session = null; controller.verified = null; controller.applications.clear(); controller.signupConfirmation = true; controller.writeError = null; controller.insertBarrier = null; controller.signupBarrier = null; controller.verifyBarrier = null; controller.resendBarrier = null; controller.otpError = null; controller.resendError = null; controller.otpSessionMissing = false; controller.verifiedIdentityOverride = undefined; localStorage.clear(); }

test('production auth and activity application use verified identities and real schema results', async t => {
  await t.test('preview query and user-editable metadata cannot grant production administration', async () => {
    reset(); controller.session = { ...member, app_metadata: { role: 'admin' } }; controller.verified = member;
    await mount('/admin/routes?preview=1');
    await waitFor(() => text(container).includes('当前账号没有管理权限'), 'verified authorization failure');
    assert.ok(!text(container).includes('本地设计预览'));
    assert.equal(button('新建路线'), undefined);
    assert.equal(controller.calls.filter(call => call.operation === 'content-read').length, 0);
    assert.ok(controller.calls.some(call => call.operation === 'getUser'));
  });

  await t.test('a verified administrator reads the current content_items schema without local fallback', async () => {
    reset(); controller.session = admin; controller.verified = admin;
    await mount('/admin/routes?preview=1');
    await waitFor(() => button('新建路线'), 'verified cloud administration');
    assert.ok(!text(container).includes('本地设计预览'));
    const call = controller.calls.find(item => item.operation === 'content-read');
    assert.equal(call.columns, 'id,kind,payload,published,created_at');
  });

  await t.test('email confirmation signup does not claim an authenticated session', async () => {
    reset();
    await mount('/login?mode=register');
    await fill('email', 'synthetic-new@example.invalid');
    await fill('password', 'Synthetic-test-password-123');
    await fill('confirmation', 'Synthetic-test-password-123');
    await click(button('创建账号'));
    await waitFor(() => text(container).includes('验证邮件将发送到邮箱'), 'email confirmation notice');
    assert.ok(!text(container).includes('账号已注册并登录'));
    assert.ok(container.querySelector('[name="token"]'), 'signup without a session must offer the email OTP form');
    const input = container.querySelector('[name="token"]');
    assert.equal(input.type, 'text');
    assert.equal(input.inputMode, 'numeric');
    assert.equal(input.autocomplete, 'one-time-code');
    assert.equal(input.maxLength, 6);
    assert.ok(input.pattern, 'the OTP has a browser validation pattern');
    assert.equal(new RegExp(`^(?:${input.pattern})$`).test('123456'), true);
    assert.equal(new RegExp(`^(?:${input.pattern})$`).test('12345x'), false);
    assert.equal(container.querySelectorAll('input:not([type="hidden"])').length, 1, 'only the code is editable while verifying the fixed signup email');
    assert.ok(text(container).includes(signupEmail));
    assert.ok(button('验证并登录'));
    assert.equal(controller.calls.filter(call => call.operation === 'verifyOtp').length, 0);
    assert.equal(controller.calls.find(call => call.operation === 'signUp').credentials.options.emailRedirectTo, 'https://frontend.invalid/login');
  });

  await t.test('email OTP verifies the pending email and returns only to a safe destination', async () => {
    const returnPath = `/activities/${activity.id}#application`;
    for (const destination of [returnPath, 'https://outside.invalid/steal', '//outside.invalid/steal']) {
      reset();
      await signup(`/login?mode=register&next=${encodeURIComponent(destination)}`);
      await submitOtp('012345');
      assert.deepEqual(controller.calls.find(call => call.operation === 'verifyOtp').credentials, { email: signupEmail, token: '012345', type: 'email' });
      assert.ok(controller.calls.some(call => call.operation === 'getUser'), 'the returned session must be verified before navigation');
      if (destination === returnPath) await waitFor(() => button('确认提交报名申请'), 'verified signup activity return');
      else await waitFor(() => text(container).includes('已返回网站首页'), 'safe default OTP destination');
    }
  });

  await t.test('invalid OTP formats never call the authentication service', async () => {
    reset(); await signup();
    for (const token of ['', '12345', '1234567', 'abcdef', '１２３４５６']) {
      await submitOtp(token);
      assert.equal(controller.calls.filter(call => call.operation === 'verifyOtp').length, 0, `invalid code ${JSON.stringify(token)} must stay local`);
      assert.ok(container.querySelector('[name="token"]'));
    }
    await submitOtp('654321');
    await waitFor(() => text(container).includes('已返回网站首页'), 'valid code after local format errors');
  });

  await t.test('wrong or expired email codes preserve the pending address and can be retried', async () => {
    reset(); await signup();
    for (const code of ['otp_expired', 'invalid_credentials']) {
      controller.otpError = { code, message: 'Synthetic code is invalid or expired', status: 403 };
      await submitOtp();
      assert.ok(container.querySelector('[role="alert"]'), 'verification failure must be visible');
      assert.ok(container.querySelector('[name="token"]'));
      assert.ok(text(container).includes(signupEmail));
      assert.equal(button('验证并登录').disabled, false);
      assert.ok(!text(container).includes('已返回网站首页'));
    }
    controller.otpError = null;
    await submitOtp('654321');
    await waitFor(() => text(container).includes('已返回网站首页'), 'OTP retry success');
    assert.equal(controller.calls.filter(call => call.operation === 'verifyOtp').length, 3);
  });

  await t.test('OTP success without a session or a matching verified identity never navigates', async () => {
    for (const variant of ['missing-session', 'missing-user', 'wrong-id', 'wrong-email']) {
      reset(); await signup();
      if (variant === 'missing-session') controller.otpSessionMissing = true;
      if (variant === 'missing-user') controller.verifiedIdentityOverride = null;
      if (variant === 'wrong-id') controller.verifiedIdentityOverride = { ...member, id: admin.id, email: signupEmail };
      if (variant === 'wrong-email') controller.verifiedIdentityOverride = { ...member, email: 'different@example.invalid' };
      await submitOtp();
      assert.ok(container.querySelector('[name="token"]'), `${variant} must retain verification`);
      assert.ok(container.querySelector('[role="alert"]'), `${variant} must report the unconfirmed identity`);
      assert.ok(!text(container).includes('已返回网站首页'));
      assert.equal(button('验证并登录').disabled, false);
    }
  });

  await t.test('resending uses signup email parameters and enforces cooldown including rate limits', async () => {
    reset();
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      await signup();
      const resendControl = () => [...container.querySelectorAll('button')].find(node => /重新发送验证码|秒后可重发/.test(text(node)));
      assert.ok(resendControl());
      assert.equal(resendControl().disabled, true);
      await click(resendControl());
      assert.equal(controller.calls.filter(call => call.operation === 'resend').length, 0);
      now += 61000;
      await waitFor(() => button('重新发送验证码') && !button('重新发送验证码').disabled, 'resend cooldown expiry');
      await click(button('重新发送验证码'));
      const call = controller.calls.find(call => call.operation === 'resend');
      assert.equal(call.credentials.type, 'signup');
      assert.equal(call.credentials.email, signupEmail);
      const callback = new URL(call.credentials.options.emailRedirectTo);
      assert.equal(callback.origin, 'https://frontend.invalid');
      assert.equal(callback.pathname, '/login');
      assert.equal(resendControl().disabled, true, 'successful resend starts another cooldown');
      now += 61000;
      await waitFor(() => button('重新发送验证码') && !button('重新发送验证码').disabled, 'second resend cooldown expiry');
      controller.resendError = { status: 429, code: 'over_email_send_rate_limit', message: 'Synthetic rate limit' };
      await click(button('重新发送验证码'));
      assert.equal(resendControl().disabled, true, 'the server rate limit restarts the cooldown');
      assert.ok(container.querySelector('[role="alert"]'));
      assert.equal(controller.calls.filter(call => call.operation === 'resend').length, 2);
    } finally { Date.now = realNow; }
  });

  await t.test('changing email or switching auth mode discards pending verification and credentials', async () => {
    reset(); await signup();
    await click(button('更换邮箱'));
    assert.equal(container.querySelector('[name="token"]'), null);
    assert.equal(container.querySelector('[name="email"]').value, '');
    assert.equal(container.querySelector('[name="password"]').value, '');
    assert.equal(container.querySelector('[name="confirmation"]').value, '');
    await signup();
    await click(authTab('登录'));
    assert.equal(container.querySelector('[name="token"]'), null);
    assert.ok(button('登录'));
    assert.equal(container.querySelector('[name="email"]').value, '');
    assert.equal(container.querySelector('[name="password"]').value, '');
    await click(authTab('注册'));
    assert.equal(container.querySelector('[name="token"]'), null);
    assert.ok(button('创建账号'));
  });

  await t.test('duplicate verification and late auth responses cannot replace a new stage', async () => {
    reset();
    await mount('/login?mode=register');
    await fill('email', signupEmail); await fill('password', 'Synthetic-test-password-123'); await fill('confirmation', 'Synthetic-test-password-123');
    const pendingSignup = deferred(); controller.signupBarrier = pendingSignup.promise;
    await click(button('创建账号'));
    await click(authTab('登录'));
    await act(async () => pendingSignup.release());
    assert.equal(container.querySelector('[name="token"]'), null, 'an old signup cannot reopen the verification stage');
    assert.ok(button('登录'));
    reset(); await signup();
    const pendingVerify = deferred(); controller.verifyBarrier = pendingVerify.promise;
    await submitOtp();
    await submitOtp();
    assert.equal(controller.calls.filter(call => call.operation === 'verifyOtp').length, 1);
    await click(button('更换邮箱'));
    await fill('email', 'replacement@example.invalid');
    await act(async () => pendingVerify.release());
    assert.ok(button('创建账号'), 'an old verified response cannot navigate after changing the email');
    assert.equal(container.querySelector('[name="email"]').value, 'replacement@example.invalid');
    assert.equal(container.querySelector('[name="token"]'), null);
    assert.ok(!text(container).includes('已返回网站首页'));
    reset();
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      await signup();
      now += 61000;
      await waitFor(() => button('重新发送验证码') && !button('重新发送验证码').disabled, 'resend before changing the stage');
      const pendingResend = deferred(); controller.resendBarrier = pendingResend.promise;
      controller.resendError = { status: 429, code: 'over_email_send_rate_limit' };
      await click(button('重新发送验证码'));
      assert.equal(controller.calls.filter(call => call.operation === 'resend').length, 1);
      await click(authTab('登录'));
      await act(async () => pendingResend.release());
      assert.ok(button('登录'));
      assert.equal(container.querySelector('[name="token"]'), null);
      assert.equal(container.querySelector('[role="alert"]'), null, 'a late resend failure belongs to the abandoned verification stage');
    } finally { Date.now = realNow; }
  });

  await t.test('login returns to the activity and submission waits for the application row response', async () => {
    reset();
    const returnPath = `/activities/${activity.id}#application`;
    await mount(`/login?next=${encodeURIComponent(returnPath)}`);
    await fill('email', 'member@example.invalid');
    await fill('password', 'Synthetic-test-password-123');
    await click(button('登录'));
    await waitFor(() => button('确认提交报名申请'), 'authenticated activity return');
    let release;
    controller.insertBarrier = new Promise(resolve => { release = resolve; });
    await submitRegistrationDetails();
    assert.ok(!text(container).includes('报名申请已提交'), 'an in-flight request must not simulate success');
    assert.equal(document.querySelector('.registration-details-dialog button[type="submit"]').disabled, true);
    await act(async () => release());
    await waitFor(() => text(container).includes('报名申请已提交'), 'confirmed application row');
    const insertion = controller.calls.find(call => call.operation === 'application-insert');
    assert.equal(insertion.rpc,'register_activity');
    assert.deepEqual(insertion.args,{p_activity_id:activity.id,p_expected_user_id:member.id,p_real_name:'合成姓名',p_id_number:'11010519491231002X',p_phone:'13800138000',p_consent:true});
    assert.equal(controller.calls.filter(call => call.operation === 'application-insert').length, 1);
  });

  await t.test('application permission errors are visible and never become success', async () => {
    reset(); controller.session = member; controller.verified = member; controller.writeError = { code: '42501' };
    await mount(`/activities/${activity.id}`);
    await waitFor(() => button('确认提交报名申请'), 'application form');
    await submitRegistrationDetails();
    await waitFor(() => container.querySelector('[role="alert"]'), 'application write failure');
    assert.match(text(container.querySelector('[role="alert"]')), /报名未完成/);
    assert.ok(!text(container).includes('报名申请已提交'));
    assert.equal(controller.applications.size, 0);
  });

  await t.test('switching accounts during submission never shows the prior account application as the new account result', async () => {
    reset(); controller.session = member; controller.verified = member;
    await mount(`/activities/${activity.id}`);
    await waitFor(() => button('确认提交报名申请'), 'member application form');
    let release;
    controller.insertBarrier = new Promise(resolve => { release = resolve; });
    await submitRegistrationDetails();
    await act(async () => {
      controller.session = admin; controller.verified = admin;
      for (const callback of controller.subscribers) callback('SIGNED_IN', { user: admin });
    });
    await waitFor(() => controller.calls.some(call=>call.operation==='application-read'&&call.userId===admin.id)&&button('确认提交报名申请'), 'new verified account application form');
    assert.equal(document.querySelector('.registration-details-dialog'),null);
    await act(async () => release());
    assert.ok(!text(container).includes('报名申请已提交'), 'the old account response must not become the new account success state');
    assert.ok(button('确认提交报名申请'));
    assert.equal(controller.calls.find(call=>call.operation==='application-insert').args.p_expected_user_id,member.id);
    assert.equal(controller.applications.has(`${activity.id}:${admin.id}`), false);
  });

  await t.test('anonymous identities cannot submit activity details or create an application',async()=>{
    reset();controller.session={...member,is_anonymous:true};controller.verified=controller.session;await mount(`/activities/${activity.id}`);await waitFor(()=>text(container).includes('登录后报名'),'anonymous login requirement');assert.equal(button('确认提交报名申请'),undefined);assert.equal(document.querySelector('.registration-details-dialog'),null);assert.equal(controller.calls.filter(call=>call.operation==='application-insert').length,0);
  });

  await t.test('external login return URLs are ignored', async () => {
    reset();
    await mount('/login?next=https%3A%2F%2Foutside.invalid');
    await fill('email', 'member@example.invalid');
    await fill('password', 'Synthetic-test-password-123');
    await click(button('登录'));
    await waitFor(() => text(container).includes('已返回网站首页'), 'safe default login destination');
  });
});
