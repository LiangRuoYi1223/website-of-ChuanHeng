import assert from 'node:assert/strict';
import test from 'node:test';
import { handlePhotoRequest, MAX_PHOTO_BYTES, MAX_PHOTO_SOURCE_BYTES, MAX_PHOTO_REQUEST_BYTES } from '../server/photos/http.mjs';
import { processPhoto } from '../server/photos/processor.mjs';

const origin='https://chuanheng.example';
const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test_key'};
const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
const webp=new Uint8Array([82,73,70,70,4,0,0,0,87,69,66,80]);
const admin=async()=>Response.json({id:'verified-admin',app_metadata:{role:'admin'}});
function source(size){const b=new Uint8Array(size);b.set(png);return b;}
function upload({bytes=png,type='image/png',headers={},form,base=origin,query='',method='POST'}={}){
  const data=form||new FormData();if(!form)data.append('file',new Blob([bytes],{type}),'photo.png');
  return new Request(`${base}/api/photos/process${query}`,{method,headers:{origin:base,authorization:'Bearer private-test-token',...headers},...(method==='POST'?{body:data}:{})});
}
function images({info={format:'image/png',width:4000,height:2000},outputs=[webp],delay=0}={}){
  const calls=[];let n=0;
  return {calls,async info(){return typeof info==='function'?info():info;},input(stream){
    assert.ok(stream instanceof ReadableStream);
    return {transform(value){calls.push(value);return this;},async output(value){
      calls.push(value);if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      const bytes=outputs[Math.min(n++,outputs.length-1)];return {response:()=>bytes instanceof Response?bytes:new Response(bytes)};
    }};
  }};
}
async function check(response,status,code){assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');const body=await response.json();assert.equal(body.error.code,code);assert.doesNotMatch(JSON.stringify(body),/private-test-token|secret detail/);}

test('administrator can process source above 3 MiB and at 20 MiB, with bounded WebP headers',async()=>{
  for(const size of [MAX_PHOTO_BYTES+1,MAX_PHOTO_SOURCE_BYTES]){
    const binding=images();const response=await handlePhotoRequest(upload({bytes:source(size)}),env,{images:binding,fetchImpl:admin});
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');assert.equal(response.headers.get('x-photo-processed'),'1');
    assert.equal(response.headers.get('x-photo-original-bytes'),String(size));assert.equal(response.headers.get('x-photo-output-bytes'),'12');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()),webp);
    assert.deepEqual(binding.calls,[{width:2560,height:1280,fit:'scale-down'},{format:'image/webp',quality:85,anim:false}]);
  }
});
test('cross-site, anonymous and untrusted roles reject before decoding; request flags never enable preview',async()=>{
  let called=0;const binding=images({info:()=>{called++;throw Error('unexpected decode');}});
  await check(await handlePhotoRequest(upload({headers:{origin:'https://evil.example'}}),env,{images:binding,fetchImpl:admin}),403,'INVALID_ORIGIN');
  await check(await handlePhotoRequest(upload({headers:{'sec-fetch-site':'cross-site'}}),env,{images:binding,fetchImpl:admin}),403,'INVALID_ORIGIN');
  await check(await handlePhotoRequest(upload({headers:{authorization:''}}),env,{images:binding,fetchImpl:admin}),401,'AUTH_REQUIRED');
  for(const user of [{id:'leader',app_metadata:{role:'leader'}},{id:'ordinary',user_metadata:{role:'admin'}},{id:'ordinary',app_metadata:{role:'member'}}]){
    await check(await handlePhotoRequest(upload(),env,{images:binding,fetchImpl:async()=>Response.json(user)}),403,'FORBIDDEN');
  }
  await check(await handlePhotoRequest(upload({base:'http://127.0.0.1:5178',headers:{authorization:'','x-local-preview':'true'},query:'?localPreview=true'}),{...env,LOCAL_PREVIEW:true},{images:binding,fetchImpl:admin,localPreview:false}),401,'AUTH_REQUIRED');
  assert.equal(called,0);
});
test('only explicit trusted preview on a loopback host bypasses auth, while still processing',async()=>{
  assert.equal((await handlePhotoRequest(upload({base:'http://127.0.0.1:5178',headers:{authorization:''}}),{},{localPreview:true,images:images()})).status,200);
  await check(await handlePhotoRequest(upload(),{},{localPreview:true,images:images()}),503,'SERVICE_UNAVAILABLE');
  await check(await handlePhotoRequest(upload({base:'http://localhost:5178',headers:{origin:'https://evil.example'}}),{},{localPreview:true,images:images()}),403,'INVALID_ORIGIN');
});
test('photo route, method, configuration and missing binding are explicit',async()=>{
  assert.equal(await handlePhotoRequest(new Request(`${origin}/other`)),null);
  await check(await handlePhotoRequest(upload({method:'GET'})),405,'METHOD_NOT_ALLOWED');
  await check(await handlePhotoRequest(upload()),503,'SERVICE_UNAVAILABLE');
  await check(await handlePhotoRequest(upload(),env,{fetchImpl:admin}),503,'IMAGE_SERVICE_UNAVAILABLE');
});
test('multipart and source boundaries reject empty, oversized, unsupported, forged and extra entries',async()=>{
  for(const form of [new FormData(),(()=>{const f=new FormData();f.append('file','x');return f;})(),(()=>{const f=new FormData();f.append('file',new Blob([png]),'a');f.append('other','x');return f;})()])await check(await handlePhotoRequest(upload({form}),env,{fetchImpl:admin,images:images()}),400,'INVALID_UPLOAD');
  for(const [bytes,type,status,code] of [[new Uint8Array(),'image/png',415,'INVALID_IMAGE'],[source(MAX_PHOTO_SOURCE_BYTES+1),'image/png',413,'FILE_TOO_LARGE'],[png,'image/svg+xml',415,'UNSUPPORTED_FORMAT'],[png,'image/jpeg',415,'INVALID_IMAGE'],[new Uint8Array([1,2,3]),'image/png',415,'INVALID_IMAGE']])await check(await handlePhotoRequest(upload({bytes,type}),env,{fetchImpl:admin,images:images()}),status,code);
  await check(await handlePhotoRequest(upload({headers:{'content-length':String(MAX_PHOTO_REQUEST_BYTES+1)}}),env,{fetchImpl:admin}),413,'REQUEST_TOO_LARGE');
  await check(await handlePhotoRequest(upload({headers:{'content-length':'bad'}}),env,{fetchImpl:admin}),400,'INVALID_UPLOAD');
  await check(await handlePhotoRequest(upload({headers:{'content-type':'application/json'}}),env,{fetchImpl:admin}),415,'UNSUPPORTED_MEDIA_TYPE');
});
test('body streaming has byte and time budgets without Content-Length',async()=>{
  const headers={origin,authorization:'Bearer private-test-token','content-type':'multipart/form-data; boundary=x'};
  const request=new Request(`${origin}/api/photos/process`,{method:'POST',headers,body:new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_PHOTO_REQUEST_BYTES+1));c.close();}}),duplex:'half'});
  await check(await handlePhotoRequest(request,env,{fetchImpl:admin}),413,'REQUEST_TOO_LARGE');
  let cancelled=false;const stalled=new Request(`${origin}/api/photos/process`,{method:'POST',headers,body:new ReadableStream({cancel(){cancelled=true;}}),duplex:'half'});
  await check(await handlePhotoRequest(stalled,env,{fetchImpl:admin,bodyTimeoutMs:20}),408,'REQUEST_TIMEOUT');assert.equal(cancelled,true);
});
test('dimensions never enlarge, reject unsafe edges/pixels and accept exact boundaries',async()=>{
  for(const [width,height] of [[12001,1],[8000,6000],[0,1],[1.5,2]])await check(await handlePhotoRequest(upload(),env,{fetchImpl:admin,images:images({info:{format:'image/png',width,height}})}),415,'INVALID_IMAGE');
  for(const [width,height,want] of [[160,90,{width:160,height:90,fit:'scale-down'}],[12000,1,{width:2560,height:1,fit:'scale-down'}],[8000,5000,{width:2560,height:1600,fit:'scale-down'}]]){
    const binding=images({info:{format:'image/png',width,height}});assert.equal((await handlePhotoRequest(upload(),env,{fetchImpl:admin,images:binding})).status,200);assert.deepEqual(binding.calls[0],want);
  }
});
test('oversized output retries bounded quality steps and then smaller dimensions',async()=>{
  const large=source(MAX_PHOTO_BYTES+1);large.set(webp);
  const binding=images({outputs:[large,large,large,large,webp]});
  const response=await handlePhotoRequest(upload(),env,{fetchImpl:admin,images:binding});assert.equal(response.status,200);
  assert.deepEqual(binding.calls.filter(x=>x.quality).map(x=>x.quality),[85,75,65,85,75]);
  assert.deepEqual(binding.calls[6],{width:1920,height:960,fit:'scale-down'});
  const failed=images({outputs:[large]});await check(await handlePhotoRequest(upload(),env,{fetchImpl:admin,images:failed}),413,'IMAGE_OUTPUT_TOO_LARGE');assert.equal(failed.calls.length,12);
});
test('output at exactly 3 MiB succeeds, invalid output or decoder failure never returns original',async()=>{
  const exact=new Uint8Array(MAX_PHOTO_BYTES);exact.set(webp);assert.equal((await handlePhotoRequest(upload(),env,{fetchImpl:admin,images:images({outputs:[exact]})})).status,200);
  await check(await handlePhotoRequest(upload(),env,{fetchImpl:admin,images:images({outputs:[png]})}),502,'INVALID_IMAGE_OUTPUT');
  await check(await handlePhotoRequest(upload(),env,{fetchImpl:admin,images:images({outputs:[new Response('bad',{status:500})]})}),422,'IMAGE_PROCESSING_FAILED');
  await check(await handlePhotoRequest(upload(),env,{fetchImpl:admin,images:images({info:()=>{throw Error('secret detail');}})}),422,'IMAGE_PROCESSING_FAILED');
});
test('one processing deadline covers info, retries and output streams, cancelling stalled reads',async()=>{
  await check(await handlePhotoRequest(upload(),env,{fetchImpl:admin,images:images({info:()=>new Promise(()=>{})}),processingTimeoutMs:20}),504,'IMAGE_PROCESSING_TIMEOUT');
  const large=source(MAX_PHOTO_BYTES+1);large.set(webp);const binding=images({outputs:[large],delay:15});
  await check(await handlePhotoRequest(upload(),env,{fetchImpl:admin,images:binding,processingTimeoutMs:25}),504,'IMAGE_PROCESSING_TIMEOUT');
  await new Promise(resolve=>setTimeout(resolve,30));assert.ok(binding.calls.length<=4,'timed out work cannot start another encode');
  let cancelled=false;const stream=new ReadableStream({cancel(){cancelled=true;}});
  await check(await handlePhotoRequest(upload(),env,{fetchImpl:admin,images:images({outputs:[new Response(stream)]}),processingTimeoutMs:20}),504,'IMAGE_PROCESSING_TIMEOUT');assert.equal(cancelled,true);
});
test('direct processor enforces source size before allocating or calling decoder',async()=>{
  await assert.rejects(processPhoto({size:MAX_PHOTO_SOURCE_BYTES+1,arrayBuffer(){throw Error('must not read');}},images()),{code:'FILE_TOO_LARGE'});
});
