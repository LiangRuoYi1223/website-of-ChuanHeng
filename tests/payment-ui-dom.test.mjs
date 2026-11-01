import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {act,createElement} from 'react';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {mkdir,mkdtemp,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const dom=new JSDOM('<button id="opener">缴费</button><div id="app"></div>',{url:'https://frontend.invalid',pretendToBeVisual:true});
for(const key of ['window','document','navigator','HTMLElement','Event','MouseEvent','KeyboardEvent'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:key==='document'?dom.window.document:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
let urls=0;const revoked=[];const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
URL.createObjectURL=()=>`blob:private-${++urls}`;URL.revokeObjectURL=url=>revoked.push(url);
const model={listeners:new Set(),downloads:0,load:async()=>new Blob(['private'],{type:'image/webp'}),user:null,registrations:new Map()};
globalThis.__PAYMENT_UI_MODEL=model;
const project=await realpath(fileURLToPath(new URL('../',import.meta.url)));await mkdir(path.join(project,'artifacts'),{recursive:true});const scratch=await mkdtemp(path.join(project,'artifacts','payment-ui-'));const out=path.join(scratch,'component.mjs');
await build({stdin:{contents:"export {default as Dialog} from './src/payments/PaymentDialog.jsx';export {default as Proof} from './src/payments/PaymentProofImage.jsx';export {default as Application} from './src/applications/ActivityApplication.jsx';",resolveDir:project,loader:'jsx'},bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',loader:{'.css':'empty'},outfile:out,plugins:[{name:'private-fixture',setup(b){b.onResolve({filter:/backend\.js$/},()=>({path:'backend',namespace:'fixture'}));b.onResolve({filter:/payment-proof\.js$/},()=>({path:'download',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='backend'?`const model=globalThis.__PAYMENT_UI_MODEL;export const supabase={auth:{async getSession(){return{data:{session:model.user?{user:model.user}:null}}},async getUser(){return{data:{user:model.user}}},onAuthStateChange(fn){model.listeners.add(fn);return{data:{subscription:{unsubscribe(){model.listeners.delete(fn)}}}}}},async rpc(name,args){if(name!=='get_activity_registration')throw new Error('Unexpected mutation: '+name);return{data:model.registrations.get(args.p_activity_id)}}};`:
"export async function downloadPaymentProof(...args){globalThis.__PAYMENT_UI_MODEL.downloads++;return globalThis.__PAYMENT_UI_MODEL.load(...args);}export async function uploadPaymentProof(){throw new Error('Unexpected proof upload');}",loader:'js'}));}}]});
const {Dialog,Proof,Application}=await import(pathToFileURL(out));const {createRoot}=await import('react-dom/client');const {MemoryRouter}=await import('react-router-dom');let root;const container=document.getElementById('app');
async function mount(C,props){if(root)await act(async()=>root.unmount());root=createRoot(container);await act(async()=>root.render(createElement(C,props)));}
const button=label=>[...document.querySelectorAll('#app button, .payment-dialog button')].find(b=>b.textContent.trim()===label);
async function click(label){assert.ok(button(label),document.body.textContent);await act(async()=>button(label).click());}
after(async()=>{if(root)await act(async()=>root.unmount());URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;dom.window.close();await rm(scratch,{recursive:true});});
test('payment popup uses supplied QR, exact name instruction and requires an image after self-report',async()=>{
 const sent=[];await mount(Dialog,{open:true,qrUrl:'https://project.supabase.co/storage/v1/object/public/activity-covers/a/qr.webp',onClose(){},onSubmit:async file=>sent.push(file)});
 assert.match(document.body.textContent,/付款时请备注姓名/);assert.equal(document.querySelector('img[alt="微信收款二维码"]').getAttribute('src'),'https://project.supabase.co/storage/v1/object/public/activity-covers/a/qr.webp');
 await click('我已缴费');assert.equal(button('提交缴费记录').disabled,true);
 const input=document.querySelector('input[type="file"]');const file=new File(['receipt'],'receipt.png',{type:'image/png'});
 Object.defineProperty(input,'files',{configurable:true,value:[file]});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 assert.equal(button('提交缴费记录').disabled,false);await click('提交缴费记录');assert.deepEqual(sent,[file]);
});
test('missing QR is explicit and an invalid proof never reaches submission',async()=>{
 let count=0;await mount(Dialog,{open:true,qrUrl:'',onClose(){},onSubmit:async()=>count++});
 assert.match(document.body.textContent,/尚未.*收款码|收款码.*尚未/);assert.equal(document.querySelector('img[alt="微信收款二维码"]'),null);
 await click('我已缴费');const input=document.querySelector('input[type="file"]');Object.defineProperty(input,'files',{configurable:true,value:[new File(['bad'],'file.svg',{type:'image/svg+xml'})]});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 assert.ok(document.querySelector('[role="alert"]'));assert.equal(button('提交缴费记录').disabled,true);assert.equal(count,0);
});

for(const [feeCents,expected] of [[undefined,'未公布'],[0,'免费'],[1250,'¥12.50']]){
 test(`payment popup shows the configured registration fee ${String(feeCents)} in both steps`,async()=>{
  await mount(Dialog,{open:true,feeCents,onClose(){},onSubmit:async()=>{}});
  const popup=document.querySelector('.payment-dialog');
  assert.match(popup.textContent,/报名费用/);assert.ok(popup.textContent.includes(expected),popup.textContent);
  await click('我已缴费');
  assert.ok(popup.textContent.includes(expected),popup.textContent);
 });
}

test('updating fee props replaces the amount in an already open payment popup',async()=>{
 const props={open:true,feeCents:1250,onClose(){},onSubmit:async()=>{}};await mount(Dialog,props);
 assert.match(document.querySelector('.payment-dialog').textContent,/¥12\.50/);
 await act(async()=>root.render(createElement(Dialog,{...props,feeCents:0})));
 assert.match(document.querySelector('.payment-dialog').textContent,/免费/);assert.equal(document.body.textContent.includes('¥12.50'),false);
 await act(async()=>root.render(createElement(Dialog,{...props,feeCents:undefined})));
 assert.match(document.querySelector('.payment-dialog').textContent,/未公布/);assert.equal(document.body.textContent.includes('免费'),false);
});

const future=days=>new Date(Date.now()+days*86400000).toISOString();
const event=overrides=>({id:'registration-fee',published:true,registrationOpen:true,registrationCapacity:2,registrationStart:future(-1),registrationDeadline:future(1),dateStart:future(2),dateEnd:future(3),...overrides});
const registered=(selectionStatus='confirmed')=>({capacity:2,activeCount:3,confirmedCount:2,waitlistCount:1,canWithdraw:true,canSubmitPaymentProof:selectionStatus==='confirmed',paymentQrUrl:'https://project.supabase.co/global-qr.webp',application:{id:'application',userId:'member',status:'active',selectionStatus,position:selectionStatus==='confirmed'?1:3,paymentStatus:'unpaid',paymentProofs:[],currentPaymentProofId:null,insuranceStatus:'uninsured',detailsComplete:true}});
async function mountApplication(activity){await mount(MemoryRouter,{children:createElement(Application,{activity})});}

test('the registration area shows its fee before login and for a waitlisted member',async()=>{
 model.user=null;await mountApplication(event({registrationFeeCents:1250}));
 assert.match(container.textContent,/登录后报名/);assert.match(container.textContent,/报名费用/);assert.match(container.textContent,/¥12\.50/);
 model.user={id:'member',is_anonymous:false};model.registrations.set('registration-fee',registered('waitlisted'));
 await mountApplication(event({registrationFeeCents:0}));
 assert.match(container.textContent,/候补/);assert.match(container.textContent,/免费/);assert.ok(container.querySelector('.payment-status-unpaid'));
 assert.equal(button('缴费'),undefined);
});

test('the application passes the active event fee to payment and clears the prior event amount on navigation',async()=>{
 model.user={id:'member',is_anonymous:false};model.registrations.set('registration-fee',registered());model.registrations.set('new-event',registered());
 await mountApplication(event({registrationFeeCents:1250}));await click('缴费');
 assert.match(document.querySelector('.payment-dialog').textContent,/¥12\.50/);
 await act(async()=>root.render(createElement(MemoryRouter,{children:createElement(Application,{activity:event({id:'new-event',registrationFeeCents:0})})})));
 assert.equal(document.querySelector('.payment-dialog'),null);assert.match(container.textContent,/免费/);assert.equal(document.body.textContent.includes('¥12.50'),false);
 assert.ok(container.querySelector('.payment-status-unpaid'),'free event retains the server payment status');
 await click('缴费');assert.match(document.querySelector('.payment-dialog').textContent,/免费/);
 await act(async()=>root.render(createElement(MemoryRouter,{children:createElement(Application,{activity:event({id:'new-event'})})})));
 assert.match(container.textContent,/未公布/);assert.match(document.querySelector('.payment-dialog').textContent,/未公布/);assert.equal(document.body.textContent.includes('免费'),false);
});
test('proof images are fetched only on request and their Blob URLs are revoked on close and account change',async()=>{
 model.downloads=0;model.load=async()=>new Blob(['private'],{type:'image/webp'});
 await mount(Proof,{proof:{id:'proof',objectPath:'private/path.webp',submittedAt:'2026-11-01T00:00:00Z'},expectedUserId:'member'});
 assert.equal(model.downloads,0);await click('查看缴费记录');assert.equal(model.downloads,1);const src=container.querySelector('img').getAttribute('src');assert.match(src,/^blob:/);
 await click('收起图片');assert.ok(revoked.includes(src));assert.equal(container.querySelector('img'),null);
 await click('查看缴费记录');const second=container.querySelector('img').getAttribute('src');await act(async()=>{for(const fn of model.listeners)fn('SIGNED_OUT');});assert.ok(revoked.includes(second));assert.equal(container.querySelector('img'),null);
});
test('a late private image response after account change is discarded',async()=>{
 let release;model.load=()=>new Promise(r=>release=r);
 await mount(Proof,{proof:{id:'other-proof',objectPath:'private/path.webp'},expectedUserId:'member'});
 await click('查看缴费记录');await act(async()=>{for(const fn of model.listeners)fn('SIGNED_OUT');release(new Blob(['late'],{type:'image/webp'}));});
 assert.equal(container.querySelector('img'),null);
});


test('closing the payment popup revokes the selected local receipt preview immediately',async()=>{
 const props={open:true,qrUrl:'',onClose(){},onSubmit:async()=>{}};await mount(Dialog,props);await click('我已缴费');
 const input=document.querySelector('input[type="file"]');Object.defineProperty(input,'files',{configurable:true,value:[new File(['receipt'],'receipt.webp',{type:'image/webp'})]});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 const src=document.querySelector('.payment-receipt-preview').getAttribute('src');await act(async()=>root.render(createElement(Dialog,{...props,open:false})));
 assert.ok(revoked.includes(src));assert.equal(document.querySelector('.payment-dialog'),null);
});
