import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const dom = new JSDOM('<!doctype html><html><body><button id="opener">报名管理</button><div id="app"></div></body></html>', { url: 'http://localhost/' });
const originals = new Map();
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
const { createRoot } = await import('react-dom/client');
const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
await mkdir(path.join(projectRoot, 'artifacts'), { recursive: true });
const scratch = await mkdtemp(path.join(projectRoot, 'artifacts', 'admin-registrations-'));
const bundlePath = path.join(scratch, 'admin.mjs');
let rpc, authCallback, currentUser, identityRead;
globalThis.__insuranceDownloads=0;
const admin = { id: 'admin-a', is_anonymous: false, app_metadata: { role: 'admin' } };
globalThis.__registrationAdminClient = { rpc: (...args) => rpc(...args), auth: { getUser: async () => identityRead ? identityRead() : ({ data: { user: currentUser } }), onAuthStateChange: callback => { authCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; } } };
const output = await build({ stdin: { contents: "export {default} from './src/applications/ActivityRegistrationAdmin.jsx';", resolveDir: projectRoot, loader: 'jsx' }, absWorkingDir: projectRoot, bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, plugins: [{ name: 'backend', setup(build) { build.onResolve({filter:/insurance-export\.js$/},()=>({path:'writer',namespace:'writer-mock'}));build.onLoad({filter:/.*/,namespace:'writer-mock'},()=>({contents:"export function downloadInsuranceWorkbook(){globalThis.__insuranceDownloads++;}",loader:'js'}));build.onResolve({filter:/PaymentProofImage\.jsx$/},()=>({path:'proof-viewer',namespace:'proof-mock'}));build.onLoad({filter:/.*/,namespace:'proof-mock'},()=>({contents:"import {createElement} from 'react';export default function Proof({proof,expectedUserId}){return createElement('div',{'data-proof-view':proof.id,'data-expected':expectedUserId},'私有缴费记录');}",loader:'js',resolveDir:projectRoot}));build.onLoad({ filter: /[/\\]backend\.js$/ }, () => ({ contents: 'export const supabase = globalThis.__registrationAdminClient;', loader: 'js' })); } }], logLevel: 'silent' });
await writeFile(bundlePath, output.outputFiles[0].text);
const { default: Component } = await import(pathToFileURL(bundlePath).href);
const container = document.getElementById('app'); let root;
const member = (id, registeredAt, extra = {}) => ({ id, userId: id, displayName: id === 'first' ? '先报名者' : '后报名者', email: `${id}@example.invalid`, createdAt: registeredAt, registeredAt, status: 'active', paymentStatus: 'unpaid', position: id === 'first' ? 1 : 2, selectionStatus: id === 'first' ? 'confirmed' : 'waitlisted', ...extra });
const state = () => ({ viewerId: 'admin-a', capacity: 1, activeCount: 2, confirmedCount: 1, waitlistCount: 1, applications: [member('second', '2026-10-31T02:00:00Z'), member('first', '2026-10-31T01:00:00Z')], events: [{ id: 'event', action: 'registered', actorId: 'first', actorLabel: '先报名者', actorType: 'member', source: 'self_service', subjectUserId: 'first', subjectLabel: '先报名者', occurredAt: '2026-10-31T01:00:00Z', details: {} }] });
async function mount(props = {}) { currentUser = admin; identityRead = null; if (root) await act(async () => root.unmount()); document.getElementById('opener').focus(); root = createRoot(container); await act(async () => root.render(createElement(Component, { activity: { id: 'activity', payload: { title: '合成活动' } }, onClose() {}, ...props }))); }
async function click(text) { const button = [...container.querySelectorAll('button')].find(item => item.textContent.includes(text)); assert.ok(button, text); await act(async () => button.click()); }
after(async () => { if (root) await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; delete globalThis.__registrationAdminClient; await unlink(bundlePath); await rmdir(scratch); });
test('roster renders registeredAt order, queue capacity and administrator-only identity', async () => { rpc = async () => ({ data: state() }); await mount(); assert.match(container.textContent, /合成活动/); const rows = [...container.querySelectorAll('tbody tr')]; assert.match(rows[0].textContent, /先报名者/); assert.match(rows[0].textContent, /first@example.invalid/); assert.match(rows[0].textContent, /1\s*\/\s*1/); assert.match(rows[1].textContent, /候补/); assert.doesNotMatch(container.textContent, /操作日志/); assert.ok(rows[0].querySelector('.payment-status-dot')); });
test('payment conflict retains the server value and offers reload; success refreshes roster and event', async () => { let changes = 0; rpc = async (name, args) => { if (name === 'get_activity_registrations') return { data: state() }; assert.deepEqual(args, { p_application_id: 'first', p_payment_status: 'paid', p_expected_payment_status: 'unpaid', p_expected_user_id: 'admin-a', p_expected_proof_id: null }); if (++changes === 1) return { error: { code: '40001', message: 'payment conflict' } }; const next = state(); next.applications[1].paymentStatus = 'paid'; next.events.push({ ...next.events[0], id: 'payment', action: 'payment_changed', actorLabel: '管理员甲', actorId: 'admin', actorType: 'admin', source: 'manual', details: { paymentStatus: { before: 'unpaid', after: 'paid' } } }); return { data: next }; }; await mount(); const select = container.querySelector('select'); await act(async () => { select.value = 'paid'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); assert.equal(select.value, 'unpaid'); assert.match(container.querySelector('[role=alert]').textContent, /重新加载/); await click('重新加载'); const reloadedSelect = container.querySelector('select'); await act(async () => { reloadedSelect.value = 'paid'; reloadedSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); assert.equal(container.querySelector('select').value, 'paid'); assert.doesNotMatch(container.textContent, /操作日志/); });
test('local draft never calls real registration RPC; dialog traps focus and restores opener', async () => { rpc = async () => { throw new Error('local draft must not fetch'); }; let closed = 0; await mount({ local: true, onClose: () => closed++ }); assert.match(container.textContent, /本地草稿/); const buttons = [...container.querySelectorAll('button:not(:disabled)')]; buttons.at(-1).focus(); await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))); assert.equal(document.activeElement, buttons[0]); await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); assert.equal(closed, 1); await act(async () => root.unmount()); root = null; assert.equal(document.activeElement.id, 'opener'); });
test('load failure offers retry and an empty roster does not invent records', async () => { rpc = async () => ({ error: { code: '42501' } }); await mount(); assert.ok(container.querySelector('[role=alert]')); rpc = async () => ({ data: { viewerId: 'admin-a', capacity: null, activeCount: 0, confirmedCount: 0, waitlistCount: 0, applications: [], events: [] } }); await click('重新加载'); assert.match(container.textContent, /暂无报名/); assert.match(container.textContent, /未设置/); assert.doesNotMatch(container.textContent, /操作日志/); });


test('initial auth subscription does not clear roster, while sign-out clears private data', async () => {
  rpc = async () => ({ data: state() }); await mount();
  await act(async () => authCallback('INITIAL_SESSION', { user: admin }));
  assert.match(container.textContent, /first@example.invalid/);
  await act(async () => authCallback('SIGNED_OUT'));
  assert.doesNotMatch(container.textContent, /first@example.invalid/);
  assert.match(container.querySelector('[role=alert]').textContent, /登录状态/);
});
test('same administrator auth events preserve the roster and open confirmation while downgrade clears both',async()=>{
 const data=state();data.applications[1]={...data.applications[1],detailsComplete:true,insuranceStatus:'uninsured'};
 rpc=async()=>({data});await mount({expectedUserId:'admin-a'});
 const select=container.querySelector('select[aria-label="先报名者的保险状态"]');
 await act(async()=>{select.value='insured';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 const confirmation=document.querySelector('dialog');assert.ok(confirmation);
 for(const event of ['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED']){
  await act(async()=>authCallback(event,{user:admin}));assert.match(container.textContent,/first@example.invalid/);assert.equal(document.querySelector('dialog'),confirmation);
 }
 await act(async()=>authCallback('TOKEN_REFRESHED',{user:{...admin,app_metadata:{role:'member'}}}));assert.doesNotMatch(container.textContent,/first@example.invalid/);assert.equal(document.querySelector('dialog'),null);
});
test('an account switch cancels an in-flight roster read and cannot restore its private rows',async()=>{
 let finish;rpc=()=>new Promise(resolve=>{finish=resolve;});await mount({expectedUserId:'admin-a'});
 await act(async()=>authCallback('SIGNED_IN',{user:{...admin,id:'admin-b'}}));
 await act(async()=>finish({data:state()}));assert.doesNotMatch(container.textContent,/first@example.invalid/);assert.match(container.textContent,/登录状态/);
});

test('pending payment does not claim success and disables other payment edits', async () => {
  let finish;
  rpc = async name => name === 'get_activity_registrations' ? { data: state() } : new Promise(resolve => { finish = resolve; });
  await mount(); const select = container.querySelector('select');
  await act(async () => { select.value = 'paid'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  assert.equal(select.value, 'unpaid'); assert.ok([...container.querySelectorAll('select')].every(item => item.disabled));
  await act(async () => finish({ error: { code: '40001' } }));
  assert.equal(select.value, 'unpaid'); assert.equal(select.disabled, false);
});

test('account switching without an auth notification cannot pay under a stale roster', async () => {
  let writes = 0; rpc = async name => { if (name !== 'get_activity_registrations') writes++; return { data: state() }; };
  await mount(); currentUser = { ...admin, id: 'admin-b' };
  const select = container.querySelector('select');
  await act(async () => { select.value = 'paid'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  assert.equal(writes, 0); assert.equal(select.value, 'unpaid'); assert.ok(container.querySelector('[role=alert]'));
});

test('pending roster offers all three labeled states and proof review without exposing a public URL', async () => {
 const data=state(); data.applications[1]={...data.applications[1],paymentStatus:'pending',currentPaymentProofId:'proof-1',paymentProofs:[{id:'proof-1',objectPath:'user/first/proof.webp',submittedAt:'2026-11-01T00:00:00Z'}]};
 rpc=async()=>({data});await mount();const select=container.querySelector('select');
 assert.deepEqual([...select.options].map(o=>o.textContent),['未缴费','应已缴费','已缴费']);assert.equal(select.value,'pending');
 assert.ok(select.classList.contains('payment-status-pending'));assert.match(container.textContent,/缴费记录/);assert.match(container.textContent,/尚未提交/);
 await click('查看缴费记录');assert.ok(container.querySelector('[data-proof-view]'));assert.equal(container.querySelector('[data-proof-view]').dataset.expected,'admin-a');
});
test('historical proofs are viewable but cannot be mistaken for the current review target',async()=>{
 const data=state();data.applications[1]={...data.applications[1],paymentStatus:'pending',currentPaymentProofId:'new-proof',paymentProofs:[{id:'new-proof',objectPath:'user/first/new.webp',submittedAt:'2026-11-01T01:00:00Z'},{id:'old-proof',objectPath:'user/first/old.webp',submittedAt:'2026-11-01T00:00:00Z'}]};
 rpc=async()=>({data});await mount();await click('查看缴费记录');
 const select=container.querySelector('select');assert.equal(select.disabled,false);
 await click('历史记录');assert.equal(select.disabled,true);assert.equal(container.querySelector('[data-proof-view]').dataset.proofView,'old-proof');assert.match(container.textContent,/切回最新记录后审核/);
 await click('最新记录');assert.equal(select.disabled,false);assert.equal(container.querySelector('[data-proof-view]').dataset.proofView,'new-proof');
 await act(async()=>authCallback('SIGNED_OUT'));assert.equal(container.querySelector('[data-proof-view]'),null);
});


test('insurance purchase requires extra confirmation and cancellation never writes',async()=>{
 const data=state();data.applications[1]={...data.applications[1],detailsComplete:true,detailsUpdatedAt:'2026-11-01T00:00:00.123456Z',insuranceStatus:'uninsured'};
 let writes=0;rpc=async(name,args)=>{if(name==='set_activity_registration_insurance'){writes++;assert.equal(args.p_expected_details_updated_at,data.applications[1].detailsUpdatedAt);return {data:{...data,applications:data.applications.map(r=>r.id==='first'?{...r,insuranceStatus:'insured'}:r)}};}return {data}};
 await mount();const select=container.querySelector('select[aria-label="先报名者的保险状态"]');assert.ok(select);
 async function choose(){await act(async()=>{select.value='insured';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});}
 await choose();assert.equal(writes,0);const child=document.querySelector('dialog');assert.ok(child);await act(async()=>[...child.querySelectorAll('button')].find(b=>b.textContent==='取消').click());assert.equal(writes,0);assert.equal(select.value,'uninsured');
 await choose();await act(async()=>[...document.querySelector('dialog').querySelectorAll('button')].find(b=>b.textContent==='确认已购买').click());assert.equal(writes,1);
});
test('cleanup only enqueues after two explicit dialogs and honors backend cleaning status',async()=>{
 const data=state();data.retention={status:'waiting',manualAllowed:true,dueAt:null,consecutiveEmptyChecks:0};let executes=0;const token={confirmationId:'token',activityId:'activity',expiresAt:new Date(Date.now()+60000).toISOString(),applicationCount:2,detailsCount:2,proofCount:3};
 rpc=async(name)=>{if(name==='prepare_activity_data_cleanup'||name==='confirm_activity_data_cleanup')return {data:token};if(name==='execute_activity_data_cleanup'){executes++;return {data:{...data,retention:{...data.retention,status:'cleaning',manualAllowed:false}}};}return {data};};
 await mount();await click('手动清理');assert.equal(executes,0);
 await act(async()=>[...document.querySelector('dialog').querySelectorAll('button')].find(b=>b.textContent==='确认范围，继续').click());assert.equal(executes,0);
 await act(async()=>[...document.querySelector('dialog').querySelectorAll('button')].find(b=>b.textContent==='永久删除活动资料及缴费图片').click());assert.equal(executes,1);assert.match(container.textContent,/正在清理/);assert.match(container.textContent,/活动资料已封存/);assert.ok([...container.querySelectorAll('select')].every(s=>s.disabled));
});

test('cleanup cancellation at either dialog does not enqueue; nested Escape never closes roster',async()=>{
 const data=state();data.retention={status:'waiting',manualAllowed:true};let stages=0,executions=0,closed=0;
 const token={confirmationId:'token',activityId:'activity',expiresAt:new Date(Date.now()+60000).toISOString(),applicationCount:2,detailsCount:2,proofCount:3};
 rpc=async(name)=>{if(name==='prepare_activity_data_cleanup')return {data:token};if(name==='confirm_activity_data_cleanup'){stages++;return {data:token};}if(name==='execute_activity_data_cleanup')executions++;return {data};};
 await mount({onClose:()=>closed++});await click('手动清理');
 await act(async()=>document.querySelector('dialog').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
 assert.equal(closed,0);assert.equal(stages,0);assert.equal(executions,0);assert.equal(document.querySelector('dialog'),null);
 await click('手动清理');await act(async()=>[...document.querySelector('dialog').querySelectorAll('button')].find(b=>b.textContent==='确认范围，继续').click());
 await act(async()=>[...document.querySelector('dialog').querySelectorAll('button')].find(b=>b.textContent==='取消').click());assert.equal(stages,1);assert.equal(executions,0);
});
test('account switch removes open cleanup confirmation and prevents stale continuation',async()=>{
 const data=state();data.retention={status:'waiting',manualAllowed:true};let confirms=0;
 const token={confirmationId:'token',activityId:'activity',expiresAt:new Date(Date.now()+60000).toISOString(),applicationCount:2,detailsCount:2,proofCount:3};
 rpc=async(name)=>{if(name==='prepare_activity_data_cleanup')return {data:token};if(name==='confirm_activity_data_cleanup')confirms++;return {data};};
 await mount();await click('手动清理');assert.ok(document.querySelector('dialog'));
 await act(async()=>authCallback('SIGNED_OUT'));assert.equal(document.querySelector('dialog'),null);assert.equal(confirms,0);
 await mount();await click('手动清理');currentUser={...admin,id:'admin-b'};
 await act(async()=>[...document.querySelector('dialog').querySelectorAll('button')].find(b=>b.textContent==='确认范围，继续').click());assert.equal(confirms,0);assert.equal(document.querySelector('dialog'),null);
});

test('activity end immediately hides an already opened proof and disables sensitive actions',async()=>{
 const data=state();data.retention={status:'waiting',manualAllowed:true,dueAt:new Date(Date.now()+180).toISOString()};data.applications[1]={...data.applications[1],currentPaymentProofId:'proof',paymentProofs:[{id:'proof',objectPath:'synthetic/path.webp',submittedAt:'2026-11-01T00:00:00Z'}]};
 rpc=async()=>({data});await mount();await click('查看缴费记录');assert.ok(container.querySelector('[data-proof-view]'));
 await act(async()=>new Promise(resolve=>setTimeout(resolve,220)));assert.ok(container.querySelector('[data-proof-view]')===null);assert.ok([...container.querySelectorAll('select')].every(s=>s.disabled));
});


test('export response arriving after end never downloads and releases returned contacts',async()=>{
 const data=state();data.retention={status:'waiting',manualAllowed:true,dueAt:new Date(Date.now()+120).toISOString()};let finish;
 const exported={viewerId:'admin-a',activityId:'activity',rows:[{applicationId:'first',realName:'Synthetic',idNumber:'110105194912310021',phone:'13800138000',insuranceStatus:'uninsured',detailsComplete:true}]};
 rpc=async(name)=>name==='export_activity_insurance'?new Promise(resolve=>{finish=resolve;}):({data});
 await mount();const before=globalThis.__insuranceDownloads;await click('导出保险');await act(async()=>new Promise(resolve=>setTimeout(resolve,160)));
 await act(async()=>finish({data:exported}));assert.equal(globalThis.__insuranceDownloads,before);assert.equal(exported.rows.length,0);assert.doesNotMatch(container.textContent,/已导出有效入选者/);
});
test('manual cleanup follows server capability after end and still requires both confirmations',async()=>{
 const data=state();data.retention={status:'waiting',manualAllowed:true,dueAt:'2020-01-01T00:00:00Z'};let executions=0;
 const token={confirmationId:'token',activityId:'activity',expiresAt:new Date(Date.now()+60000).toISOString(),applicationCount:2,detailsCount:2,proofCount:3};
 rpc=async(name)=>{if(name==='prepare_activity_data_cleanup'||name==='confirm_activity_data_cleanup')return {data:token};if(name==='execute_activity_data_cleanup'){executions++;return {data:{...data,retention:{...data.retention,status:'cleaning',manualAllowed:false}}};}return {data};};
 await mount();assert.equal([...container.querySelectorAll('button')].find(b=>b.textContent.includes('手动清理')).disabled,false);await click('手动清理');assert.equal(executions,0);
 await act(async()=>[...document.querySelector('dialog').querySelectorAll('button')].find(b=>b.textContent==='确认范围，继续').click());assert.equal(executions,0);
 await act(async()=>[...document.querySelector('dialog').querySelectorAll('button')].find(b=>b.textContent==='永久删除活动资料及缴费图片').click());assert.equal(executions,1);assert.equal([...container.querySelectorAll('button')].find(b=>b.textContent.includes('手动清理')).disabled,true);
});
test('known identity changes clear old roster and proof even without auth notification for all admin actions',async()=>{
 for(const action of ['export','payment','cleanup','insurance']){
 const data=state();data.retention={status:'waiting',manualAllowed:true};data.applications[1]={...data.applications[1],detailsComplete:true,detailsUpdatedAt:'2026-11-01T00:00:00Z',insuranceStatus:'insured',currentPaymentProofId:'proof',paymentProofs:[{id:'proof',objectPath:'synthetic/proof.webp',submittedAt:'2026-11-01T00:00:00Z'}]};
 let writes=0;rpc=async(name)=>{if(name!=='get_activity_registrations')writes++;return {data};};await mount();await click('查看缴费记录');currentUser={...admin,id:'admin-b'};
 if(action==='export')await click('导出保险');else if(action==='cleanup')await click('手动清理');else {const select=container.querySelector(action==='payment'?'select[class*=payment-status]':'select[aria-label="先报名者的保险状态"]');await act(async()=>{select.value=action==='payment'?'paid':'uninsured';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});}
 assert.equal(writes,0);assert.doesNotMatch(container.textContent,/first@example.invalid/);assert.ok(!container.querySelector('[data-proof-view]'));assert.equal(document.querySelector('dialog'),null);assert.match(container.textContent,/登录状态.*重新加载/);
 }
});
test('normal export downloads before end, but final getUser discovering switch discards file and roster',async()=>{
 for(const switched of [false,true]){
 const data=state();data.retention={status:'waiting',manualAllowed:true,dueAt:new Date(Date.now()+60000).toISOString()};let finish;
 const exported={viewerId:'admin-a',activityId:'activity',rows:[{applicationId:'first',realName:'Synthetic',idNumber:'110105194912310021',phone:'13800138000',insuranceStatus:'uninsured',detailsComplete:true}]};
 rpc=async(name)=>name==='export_activity_insurance'?new Promise(resolve=>{finish=resolve;}):({data});await mount();const before=globalThis.__insuranceDownloads;await click('导出保险');if(switched)currentUser={...admin,id:'admin-b'};
 await act(async()=>finish({data:exported}));assert.equal(globalThis.__insuranceDownloads,before+(switched?0:1));assert.equal(exported.rows.length,0);if(switched)assert.doesNotMatch(container.textContent,/first@example.invalid/);
 }
});


test('final identity verification crossing end also discards export and server cleaning blocks a completed response',async()=>{
 for(const crossing of [false,true]){
 const data=state();data.retention={status:'waiting',manualAllowed:true,dueAt:new Date(Date.now()+(crossing?140:60000)).toISOString()};let reads=0,identityReads=0,finish;
 const exported={viewerId:'admin-a',activityId:'activity',rows:[{applicationId:'first',realName:'Synthetic',idNumber:'110105194912310021',phone:'13800138000',insuranceStatus:'uninsured',detailsComplete:true}]};
 rpc=async(name)=>{if(name==='export_activity_insurance')return {data:exported};reads++;return {data:reads>1&&!crossing?{...data,retention:{...data.retention,status:'cleaning',manualAllowed:false}}:data};};
 await mount();identityRead=()=>++identityReads===1||!crossing?({data:{user:currentUser}}):new Promise(resolve=>{finish=resolve;});
 const before=globalThis.__insuranceDownloads;await click('导出保险');
 if(crossing){assert.ok(finish);await act(async()=>new Promise(resolve=>setTimeout(resolve,180)));await act(async()=>finish({data:{user:currentUser}}));}
 assert.equal(globalThis.__insuranceDownloads,before);assert.equal(exported.rows.length,0);assert.doesNotMatch(container.textContent,/已导出有效入选者/);
 }
});


test('an old pending export cannot restore private data after identity invalidation',async()=>{
 const data=state();let finish;const exported={viewerId:'admin-a',activityId:'activity',rows:[{applicationId:'first',realName:'Synthetic',idNumber:'110105194912310021',phone:'13800138000',insuranceStatus:'uninsured',detailsComplete:true}]};
 rpc=async(name)=>name==='export_activity_insurance'?new Promise(resolve=>{finish=resolve;}):({data});await mount();const before=globalThis.__insuranceDownloads;await click('导出保险');
 await act(async()=>authCallback('SIGNED_OUT'));await act(async()=>finish({data:exported}));assert.equal(globalThis.__insuranceDownloads,before);assert.equal(exported.rows.length,0);assert.doesNotMatch(container.textContent,/first@example.invalid/);assert.equal(document.querySelector('dialog'),null);
});


test('manual cleanup completed during export invalidates old contacts, then new export after reload is allowed',async()=>{
 for(const initialClearedAt of [null,'2026-11-01T00:00:00.123455Z']){
 const data=state();data.retention={status:'waiting',manualAllowed:true,dueAt:new Date(Date.now()+60000).toISOString(),clearedAt:initialClearedAt};
 const clearedAt='2026-11-01T00:00:00.123456Z';const fresh={...data,retention:{...data.retention,clearedAt},applications:data.applications.map(row=>({...row,detailsComplete:false}))};
 let finish,hasCleaned=false,exportCount=0;
 const firstExport={viewerId:'admin-a',activityId:'activity',rows:[{applicationId:'first',realName:'Synthetic',idNumber:'110105194912310021',phone:'13800138000',insuranceStatus:'uninsured',detailsComplete:true}]};
 const secondExport={viewerId:'admin-a',activityId:'activity',rows:[{applicationId:'first',realName:'Synthetic',idNumber:null,phone:null,insuranceStatus:'uninsured',detailsComplete:false}]};
 rpc=async(name)=>{if(name==='export_activity_insurance'){if(++exportCount===1)return new Promise(resolve=>{finish=resolve;});return {data:secondExport};}return {data:hasCleaned?fresh:data};};
 await mount();const before=globalThis.__insuranceDownloads;await click('导出保险');hasCleaned=true;
 await act(async()=>finish({data:firstExport}));assert.equal(globalThis.__insuranceDownloads,before);assert.equal(firstExport.rows.length,0);assert.doesNotMatch(container.textContent,/已导出有效入选者/);assert.match(container.textContent,/重新加载/);
 await click('重新加载');await click('导出保险');assert.equal(globalThis.__insuranceDownloads,before+1);assert.equal(secondExport.rows.length,0);assert.match(container.textContent,/资料缺失/);
 }
});
