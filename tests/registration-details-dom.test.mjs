import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {act,createElement} from 'react';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {mkdir,mkdtemp,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dom=new JSDOM('<div id="app"></div>',{url:'https://test.invalid',pretendToBeVisual:true});
for(const k of ['window','document','navigator','HTMLElement','Event','MouseEvent'])Object.defineProperty(globalThis,k,{value:k==='window'?dom.window:k==='document'?dom.window.document:k==='navigator'?dom.window.navigator:dom.window[k],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};
const control={user:{id:'one',email:'hidden@example.invalid'},listeners:new Set(),barrier:null,calls:[]};
globalThis.__PROFILE_BACKEND={auth:{getSession:async()=>({data:{session:control.user?{user:control.sessionUser||control.user}:null}}),getUser:async()=>({data:{user:control.user}}),onAuthStateChange(cb){control.listeners.add(cb);return {data:{subscription:{unsubscribe:()=>control.listeners.delete(cb)}}}}},async rpc(name,args){control.calls.push({name,args});const id=control.user?.id;if(name==='save_member_profile'&&control.saveBarrier)await control.saveBarrier;if(control.barrier)await control.barrier;return {data:name==='get_member_activity_history'?{viewerId:id,activities:control.history||[]}:{userId:id,username:'同行者',realName:id==='two'?'账号B姓名':'测试姓名',phone:id==='two'?'13900139000':'13800138000',updatedAt:null}}}};
const project=await realpath('.');await mkdir(path.join(project,'artifacts'),{recursive:true});const scratch=await mkdtemp(path.join(project,'artifacts','details-dom-'));const bundle=path.join(scratch,'bundle.mjs');
await build({stdin:{contents:"export {default as Dialog} from './src/applications/RegistrationDetailsDialog.jsx';export {default as Settings} from './src/members/MemberSettings.jsx';",resolveDir:project,loader:'jsx'},bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},outfile:bundle,plugins:[{name:'backend',setup(b){b.onResolve({filter:/backend\.js$/},()=>({path:'backend',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const supabase=globalThis.__PROFILE_BACKEND;'}));}}]});
const {Dialog,Settings}=await import(pathToFileURL(bundle));const {createRoot}=await import('react-dom/client');const {MemoryRouter}=await import('react-router-dom');const container=document.getElementById('app');let root;
async function mount(Component,props={}){if(root)await act(async()=>root.unmount());root=createRoot(container);await act(async()=>root.render(createElement(MemoryRouter,null,createElement(Component,props))));}
async function wait(fn){for(let i=0;i<100;i++){if(fn())return;await act(async()=>new Promise(r=>setTimeout(r,5)));}assert.fail(document.body.textContent);}
function fill(name,value){const input=document.querySelector(`[name="${name}"]`);Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}
after(async()=>{if(root)await act(async()=>root.unmount());dom.window.close();assert.equal(path.dirname(scratch),path.join(project,'artifacts'));await rm(scratch,{recursive:true});});
test('settings show only the verified registration email outside the editable profile form',async()=>{
 control.user={id:'one',email:'verified@example.invalid',new_email:'pending@example.invalid',user_metadata:{email:'metadata@example.invalid'}};
 control.sessionUser={id:'one',email:'cached@example.invalid'};control.calls=[];
 await mount(Settings);await wait(()=>document.querySelector('[name="username"]'));
 const email=container.querySelector('[aria-label="注册邮箱"]');assert.ok(email);assert.match(email.textContent,/verified@example\.invalid/);
 assert.doesNotMatch(container.textContent,/cached@example|metadata@example|pending@example|签到/);
 assert.equal(email.querySelector('input,textarea,button'),null);assert.equal(container.querySelector('form').contains(email),false);
 assert.match(container.textContent,/暂无活动记录/);assert.equal(document.querySelector('[name="phone"]').value,'13800138000');
 await act(async()=>container.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 await wait(()=>container.textContent.includes('个人资料已保存'));
 assert.deepEqual(Object.keys(control.calls.find(call=>call.name==='save_member_profile').args).sort(),['p_expected_updated_at','p_expected_user_id','p_phone','p_real_name','p_username']);
 delete control.sessionUser;
});
test('missing registration email stays unknown instead of falling back to account metadata',async()=>{
 control.user={id:'one',user_metadata:{email:'metadata@example.invalid'},new_email:'pending@example.invalid'};
 await mount(Settings);await wait(()=>document.querySelector('[name="username"]'));
 assert.match(container.querySelector('[aria-label="注册邮箱"]')?.textContent||'',/暂未提供邮箱/);
 assert.doesNotMatch(container.textContent,/metadata@example|pending@example/);
});
test('signing out immediately removes the prior registration email',async()=>{
 control.user={id:'one',email:'signed-out@example.invalid'};await mount(Settings);await wait(()=>container.textContent.includes('signed-out@example.invalid'));
 await act(async()=>{control.user=null;for(const listener of control.listeners)listener('SIGNED_OUT');});
 assert.doesNotMatch(container.textContent,/signed-out@example/);
 await wait(()=>container.textContent.includes('请先登录'));assert.equal(container.querySelector('[aria-label="注册邮箱"]'),null);
 control.user={id:'one'};
});
test('late account loading cannot replace the newly verified registration email',async()=>{
 control.user={id:'one',email:'loading-a@example.invalid'};control.calls=[];
 let release;control.barrier=new Promise(resolve=>release=resolve);
 await mount(Settings);await wait(()=>control.calls.some(call=>call.name==='get_member_profile'));
 await act(async()=>{control.user={id:'two',email:'loading-b@example.invalid'};control.barrier=null;for(const listener of control.listeners)listener('SIGNED_IN');});
 await wait(()=>container.textContent.includes('loading-b@example.invalid'));
 await act(async()=>release());
 assert.match(container.textContent,/loading-b@example/);assert.doesNotMatch(container.textContent,/loading-a@example/);
 control.user={id:'one'};
});
test('details prefill saved phone, edits apply only to activity and require consent',async()=>{control.calls=[];let saved;await mount(Dialog,{open:true,userId:'one',activity:{dateEnd:'2027-01-01T00:00:00Z'},onClose:()=>{},onSubmit:async value=>{saved=value}});await wait(()=>document.querySelector('[name="phone"]')?.value==='13800138000');assert.match(document.body.textContent,/身份证号收集用于社团帮社员统一购买保险；手机号收集用于活动中的紧急联系。/);assert.equal(document.querySelector('[name="idNumber"]').value,'');await act(async()=>{fill('phone','13900139000');fill('idNumber','11010519491231002x');document.querySelector('.registration-details-dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});assert.equal(saved,undefined);await act(async()=>document.querySelector('[name="consent"]').click());await act(async()=>document.querySelector('.registration-details-dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(saved.phone,'13900139000');assert.equal(saved.idNumber,'11010519491231002X');assert.equal(control.calls.some(x=>x.name==='save_member_profile'),false);});
test('closing and changing account discards late profile and sensitive input',async()=>{let release;control.barrier=new Promise(r=>release=r);await mount(Dialog,{open:true,userId:'one',onClose:()=>{},onSubmit:async()=>{}});await act(async()=>root.render(createElement(MemoryRouter,null,createElement(Dialog,{open:true,userId:'two',onClose:()=>{},onSubmit:async()=>{}}))));control.user={id:'two'};await act(async()=>{release();control.barrier=null});await wait(()=>document.querySelector('[name="phone"]')&&!document.querySelector('[name="phone"]').disabled);assert.equal(document.querySelector('[name="idNumber"]').value,'');assert.equal(document.querySelector('[name="phone"]').value,'');});

test('closing an already filled form wipes its identity number before reopening',async()=>{
 control.user={id:'one'};await mount(Dialog,{open:true,userId:'one',onClose:()=>{},onSubmit:async()=>{}});await wait(()=>document.querySelector('[name="phone"]')?.value==='13800138000');await act(async()=>fill('idNumber','11010519491231002X'));
 await act(async()=>root.render(createElement(MemoryRouter,null,createElement(Dialog,{open:false,userId:'one',onClose:()=>{},onSubmit:async()=>{}}))));assert.equal(document.querySelector('.registration-details-dialog'),null);
 await act(async()=>root.render(createElement(MemoryRouter,null,createElement(Dialog,{open:true,userId:'one',onClose:()=>{},onSubmit:async()=>{}}))));await wait(()=>document.querySelector('[name="phone"]')?.value==='13800138000');assert.equal(document.querySelector('[name="idNumber"]').value,'');assert.equal(document.querySelector('[name="consent"]').checked,false);
});

test('settings clear prior account without an Auth callback when saving detects identity change',async()=>{
 control.user={id:'one',email:'account-a@example.invalid'};control.calls=[];control.history=[{activityId:'activity',title:'账号A历史记录',status:'active',selectionStatus:'confirmed',paymentStatus:'unpaid',insuranceStatus:'uninsured'}];await mount(Settings);await wait(()=>document.querySelector('[name="phone"]')?.value==='13800138000');assert.match(container.textContent,/账号A历史记录/);assert.match(container.textContent,/account-a@example/);
 control.user={id:'two',email:'account-b@example.invalid'};control.history=[];let release;control.barrier=new Promise(resolve=>release=resolve);
 await act(async()=>document.querySelector('.member-settings form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 assert.equal(document.querySelector('[name="phone"]'),null);assert.doesNotMatch(container.textContent,/可能已在其他页面修改|账号A历史记录|account-a@example/);assert.equal(control.calls.some(call=>call.name==='save_member_profile'),false);
 await act(async()=>{release();control.barrier=null});await wait(()=>document.querySelector('[name="phone"]'));assert.match(container.textContent,/account-b@example/);assert.doesNotMatch(container.textContent,/account-a@example/);
});
test('late settings save cannot restore old profile after account invalidation',async()=>{
 control.user={id:'one'};control.calls=[];await mount(Settings);await wait(()=>document.querySelector('[name="phone"]'));
 let finishSave;control.saveBarrier=new Promise(resolve=>finishSave=resolve);await act(async()=>document.querySelector('.member-settings form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 let finishLoad;control.barrier=new Promise(resolve=>finishLoad=resolve);await act(async()=>{control.user={id:'two'};for(const listener of control.listeners)listener('SIGNED_IN');});
 await act(async()=>{finishSave();control.saveBarrier=null});assert.equal(document.querySelector('[name="phone"]'),null);assert.doesNotMatch(container.textContent,/个人资料已保存/);
 await act(async()=>{finishLoad();control.barrier=null});await wait(()=>document.querySelector('[name="phone"]'));
});

test('late settings save detects a switched verified account even without its Auth event',async()=>{
 control.user={id:'one'};control.calls=[];await mount(Settings);await wait(()=>document.querySelector('[name="phone"]')?.value==='13800138000');
 let finishSave;control.saveBarrier=new Promise(resolve=>finishSave=resolve);
 await act(async()=>document.querySelector('.member-settings form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 control.user={id:'two'};await act(async()=>{finishSave();control.saveBarrier=null});
 assert.doesNotMatch(container.textContent,/个人资料已保存|可能已在其他页面修改/);
 await wait(()=>document.querySelector('[name="phone"]')?.value==='13900139000');assert.equal(document.querySelector('[name="realName"]').value,'账号B姓名');
});
