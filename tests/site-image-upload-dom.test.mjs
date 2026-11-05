import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {act,createElement} from 'react';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {mkdir,mkdtemp,realpath,rmdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://frontend.invalid/admin/backgrounds'});
const originals=new Map();
for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true})){
 originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
}
const {createRoot}=await import('react-dom/client');
const project=await realpath(fileURLToPath(new URL('../',import.meta.url)));
const artifacts=path.join(project,'artifacts');await mkdir(artifacts,{recursive:true});
const scratch=await mkdtemp(path.join(artifacts,'site-image-upload-'));
const bundle=path.join(scratch,'component.mjs');
const backend={fixture:'isolated-upload-backend'};
globalThis.__SITE_IMAGE_UPLOAD_BACKEND=backend;
await build({stdin:{contents:"export {default} from './src/site-images/ImageUpload.jsx';",resolveDir:project,loader:'jsx'},absWorkingDir:project,bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',outfile:bundle,logLevel:'silent',plugins:[{name:'upload-boundaries',setup(builder){
 builder.onResolve({filter:/(?:^|[\\/])backend\.js$/},()=>({path:'backend',namespace:'test'}));
 builder.onLoad({filter:/^backend$/,namespace:'test'},()=>({contents:'export const supabase=globalThis.__SITE_IMAGE_UPLOAD_BACKEND;',loader:'js'}));
 builder.onResolve({filter:/(?:^|[\\/])activity-cover\.js$/},()=>({path:'upload',namespace:'test'}));
 builder.onLoad({filter:/^upload$/,namespace:'test'},()=>({contents:'export const uploadActivityCover=(...args)=>globalThis.__SITE_IMAGE_UPLOAD(...args);',loader:'js'}));
}}]});
const {default:ImageUpload}=await import(pathToFileURL(bundle));
const container=document.getElementById('app');let root;
const uploaded='https://images.example.invalid/new.webp';
function deferredUpload(){
 let resolve,reject;const calls=[];const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
 globalThis.__SITE_IMAGE_UPLOAD=(...args)=>{calls.push(args);return promise;};return {resolve,reject,calls};
}
async function mount(props={}){
 if(root)await act(async()=>root.unmount());root=createRoot(container);
 await act(async()=>root.render(createElement('form',null,createElement(ImageUpload,props))));
}
async function choose(){
 const picker=container.querySelector('input[type=file]');assert.ok(picker);
 Object.defineProperty(picker,'files',{configurable:true,value:[new dom.window.File(['synthetic image'],'mountain.png',{type:'image/png'})]});
 await act(async()=>picker.dispatchEvent(new dom.window.Event('change',{bubbles:true})));
}
const saved=()=>new dom.window.FormData(container.querySelector('form')).get('image');
after(async()=>{
 if(root)await act(async()=>root.unmount());dom.window.close();
 for(const [key,descriptor] of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
 delete globalThis.__SITE_IMAGE_UPLOAD;delete globalThis.__SITE_IMAGE_UPLOAD_BACKEND;
 assert.equal(path.dirname(scratch),artifacts);await unlink(bundle);await rmdir(scratch);
});

test('upload keeps the existing image while pending, blocks duplicate selection and publishes only the completed URL',async()=>{
 const request=deferredUpload(),busy=[],values=[];
 await mount({initialValue:'/existing.webp',local:true,onBusyChange:value=>busy.push(value),onValueChange:value=>values.push(value)});
 await choose();assert.equal(request.calls.length,1);assert.equal(request.calls[0][0],backend);assert.equal(request.calls[0][2].local,true);assert.ok(request.calls[0][2].signal);
 assert.equal(saved(),'/existing.webp');assert.equal(container.querySelector('img').getAttribute('src'),'/existing.webp');assert.deepEqual(values,[]);assert.deepEqual(busy,[true]);assert.ok(container.querySelector('[aria-busy=true]'));
 for(const control of container.querySelectorAll('button,input[type=file]'))assert.equal(control.disabled,true);
 await choose();assert.equal(request.calls.length,1);
 await act(async()=>request.resolve(uploaded));assert.equal(saved(),uploaded);assert.equal(container.querySelector('img').getAttribute('src'),uploaded);assert.deepEqual(values,[uploaded]);assert.deepEqual(busy,[true,false]);assert.equal(container.querySelector('[aria-busy=true]'),null);
});

test('disabled editor rejects even a programmatically dispatched file selection',async()=>{
 const request=deferredUpload();await mount({disabled:true,initialValue:'/existing.webp',allowUrl:true});
 for(const control of container.querySelectorAll('button,input[type=file],input[type=text]'))assert.equal(control.disabled,true);
 await choose();assert.equal(request.calls.length,0);assert.equal(container.querySelector('input[type=text]').value,'/existing.webp');assert.equal(container.querySelector('img').getAttribute('src'),'/existing.webp');
});

test('failed replacement keeps the saved image and exposes an actionable error',async()=>{
 const request=deferredUpload(),busy=[],values=[];await mount({initialValue:'/existing.webp',onBusyChange:value=>busy.push(value),onValueChange:value=>values.push(value)});await choose();
 await act(async()=>request.reject(Error('图片压缩失败，请重新选择')));
 assert.equal(saved(),'/existing.webp');assert.equal(container.querySelector('img').getAttribute('src'),'/existing.webp');assert.match(container.querySelector('[role=alert]').textContent,/图片压缩失败.*原图片已保留/);assert.deepEqual(values,[]);assert.deepEqual(busy,[true,false]);
 assert.equal(container.querySelector('input[type=file]').disabled,false);
});

test('unmount aborts the pending upload and ignores a late successful response',async()=>{
 const request=deferredUpload(),busy=[],values=[];await mount({initialValue:'/existing.webp',onBusyChange:value=>busy.push(value),onValueChange:value=>values.push(value)});await choose();
 const signal=request.calls[0][2].signal;assert.equal(signal.aborted,false);
 await act(async()=>root.unmount());root=null;assert.equal(signal.aborted,true);assert.deepEqual(busy,[true,false]);
 await act(async()=>request.resolve(uploaded));assert.deepEqual(values,[]);assert.deepEqual(busy,[true,false]);assert.equal(container.textContent,'');
});

test('address-enabled cover preserves an existing address, accepts edits and submits the edited value',async()=>{
 const request=deferredUpload(),values=[];await mount({allowUrl:true,initialValue:'/legacy-cover.jpg',onValueChange:value=>values.push(value)});
 const address=container.querySelector('input[type=text]');assert.ok(address);assert.equal(address.value,'/legacy-cover.jpg');assert.equal(saved(),'/legacy-cover.jpg');assert.equal(container.querySelector('input[type=hidden]'),null);
 const replacement='https://images.example.invalid/edited.webp';
 await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(address,replacement);address.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
 assert.equal(saved(),replacement);assert.deepEqual(values,[replacement]);assert.equal(container.querySelector('img').getAttribute('src'),replacement);assert.equal(request.calls.length,0);
 await choose();assert.equal(address.disabled,true);await act(async()=>request.resolve(uploaded));assert.equal(address.value,uploaded);assert.equal(saved(),uploaded);assert.deepEqual(values,[replacement,uploaded]);
});
