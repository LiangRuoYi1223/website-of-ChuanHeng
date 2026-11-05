import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {act,createElement} from 'react';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {mkdir,mkdtemp,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const dom=new JSDOM('<div id="app"></div>',{url:'https://frontend.invalid/admin/backgrounds'});
for(const key of ['window','document','navigator','FormData','localStorage'])Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?dom.window:key==='document'?dom.window.document:dom.window[key]});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
const project=await realpath(fileURLToPath(new URL('../',import.meta.url)));await mkdir(path.join(project,'artifacts'),{recursive:true});const scratch=await mkdtemp(path.join(project,'artifacts','site-images-admin-'));
let authCallback,rpc;globalThis.__SITE_BACKEND={auth:{getUser:async()=>({data:{user:{id:'admin',app_metadata:{role:'admin'}}}}),onAuthStateChange(callback){authCallback=callback;return{data:{subscription:{unsubscribe(){}}}};}},rpc:(...args)=>rpc(...args)};
await build({stdin:{contents:"export {default} from './src/site-images/SiteImagesAdmin.jsx'",resolveDir:project,loader:'jsx'},bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},outfile:path.join(scratch,'component.mjs'),plugins:[{name:'test-backend',setup(b){b.onResolve({filter:/backend\.js$/},()=>({path:'backend',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const supabase=globalThis.__SITE_BACKEND;',loader:'js'}));}}]});
const Component=(await import(pathToFileURL(path.join(scratch,'component.mjs')))).default;
const container=document.getElementById('app');let root;
async function mount(props={}){if(root)await act(async()=>root.unmount());root=createRoot(container);await act(async()=>root.render(createElement(Component,props)));}
const button=text=>[...container.querySelectorAll('button')].find(node=>node.textContent===text);
async function click(text){assert.ok(button(text),container.textContent);await act(async()=>button(text).click());}
async function submit(){await act(async()=>container.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));}
after(async()=>{if(root)await act(async()=>root.unmount());dom.window.close();await rm(scratch,{recursive:true});delete globalThis.__SITE_BACKEND;});
test('local image manager adds, reorders and removes hero slides and persists across remounts without cloud writes',async()=>{
 let calls=0;rpc=async()=>{calls++;throw new Error('no cloud writes');};localStorage.clear();await mount({local:true});
 assert.equal(container.querySelectorAll('[data-hero-id]').length,3);
 await click('添加首页图片');assert.equal(container.querySelectorAll('[data-hero-id]').length,4);
 const ids=()=>[...container.querySelectorAll('[data-hero-id]')].map(n=>n.dataset.heroId);
 const original=ids();await act(async()=>container.querySelector('[aria-label="上移第4张首页图片"]').click());assert.equal(ids()[2],original[3]);
 while(ids().length>1)await act(async()=>container.querySelector('[aria-label="移除第1张首页图片"]').click());
 assert.equal(container.querySelector('[aria-label="移除第1张首页图片"]').disabled,true);
 await submit();assert.match(container.textContent,/仅保存在当前浏览器/);await mount({local:true});assert.equal(ids().length,1);assert.equal(calls,0);
});
test('cloud conflict retains edits and authentication changes discard late saves',async()=>{
 const stamp='2026-11-05T01:00:00.123456+00:00';let sent,resolveSave;
 rpc=async(name,args)=>name==='get_site_images'?{data:{config:{},updatedAt:stamp}}:(sent=args,{error:{code:'40001'}});
 await mount();await click('添加首页图片');await submit();assert.equal(sent.p_expected_updated_at,stamp);assert.equal(container.querySelectorAll('[data-hero-id]').length,4);assert.match(container.textContent,/冲突/);
 rpc=async(name,args)=>name==='get_site_images'?{data:{config:{},updatedAt:stamp}}:new Promise(resolve=>{resolveSave=()=>resolve({data:{config:args.p_config,updatedAt:'2026-11-05T02:00:00.123456+00:00'}});});
 await mount();await click('添加首页图片');await submit();await act(async()=>authCallback('SIGNED_OUT'));assert.equal(container.querySelector('form'),null);
 await act(async()=>resolveSave());assert.equal(container.querySelector('form'),null);assert.doesNotMatch(container.textContent,/全站图片已保存/);
});
