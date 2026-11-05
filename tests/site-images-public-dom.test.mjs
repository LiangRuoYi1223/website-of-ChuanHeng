import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {act,createElement} from 'react';
import {MemoryRouter} from 'react-router-dom';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {mkdir,mkdtemp,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/'});
for(const key of ['window','document','navigator'])Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?dom.window:key==='document'?dom.window.document:dom.window[key]});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.IntersectionObserver=class{observe(){}disconnect(){}};
dom.window.scrollTo=()=>{};
dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
globalThis.requestAnimationFrame=callback=>callback();
const {createRoot}=await import('react-dom/client');
const project=await realpath(fileURLToPath(new URL('../',import.meta.url)));
await mkdir(path.join(project,'artifacts'),{recursive:true});
const scratch=await mkdtemp(path.join(project,'artifacts','site-images-public-'));
const uploaded=key=>({url:`https://images.example.invalid/${key}.webp`,alt:`${key}配图`,credit:`摄影：${key}`});
const initial={heroSlides:Array.from({length:12},(_,index)=>({id:`slide-${index+1}`,...uploaded(`hero-${index+1}`)})),slots:Object.fromEntries(['activitiesHero','routesHero','galleryHero','newsHero','aboutHero','footprintsHero','joinHero','homeAbout','homeKnowledge','homeJoin','aboutStory','joinStory','joinClosing','routeFallback','photoFallback','articleFallback','activityFallback'].map(key=>[key,uploaded(key)]))};
let fixture=structuredClone(initial);
globalThis.__SITE_IMAGES_FIXTURE=()=>fixture;
const record={id:'real',title:'已核验内容',description:'真实内容介绍',image:'https://images.example.invalid/record.webp',category:'知识',date:'2026-11-05',status:'已结束',body:[]};
await build({stdin:{contents:"export {default as App} from './src/App.jsx';export {PageHero} from './src/ui.jsx';export {default as ActivityCover} from './src/media/ActivityCover.jsx';export {default as SiteImage} from './src/site-images/SiteImage.jsx';",resolveDir:project,loader:'jsx'},absWorkingDir:project,bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':JSON.stringify({VITE_CONTENT_MODE:'preview'})},outfile:path.join(scratch,'component.mjs'),plugins:[{name:'public-image-fixture',setup(builder){
 builder.onResolve({filter:/SiteImagesContext\.jsx$/},()=>({path:'site-context',namespace:'mock'}));
 builder.onLoad({filter:/site-context/,namespace:'mock'},()=>({contents:"export function useSiteImages(){return {config:globalThis.__SITE_IMAGES_FIXTURE(),refresh:async()=>{},error:'',loading:false}}export function SiteImagesProvider({children}){return children;}",loader:'jsx'}));
 builder.onResolve({filter:/(?:^|[\\/])catalog\.jsx$/},()=>({path:'catalog',namespace:'mock'}));
 builder.onLoad({filter:/catalog/,namespace:'mock'},()=>({contents:`export const isPreview=false;export function useCatalog(){return {activities:[],routes:[${JSON.stringify(record)}],photos:[${JSON.stringify(record)}],articles:[${JSON.stringify(record)}],loading:false,error:'',refresh:async()=>{}}}`,loader:'js'}));
 builder.onResolve({filter:/pages[\\/]Admin\.jsx$/},()=>({path:'admin',namespace:'mock'}));
 builder.onLoad({filter:/admin/,namespace:'mock'},()=>({contents:'export function AdminPage(){return null}export function LoginPage(){return null}',loader:'js'}));
}}]});
const components=await import(pathToFileURL(path.join(scratch,'component.mjs')));
const container=document.getElementById('app');let root;
async function mount(Component,props={},location='/'){
 if(root)await act(async()=>root.unmount());fixture=structuredClone(initial);
 root=createRoot(container);await act(async()=>root.render(createElement(MemoryRouter,{initialEntries:[location]},createElement(Component,props))));
}
after(async()=>{if(root)await act(async()=>root.unmount());dom.window.close();delete globalThis.__SITE_IMAGES_FIXTURE;await rm(scratch,{recursive:true});});

test('home accepts more than three slides and keeps an active image after the selected slide is removed',async()=>{
 await mount(components.App);
 const controls=container.querySelectorAll('.hero-slider button');assert.equal(controls.length,12);assert.equal(controls[9].textContent,'10');
 await act(async()=>controls[11].click());assert.equal(container.querySelector('.hero-image.active').getAttribute('src'),initial.heroSlides[11].url);assert.match(container.querySelector('.hero-caption').textContent,/摄影：hero-12/);
 fixture={...fixture,heroSlides:[fixture.heroSlides[0]]};
 await act(async()=>root.render(createElement(MemoryRouter,null,createElement(components.App))));
 assert.equal(container.querySelector('.hero-image.active').getAttribute('src'),initial.heroSlides[0].url);assert.equal(container.querySelectorAll('.hero-slider button').length,0);
});

test('public section backgrounds read independent slots and credit uploaded images correctly',async()=>{
 for(const [location,key] of [['/activities','activitiesHero'],['/routes','routesHero'],['/gallery','galleryHero'],['/news','newsHero'],['/about','aboutHero'],['/join','joinHero']]){
  await mount(components.App,{},location);assert.equal(container.querySelector('.page-hero img').getAttribute('src'),initial.slots[key].url);assert.match(container.querySelector('.page-hero .image-credit').textContent,new RegExp(`摄影：${key}`));assert.doesNotMatch(container.querySelector('.page-hero').textContent,/AI 视觉示意/);
 }
});

test('record cover takes precedence over the configured fallback and failed fallback stops retrying',async()=>{
 await mount(components.ActivityCover,{item:record});assert.equal(container.querySelector('img').getAttribute('src'),record.image);
 await act(async()=>container.querySelector('img').dispatchEvent(new dom.window.Event('error')));assert.equal(container.querySelector('img').getAttribute('src'),initial.slots.activityFallback.url);assert.doesNotMatch(container.textContent,/AI 示意影像/);
 await act(async()=>container.querySelector('img').dispatchEvent(new dom.window.Event('error')));assert.equal(container.querySelector('img'),null);assert.ok(container.querySelector('[role="img"]'));
});

test('site image hides a failed image accessibly and shows a replacement on the next render',async()=>{
 await mount(components.SiteImage,{slot:'homeAbout'});await act(async()=>container.querySelector('img').dispatchEvent(new dom.window.Event('error')));assert.equal(container.querySelector('img'),null);assert.ok(container.querySelector('[role="img"]'));
 fixture={...fixture,slots:{...fixture.slots,homeAbout:uploaded('replacement')}};await act(async()=>root.render(createElement(components.SiteImage,{slot:'homeAbout'})));assert.equal(container.querySelector('img').getAttribute('src'),uploaded('replacement').url);
});
