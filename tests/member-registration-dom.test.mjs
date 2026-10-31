import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const dom=new JSDOM('<div id="app"></div>',{url:'https://frontend.invalid/activities/test',pretendToBeVisual:true});
for(const key of ['window','document','navigator','HTMLElement','Event','MouseEvent']) Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:key==='document'?dom.window.document:key==='navigator'?dom.window.navigator:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
globalThis.__MEMBER_PROOF_UPLOAD=async()=>{throw new Error('not configured')};
const {createRoot}=await import('react-dom/client');
const {MemoryRouter}=await import('react-router-dom');
const member={id:'member',email:'member@example.invalid'};
const app={id:'application',userId:'member',createdAt:new Date().toISOString(),registeredAt:new Date().toISOString(),status:'active',paymentStatus:'unpaid',position:10,selectionStatus:'waitlisted'};
const initial={capacity:5,activeCount:10,confirmedCount:5,waitlistCount:5,canWithdraw:true,application:app};
const controller={state:initial,user:member,subscribers:new Set(),calls:[],error:null,barrier:null};
globalThis.__MEMBER_BACKEND={auth:{getSession:async()=>({data:{session:controller.user?{user:controller.user}:null}}),getUser:async()=>({data:{user:controller.user}}),onAuthStateChange(callback){controller.subscribers.add(callback);return{data:{subscription:{unsubscribe:()=>controller.subscribers.delete(callback)}}};}},async rpc(name){controller.calls.push(name); const result=controller.state; if(controller.barrier)await controller.barrier; return{data:result,error:controller.error};}};
const project=await realpath(fileURLToPath(new URL('../',import.meta.url)));await mkdir(path.join(project,'artifacts'),{recursive:true});const scratch=await mkdtemp(path.join(project,'artifacts','member-dom-'));const bundle=path.join(scratch,'component.mjs');
await build({stdin:{contents:"export {default} from './src/applications/ActivityApplication.jsx';export {default as Sidebar} from './src/activities/ActivitySidebar.jsx'",resolveDir:project,loader:'jsx'},bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},outfile:bundle,plugins:[{name:'backend',setup(b){b.onResolve({filter:/backend\.js$/},()=>({path:'backend',namespace:'mock'}));b.onResolve({filter:/payment-proof\.js$/},()=>({path:'proof',namespace:'proof-mock'}));b.onLoad({filter:/.*/,namespace:'proof-mock'},()=>({contents:'export async function uploadPaymentProof(...args){return globalThis.__MEMBER_PROOF_UPLOAD(...args)};export async function downloadPaymentProof(){return new Blob(["private"],{type:"image/webp"})}',loader:'js'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const supabase=globalThis.__MEMBER_BACKEND;',loader:'js'}));}}]});
const {default:Component,Sidebar}=await import(pathToFileURL(bundle));let root;const container=document.getElementById('app');
const activity={id:'test',published:true,registrationCapacity:5,registrationOpen:true,registrationStart:new Date(Date.now()-86400000).toISOString(),registrationDeadline:new Date(Date.now()+86400000).toISOString(),dateStart:new Date(Date.now()+172800000).toISOString(),dateEnd:new Date(Date.now()+259200000).toISOString(),paymentInstructions:'请使用活动通知中的渠道缴费'};
const text=()=>container.textContent;const button=label=>[...container.querySelectorAll('button')].find(n=>n.textContent===label);
async function wait(predicate){for(let i=0;i<100;i++){if(predicate())return;await act(async()=>new Promise(r=>setTimeout(r,10)));}assert.fail(text());}
async function mount(overrides={},children,viewer=member,MountedComponent=Component){if(root)await act(async()=>root.unmount());root=createRoot(container);controller.error=null;controller.calls=[];controller.user=viewer;controller.barrier=null;await act(async()=>root.render(createElement(MemoryRouter,null,createElement(MountedComponent,{activity:{...activity,...overrides}},children))));await wait(()=>!text().includes('正在确认'));}
async function click(label){assert.ok(button(label),text());await act(async()=>button(label).click());}
after(async()=>{if(root)await act(async()=>root.unmount());dom.window.close();assert.equal(path.dirname(scratch),path.join(project,'artifacts'));await rm(scratch,{recursive:true});});
test('member sees waitlist rank without payment request, and can withdraw/rejoin',async()=>{
 controller.state=initial;await mount();assert.match(text(),/10\s*\/\s*5/);assert.match(text(),/候补/);assert.doesNotMatch(text(),/请使用活动通知中的渠道缴费/);
 controller.state={...initial,application:{...app,status:'withdrawn',position:null,selectionStatus:'withdrawn',paymentStatus:'paid'}};await click('退出本次报名');await wait(()=>text().includes('已退出'));assert.match(text(),/已缴费/);assert.ok(button('重新报名'));
 controller.state={...initial,application:{...app,position:11}};await click('重新报名');await wait(()=>text().includes('11/5'));assert.ok(controller.calls.includes('register_activity'));
});
test('confirmed unpaid members receive activity instructions, paid members do not',async()=>{
 controller.state={...initial,application:{...app,position:2,selectionStatus:'confirmed'}};await mount();assert.match(text(),/入选/);assert.match(text(),/请使用活动通知中的渠道缴费/);
 controller.state={...controller.state,application:{...controller.state.application,paymentStatus:'paid'}};await mount();assert.match(text(),/已缴费/);assert.doesNotMatch(text(),/请使用活动通知中的渠道缴费/);
});
test('legacy capacity preserves personal record and blocks new registration',async()=>{
 controller.state={...initial,capacity:null,application:{...app,selectionStatus:'unconfirmed',position:null}};await mount({registrationCapacity:undefined});assert.match(text(),/名额尚未确认/);assert.equal(button('确认提交报名申请'),undefined);
});
test('server refusal keeps existing state and offers retry without internal details',async()=>{
 controller.state=initial;await mount();controller.error={message:'private secret'};await click('退出本次报名');await wait(()=>container.querySelector('[role="alert"]'));assert.doesNotMatch(text(),/private secret/);assert.ok(button('重新检查'));assert.match(text(),/10\/5/);
});
test('an account change invalidates in-flight state and mutation results',async()=>{
 controller.state=initial;await mount();let release;controller.barrier=new Promise(resolve=>{release=resolve});const pending=click('退出本次报名');await pending;
 await act(async()=>{controller.user=null;for(const callback of controller.subscribers)callback('SIGNED_OUT');release();});await wait(()=>text().includes('登录后报名'));assert.doesNotMatch(text(),/10\/5/);
});


const splitView=({summary,details,actions,shortLabel,detailsLabel})=>createElement('div',{'data-panel':'true'},
 createElement('div',{'data-slot':'summary'},summary),createElement('div',{'data-slot':'details'},details),
 createElement('footer',{'data-slot':'actions'},actions),createElement('span',{'data-slot':'short-label'},shortLabel),createElement('span',{'data-slot':'details-label'},detailsLabel));
const slot=name=>container.querySelector(`[data-slot="${name}"]`);
test('sidebar slots keep a single registration source and working withdrawal/rejoin',async()=>{
 controller.state=initial;await mount({},splitView);
 assert.ok(slot('summary'),'sidebar presentation should receive registration slots');
 assert.match(slot('summary').textContent,/10\/5/);assert.match(slot('short-label').textContent,/候补.*10\/5/);
 assert.equal(controller.subscribers.size,1);assert.equal(controller.calls.filter(x=>x==='get_activity_registration').length,1);
 assert.ok(slot('actions').querySelector('button'));assert.doesNotMatch(slot('actions').textContent,/按报名顺序候补/);
 controller.state={...initial,application:{...app,status:'withdrawn',position:null,selectionStatus:'withdrawn'}};
 await click('退出本次报名');await wait(()=>slot('summary').textContent.includes('已退出'));
 assert.ok(slot('actions').querySelector('form'));assert.ok(button('重新报名'));
 controller.state={...initial,application:{...app,position:11}};await click('重新报名');await wait(()=>slot('summary').textContent.includes('11/5'));
 assert.equal(controller.subscribers.size,1);
});
test('sidebar keeps long payment instructions in details, with correct candidate and paid states',async()=>{
 controller.state={...initial,application:{...app,position:2,selectionStatus:'confirmed'}};
 const longText='这是正式活动的缴费通知。'.repeat(70);await mount({paymentInstructions:longText},splitView);
 assert.match(slot('summary').textContent,/2\/5/);assert.ok(slot('details').textContent.includes(longText));
 assert.equal(slot('details-label').textContent,'');assert.ok(button('缴费'));assert.ok(!slot('summary').textContent.includes(longText));assert.ok(!slot('actions').textContent.includes(longText));
 controller.state=initial;await mount({paymentInstructions:longText},splitView);assert.ok(!slot('details').textContent.includes(longText));
 controller.state={...initial,application:{...app,selectionStatus:'confirmed',paymentStatus:'paid'}};
 await mount({paymentInstructions:longText},splitView);assert.ok(!slot('details').textContent.includes(longText));assert.match(slot('summary').textContent,/已缴费/);
});
test('sidebar auth changes clear the previous account summary and expose the login return anchor',async()=>{
 controller.state=initial;await mount({},splitView);assert.match(slot('short-label').textContent,/10\/5/);
 await act(async()=>{controller.user=null;for(const callback of controller.subscribers)callback('SIGNED_OUT');});
 await wait(()=>slot('actions')?.textContent.includes('登录后报名'));
 assert.doesNotMatch(slot('summary').textContent,/10\/5/);assert.doesNotMatch(slot('short-label').textContent,/10\/5/);
 const login=slot('actions').querySelector('a');assert.equal(new URL(login.href).searchParams.get('next'),'/activities/test#application');
});


test('sidebar preserves withdrawal after registration closes, but cannot rejoin outside the window',async()=>{
 controller.state=initial;const closed={registrationDeadline:new Date(Date.now()-1000).toISOString()};await mount(closed,splitView);
 assert.ok(button('退出本次报名'));
 controller.state={...initial,application:{...app,status:'withdrawn',position:null,selectionStatus:'withdrawn'}};
 await click('退出本次报名');await wait(()=>slot('summary').textContent.includes('已退出'));
 assert.equal(button('重新报名'),undefined);assert.match(slot('details').textContent,/截止|结束|关闭/);
});
test('sidebar refresh hides stale rank and disables operations until the verified response arrives',async()=>{
 controller.state=initial;await mount({},splitView);let release;controller.barrier=new Promise(resolve=>{release=resolve});
 await click('刷新报名状态');await wait(()=>slot('summary').textContent.includes('正在确认'));
 assert.doesNotMatch(slot('summary').textContent,/10\/5/);assert.equal(button('退出本次报名'),undefined);
 await act(async()=>release());await wait(()=>slot('summary').textContent.includes('10/5'));assert.ok(button('退出本次报名'));
});


test('real activity sidebar changes tabs without remounting registration or resetting mutations',async()=>{
 controller.state=initial;await mount({},undefined,member,Sidebar);
 const tabs=()=>[...container.querySelectorAll('[role="tab"]')];
 assert.match(container.querySelector('.activity-sidebar-footer').textContent,/10\/5/);
 await act(async()=>tabs()[1].click());await act(async()=>tabs()[0].click());
 assert.equal(controller.subscribers.size,1);assert.equal(controller.calls.filter(x=>x==='get_activity_registration').length,1);
 controller.state={...initial,application:{...app,status:'withdrawn',position:null,selectionStatus:'withdrawn'}};
 await click('退出本次报名');await wait(()=>container.querySelector('.activity-sidebar-footer').textContent.includes('已退出'));
 await click('查看报名详情');assert.equal(tabs()[1].getAttribute('aria-selected'),'true');assert.match(container.querySelector('[role="tabpanel"]:not([hidden])').textContent,/退出记录/);
 assert.equal(container.querySelectorAll('#application').length,1);assert.ok(button('重新报名'));
});


test('confirmed members use the global QR and only become pending after proof submission succeeds',async()=>{
 const proof={id:'00000000-0000-4000-8000-000000000001',objectPath:'00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000003/00000000-0000-4000-8000-000000000004.webp',submittedAt:'2026-11-01T00:00:00Z'};
 const confirmed={...initial,canSubmitPaymentProof:true,paymentQrUrl:'https://project.supabase.co/global-qr.webp',application:{...app,position:2,selectionStatus:'confirmed',paymentProofs:[],currentPaymentProofId:null}};
 controller.state=confirmed;await mount({paymentQrUrl:'https://wrong.invalid/per-activity.webp'},splitView);
 assert.ok(button('缴费'));await click('缴费');
 const modalButton=label=>[...document.querySelectorAll('.payment-dialog button')].find(b=>b.textContent.trim()===label);
 assert.equal(document.querySelector('img[alt="微信收款二维码"]').getAttribute('src'),confirmed.paymentQrUrl);
 await act(async()=>modalButton('我已缴费').click());
 const file=new File(['receipt'],'receipt.png',{type:'image/png'});const input=document.querySelector('.payment-dialog input[type="file"]');Object.defineProperty(input,'files',{configurable:true,value:[file]});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 let release;const pending=new Promise(r=>release=r);let captured;
 globalThis.__MEMBER_PROOF_UPLOAD=async(client,selected,options)=>{captured={selected,options};await pending;return{...confirmed,canSubmitPaymentProof:false,application:{...confirmed.application,paymentStatus:'pending',currentPaymentProofId:proof.id,paymentProofs:[proof]}};};
 await act(async()=>modalButton('提交缴费记录').click());assert.match(slot('summary').textContent,/未缴费/);
 await act(async()=>release());await wait(()=>slot('summary').textContent.includes('应已缴费'));
 assert.ok(slot('summary').querySelector('.payment-status-pending'));assert.equal(document.querySelector('.payment-dialog'),null);assert.equal(button('缴费'),undefined);assert.match(slot('details').textContent,/等待管理员核实/);
 assert.equal(captured.selected,file);assert.equal(captured.options.expectedUserId,member.id);assert.equal(captured.options.expectedProofId,null);
});
test('candidate and already paid members have no pay/upload entry',async()=>{
 controller.state={...initial,canSubmitPaymentProof:false};await mount({},splitView);assert.equal(button('缴费'),undefined);
 controller.state={...initial,canSubmitPaymentProof:false,application:{...app,selectionStatus:'confirmed',paymentStatus:'paid'}};await mount({},splitView);assert.equal(button('缴费'),undefined);assert.ok(slot('summary').querySelector('.payment-status-paid'));
});


test('failed proof submission stays unpaid and reuses the staged private object on retry',async()=>{
 const proof={id:'00000000-0000-4000-8000-000000000001',objectPath:'00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000003/00000000-0000-4000-8000-000000000004.webp',submittedAt:'2026-11-01T00:00:00Z'};
 const confirmed={...initial,canSubmitPaymentProof:true,application:{...app,selectionStatus:'confirmed',paymentProofs:[],currentPaymentProofId:null}};controller.state=confirmed;await mount({},splitView);await click('缴费');
 const modalButton=label=>[...document.querySelectorAll('.payment-dialog button')].find(b=>b.textContent.trim()===label);
 await act(async()=>modalButton('我已缴费').click());const input=document.querySelector('.payment-dialog input[type="file"]');Object.defineProperty(input,'files',{configurable:true,value:[new File(['receipt'],'receipt.png',{type:'image/png'})]});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 globalThis.__MEMBER_PROOF_UPLOAD=async()=>{const error=new Error('暂时无法确认提交');error.stagedPath=proof.objectPath;throw error;};
 await act(async()=>modalButton('提交缴费记录').click());assert.match(slot('summary').textContent,/未缴费/);assert.ok(document.querySelector('.payment-dialog [role="alert"]'));
 let path;globalThis.__MEMBER_PROOF_UPLOAD=async(_client,_file,options)=>{path=options.stagedPath;return{...confirmed,canSubmitPaymentProof:false,application:{...confirmed.application,paymentStatus:'pending',paymentProofs:[proof],currentPaymentProofId:proof.id}};};
 await act(async()=>modalButton('提交缴费记录').click());await wait(()=>slot('summary').textContent.includes('应已缴费'));assert.equal(path,proof.objectPath);
});
test('signing out during proof submission clears the popup and ignores a late payment state',async()=>{
 const confirmed={...initial,canSubmitPaymentProof:true,application:{...app,selectionStatus:'confirmed',paymentProofs:[]}};controller.state=confirmed;await mount({},splitView);await click('缴费');
 const modalButton=label=>[...document.querySelectorAll('.payment-dialog button')].find(b=>b.textContent.trim()===label);
 await act(async()=>modalButton('我已缴费').click());const input=document.querySelector('.payment-dialog input[type="file"]');Object.defineProperty(input,'files',{configurable:true,value:[new File(['receipt'],'receipt.png',{type:'image/png'})]});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 let release;globalThis.__MEMBER_PROOF_UPLOAD=()=>new Promise(resolve=>release=resolve);await act(async()=>modalButton('提交缴费记录').click());
 await act(async()=>{controller.user=null;for(const callback of [...controller.subscribers])callback('SIGNED_OUT');release({...confirmed,application:{...confirmed.application,paymentStatus:'pending'}});});
 await wait(()=>slot('actions').textContent.includes('登录后报名'));assert.equal(document.querySelector('.payment-dialog'),null);assert.doesNotMatch(slot('summary').textContent,/应已缴费/);
});


test('an administrator-set pending status without a receipt never claims that an image was submitted',async()=>{
 controller.state={...initial,canSubmitPaymentProof:false,application:{...app,selectionStatus:'confirmed',paymentStatus:'pending',paymentProofs:[]}};await mount({},splitView);
 assert.match(slot('summary').textContent,/应已缴费/);assert.doesNotMatch(slot('details').textContent,/缴费记录已提交/);assert.match(slot('details').textContent,/缴费状态待管理员核实/);assert.equal(button('缴费'),undefined);
});
