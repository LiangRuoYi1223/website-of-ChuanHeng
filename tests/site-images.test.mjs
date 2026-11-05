import assert from 'node:assert/strict';
import {test} from 'node:test';
import {defaultSiteImages, validateSiteImages, validImageUrl, imageCredit, readSiteImages, saveSiteImages, saveLocalSiteImages, readLocalSiteImages,localSiteImagesMode} from '../src/site-images/config.js';

test('hero accepts one or many images, rejects empty lists, duplicate IDs and unsafe URLs',()=>{
  const config=defaultSiteImages();
  config.heroSlides=Array.from({length:12},(_,i)=>({...config.heroSlides[0],id:`slide-${i}`}));
  assert.equal(validateSiteImages(config).heroSlides.length,12);
  assert.throws(()=>validateSiteImages({...config,heroSlides:[]}),/至少/);
  assert.throws(()=>validateSiteImages({...config,heroSlides:[config.heroSlides[0],config.heroSlides[0]]}),/重复/);
  for(const url of ['javascript:alert(1)','//evil.invalid/a','/\\evil.invalid/a','https://user:pass@host.invalid/x','/image\n.jpg','data:image/png;base64,AAAA']) assert.equal(validImageUrl(url),false,url);
  assert.equal(validImageUrl('/images/redesign-v2/home-summit.webp'),true);
  assert.equal(validImageUrl('https://assets.invalid/photo.webp'),true);
  assert.match(imageCredit({url:'/images/redesign-v2/home-summit.webp',credit:'摄影作品'}),/AI/);
  assert.equal(imageCredit({url:'https://assets.invalid/a.webp',credit:'张三 摄影'}),'张三 摄影');
  assert.throws(()=>validateSiteImages({...config,slots:{unknown:{url:'/image.webp',alt:'',credit:''}}}),/位置/);
});

test('cloud saves verify identity and preserve exact revision and config on conflicts',async()=>{
  const config=defaultSiteImages(),stamp='2026-11-05T01:00:00.123456+00:00';let call;
  const client={auth:{getUser:async()=>({data:{user:{id:'admin',app_metadata:{role:'admin'}}}})},rpc:async(name,args)=>{call={name,args};return name==='get_site_images'?{data:{config:{},updatedAt:stamp}}:{error:{code:'40001'}};}};
  const state=await readSiteImages(client,{admin:true});assert.equal(state.viewerId,'admin');assert.equal(state.config.heroSlides.length,3);
  await assert.rejects(()=>saveSiteImages(client,{config,expectedUpdatedAt:stamp,expectedUserId:'admin'}),/其他|冲突/);
  assert.equal(call.args.p_expected_updated_at,stamp);assert.equal(call.args.p_expected_user_id,'admin');assert.deepEqual(call.args.p_config,config);
  await assert.rejects(()=>saveSiteImages(client,{config,expectedUpdatedAt:stamp,expectedUserId:'different'}),/登录状态/);
  client.auth.getUser=async()=>({data:{user:{id:'member',user_metadata:{role:'admin'}}}});
  await assert.rejects(()=>readSiteImages(client,{admin:true}),/管理员/);
});

test('public reads need no session; local saves stay separate and protect against stale windows',async()=>{
  const state=await readSiteImages({rpc:async()=>({data:{config:{},updatedAt:null}})});assert.equal(state.config.heroSlides.length,3);
  const memory=new Map(),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
  const initial=readLocalSiteImages(storage);const config=defaultSiteImages();config.heroSlides=config.heroSlides.slice(0,1);
  const saved=saveLocalSiteImages(config,initial.updatedAt,storage);assert.equal(saved.config.heroSlides.length,1);
  assert.throws(()=>saveLocalSiteImages(config,initial.updatedAt,storage),/其他|冲突/);
  assert.equal(readLocalSiteImages(storage).config.heroSlides.length,1);
});

test('local artwork preview is explicit in live development and cannot be enabled in production',()=>{
 const dev={allowLocalPreview:true,sampleContent:false},production={allowLocalPreview:false,sampleContent:false};
 assert.equal(localSiteImagesMode(dev,'?preview=1',true),true);
 assert.equal(localSiteImagesMode(dev,'',true),false);
 assert.equal(localSiteImagesMode(dev,'',false),true);
 assert.equal(localSiteImagesMode(production,'?preview=1',false),false);
});
