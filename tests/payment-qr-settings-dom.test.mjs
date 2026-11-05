import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {act,createElement} from 'react';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {mkdir,mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const dom=new JSDOM('<div id="app"></div>',{url:'https://frontend.invalid/admin/settings'});
for(const key of ['window','document','navigator','FormData'])Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?dom.window:key==='document'?dom.window.document:dom.window[key]});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
const project=await realpath(fileURLToPath(new URL('../',import.meta.url)));await mkdir(path.join(project,'artifacts'),{recursive:true});const scratch=await mkdtemp(path.join(project,'artifacts','qr-settings-dom-'));
const initial={wechatQrUrl:null,updatedAt:null,updatedBy:null};const url='https://project.supabase.co/storage/v1/object/public/activity-covers/admin/qr.webp';
let user={id:'admin',app_metadata:{role:'admin'}},rpc,authCallback;
globalThis.__PAYMENT_SETTINGS_BACKEND={auth:{getUser:async()=>({data:{user}}),onAuthStateChange(callback){authCallback=callback;return{data:{subscription:{unsubscribe(){}}}};}},rpc:(...args)=>rpc(...args)};
await build({stdin:{contents:"export {default} from './src/payments/PaymentSettingsAdmin.jsx'",resolveDir:project,loader:'jsx'},bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},outfile:path.join(scratch,'component.mjs'),plugins:[{name:'test-boundaries',setup(b){b.onResolve({filter:/backend\.js$/},()=>({path:'backend',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const supabase=globalThis.__PAYMENT_SETTINGS_BACKEND;',loader:'js'}));b.onResolve({filter:/PaymentQrUpload\.jsx$/},()=>({path:'qr',namespace:'qr'}));b.onLoad({filter:/.*/,namespace:'qr'},()=>({contents:`import {useState,createElement} from 'react';export default function Qr(props){const [value,setValue]=useState(props.initialValue);globalThis.__QR_UPLOAD_PROPS=props;return createElement('div',null,createElement('input',{type:'hidden',name:'paymentQrUrl',value,readOnly:true}),createElement('button',{type:'button',disabled:props.disabled,onClick(){const next='${url}';setValue(next);props.onValueChange(next);}},'选择测试收款码'));}`,loader:'js',resolveDir:project}));}}]});
const Component=(await import(pathToFileURL(path.join(scratch,'component.mjs')))).default;const container=document.getElementById('app');let root;
async function mount(props={}){if(root)await act(async()=>root.unmount());user={id:'admin',app_metadata:{role:'admin'}};root=createRoot(container);await act(async()=>root.render(createElement(Component,props)));}
const button=label=>[...container.querySelectorAll('button')].find(b=>b.textContent===label);
async function click(label){assert.ok(button(label),container.textContent);await act(async()=>button(label).click());}
async function submit(){await act(async()=>container.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));}
after(async()=>{if(root)await act(async()=>root.unmount());dom.window.close();await rm(scratch,{recursive:true});delete globalThis.__PAYMENT_SETTINGS_BACKEND;delete globalThis.__QR_UPLOAD_PROPS;});
test('global settings keep the uploaded choice on conflict and use the original microsecond timestamp',async()=>{
 const timestamp='2026-11-01T01:00:00.123456+00:00';let sent,fail=true;
 rpc=async(name,args)=>{if(name==='get_payment_settings')return{data:{...initial,updatedAt:timestamp,updatedBy:'admin'}};sent=args;return fail?{error:{code:'40001'}}:{data:{wechatQrUrl:url,updatedAt:'2026-11-01T02:00:00.123456+00:00',updatedBy:'admin'}};};
 await mount();assert.equal(button('保存全站收款码').disabled,true);await click('选择测试收款码');
 await act(async()=>globalThis.__QR_UPLOAD_PROPS.onBusyChange(true));assert.equal(button('正在处理收款码…').disabled,true);
 await act(async()=>globalThis.__QR_UPLOAD_PROPS.onBusyChange(false));await submit();assert.equal(sent.p_expected_updated_at,timestamp);assert.equal(sent.p_expected_user_id,'admin');
 assert.ok(container.querySelector('[role="alert"]'));assert.equal(container.querySelector('input').value,url);assert.doesNotMatch(container.textContent,/全站微信收款码已保存/);
 fail=false;await submit();assert.match(container.textContent,/全站微信收款码已保存/);assert.equal(button('保存全站收款码').disabled,true);
});
test('global settings clear private administration state on auth change and never write in local preview',async()=>{
 let calls=0;rpc=async()=>{calls++;return{data:initial}};await mount();await act(async()=>authCallback('SIGNED_OUT'));assert.equal(container.querySelector('form'),null);assert.match(container.textContent,/登录状态已变化/);
 calls=0;await mount({local:true});assert.equal(calls,0);assert.equal(container.querySelector('form'),null);assert.match(container.textContent,/本地预览不会修改/);
});
test('same administrator auth events preserve the unsaved QR and downgrade discards a late save',async()=>{
 let finish;rpc=async(name,args)=>name==='get_payment_settings'?{data:initial}:new Promise(resolve=>{finish=()=>resolve({data:{wechatQrUrl:args.p_wechat_qr_url,updatedAt:'2026-11-05T02:00:00Z',updatedBy:'admin'}});});
 await mount({expectedUserId:'admin'});await click('选择测试收款码');const form=container.querySelector('form');
 for(const event of ['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED']){
  await act(async()=>authCallback(event,{user}));assert.equal(container.querySelector('form'),form);assert.equal(container.querySelector('input').value,url);assert.equal(button('保存全站收款码').disabled,false);
 }
 await submit();await act(async()=>authCallback('TOKEN_REFRESHED',{user:{...user,app_metadata:{role:'member'}}}));
 assert.equal(container.querySelector('form'),null);await act(async()=>finish());assert.equal(container.querySelector('form'),null);assert.doesNotMatch(container.textContent,/全站微信收款码已保存/);
});
