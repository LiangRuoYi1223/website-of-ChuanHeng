import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const dom=new JSDOM('<div id="app"></div>',{url:'https://frontend.invalid/activities/test'});
for(const key of ['window','document','navigator','HTMLElement','Event','MouseEvent']) Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:key==='document'?dom.window.document:key==='navigator'?dom.window.navigator:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
const {MemoryRouter}=await import('react-router-dom');
const member={id:'member',email:'member@example.invalid'};
const app={id:'application',userId:'member',createdAt:new Date().toISOString(),registeredAt:new Date().toISOString(),status:'active',paymentStatus:'unpaid',position:10,selectionStatus:'waitlisted'};
const initial={capacity:5,activeCount:10,confirmedCount:5,waitlistCount:5,canWithdraw:true,application:app};
const controller={state:initial,user:member,subscribers:new Set(),calls:[],error:null,barrier:null};
globalThis.__MEMBER_BACKEND={auth:{getSession:async()=>({data:{session:controller.user?{user:controller.user}:null}}),getUser:async()=>({data:{user:controller.user}}),onAuthStateChange(callback){controller.subscribers.add(callback);return{data:{subscription:{unsubscribe:()=>controller.subscribers.delete(callback)}}};}},async rpc(name){controller.calls.push(name); const result=controller.state; if(controller.barrier)await controller.barrier; return{data:result,error:controller.error};}};
const project=await realpath(fileURLToPath(new URL('../',import.meta.url)));await mkdir(path.join(project,'artifacts'),{recursive:true});const scratch=await mkdtemp(path.join(project,'artifacts','member-dom-'));const bundle=path.join(scratch,'component.mjs');
await build({stdin:{contents:"export {default} from './src/applications/ActivityApplication.jsx'",resolveDir:project,loader:'jsx'},bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},outfile:bundle,plugins:[{name:'backend',setup(b){b.onResolve({filter:/backend\.js$/},()=>({path:'backend',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const supabase=globalThis.__MEMBER_BACKEND;',loader:'js'}));}}]});
const Component=(await import(pathToFileURL(bundle))).default;let root;const container=document.getElementById('app');
const activity={id:'test',published:true,registrationCapacity:5,registrationOpen:true,registrationStart:new Date(Date.now()-86400000).toISOString(),registrationDeadline:new Date(Date.now()+86400000).toISOString(),dateStart:new Date(Date.now()+172800000).toISOString(),dateEnd:new Date(Date.now()+259200000).toISOString(),paymentInstructions:'请使用活动通知中的渠道缴费'};
const text=()=>container.textContent;const button=label=>[...container.querySelectorAll('button')].find(n=>n.textContent===label);
async function wait(predicate){for(let i=0;i<100;i++){if(predicate())return;await act(async()=>new Promise(r=>setTimeout(r,10)));}assert.fail(text());}
async function mount(overrides={}){if(root)await act(async()=>root.unmount());root=createRoot(container);controller.error=null;controller.calls=[];controller.user=member;controller.barrier=null;await act(async()=>root.render(createElement(MemoryRouter,null,createElement(Component,{activity:{...activity,...overrides}}))));await wait(()=>!text().includes('正在确认'));}
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
