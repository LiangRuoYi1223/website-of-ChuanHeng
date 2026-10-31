import assert from 'node:assert/strict';
import test from 'node:test';
import { handleCoverRequest, MAX_COVER_BYTES, MAX_COVER_REQUEST_BYTES } from '../server/covers/http.mjs';

const origin = 'https://chuanheng.example';
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_key' };
const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
const webp = new Uint8Array([82,73,70,70,4,0,0,0,87,69,66,80]);
const auth = async () => Response.json({ id: 'verified-admin', app_metadata: { role: 'admin' } });
function upload({bytes=png, type='image/png', headers={}, form, method='POST'}={}) {
  const data=form || new FormData();
  if (!form) data.append('file', new Blob([bytes], {type}), 'cover.png');
  return new Request(`${origin}/api/covers/process`, {method, headers:{origin,authorization:'Bearer private-test-token',...headers}, ...(method==='POST'?{body:data}:{})});
}
function images(overrides={}) {
  const calls=[];
  return { calls, async info(){return {format:'image/png',width:4000,height:2000};}, input(stream){
    assert.ok(stream instanceof ReadableStream);
    return {transform(value){calls.push(value);return this;},async output(value){calls.push(value);return {response:()=>new Response(webp,{headers:{'content-type':'image/webp'}})};}};
  }, ...overrides};
}
async function check(response,status,code){
  assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');
  const body=await response.json();assert.equal(body.error.code,code);
  assert.doesNotMatch(JSON.stringify(body),/private-test-token|secret detail/);
}

test('admin cover processing resizes proportionally, strips animation and returns bounded WebP without storage writes',async()=>{
  const binding=images();let calls=0;
  const response=await handleCoverRequest(upload(),env,{images:binding,fetchImpl:async(...args)=>{calls++;assert.match(args[0],/\/auth\/v1\/user$/);return auth();}});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');
  assert.equal(response.headers.get('x-cover-processed'),'1');assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),webp);assert.equal(calls,1);
  assert.deepEqual(binding.calls,[{width:1920,height:960,fit:'scale-down'},{format:'image/webp',quality:80,anim:false}]);
});
test('small cover dimensions are never enlarged',async()=>{
  const binding=images({info:async()=>({format:'image/png',width:160,height:90})});
  assert.equal((await handleCoverRequest(upload(),env,{images:binding,fetchImpl:auth})).status,200);
  assert.deepEqual(binding.calls[0],{width:160,height:90,fit:'scale-down'});
});
test('cross-origin and missing auth reject before processing; leader/user_metadata never grants admin',async()=>{
  let called=false;const fail=async()=>{called=true;throw Error('unexpected');};
  await check(await handleCoverRequest(upload({headers:{origin:'https://evil.example'}}),env,{fetchImpl:fail}),403,'INVALID_ORIGIN');assert.equal(called,false);
  await check(await handleCoverRequest(upload({headers:{authorization:''}}),env,{fetchImpl:auth}),401,'AUTH_REQUIRED');
  for(const user of [{id:'leader',app_metadata:{role:'leader'}},{id:'user',user_metadata:{role:'admin'}}]){
    await check(await handleCoverRequest(upload(),env,{images:images(),fetchImpl:async()=>Response.json(user)}),403,'FORBIDDEN');
  }
});
test('missing binding/configuration, unsupported method and unrelated route fail explicitly',async()=>{
  await check(await handleCoverRequest(upload(),env,{fetchImpl:auth}),503,'IMAGE_SERVICE_UNAVAILABLE');
  await check(await handleCoverRequest(upload(),{},{}),503,'SERVICE_UNAVAILABLE');
  await check(await handleCoverRequest(upload({method:'GET'})),405,'METHOD_NOT_ALLOWED');
  assert.equal(await handleCoverRequest(new Request(`${origin}/other`)),null);
});
test('multipart allows only one file, validates source size, MIME and magic',async()=>{
  for(const form of [new FormData(),(()=>{const f=new FormData();f.append('file','text');return f;})(),(()=>{const f=new FormData();f.append('file',new Blob([png]),'a');f.append('other','x');return f;})()]){
    await check(await handleCoverRequest(upload({form}),env,{images:images(),fetchImpl:auth}),400,'INVALID_UPLOAD');
  }
  for(const [bytes,type,code,status] of [[new Uint8Array(MAX_COVER_BYTES+1),'image/png','FILE_TOO_LARGE',413],[new Uint8Array([1,2,3]),'image/png','INVALID_IMAGE',415],[png,'image/jpeg','INVALID_IMAGE',415],[png,'image/svg+xml','UNSUPPORTED_FORMAT',415]]){
    await check(await handleCoverRequest(upload({bytes,type}),env,{images:images(),fetchImpl:auth}),status,code);
  }
  await check(await handleCoverRequest(upload({headers:{'content-length':String(MAX_COVER_REQUEST_BYTES+1)}}),env,{images:images(),fetchImpl:auth}),413,'REQUEST_TOO_LARGE');
});
test('untrusted decoder dimensions/format and processor failures never return original bytes',async()=>{
  for(const info of [{format:'image/jpeg',width:10,height:10},{format:'image/png',width:0,height:10},{format:'image/png',width:12001,height:10},{format:'image/png',width:8000,height:6000}]){
    await check(await handleCoverRequest(upload(),env,{images:images({info:async()=>info}),fetchImpl:auth}),415,'INVALID_IMAGE');
  }
  await check(await handleCoverRequest(upload(),env,{images:images({info:async()=>{throw Error('secret detail');}}),fetchImpl:auth}),422,'IMAGE_PROCESSING_FAILED');
  await check(await handleCoverRequest(upload(),env,{images:images({input(){return {transform(){return this;},output:async()=>({response:()=>new Response(png)})};}}),fetchImpl:auth}),502,'INVALID_IMAGE_OUTPUT');
});
test('stream budget applies without Content-Length and stalled body is cancelled at deadline',async()=>{
  const headers={origin,authorization:'Bearer private-test-token','content-type':'multipart/form-data; boundary=x'};
  const request=new Request(`${origin}/api/covers/process`,{method:'POST',headers,body:new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_COVER_REQUEST_BYTES+1));c.close();}}),duplex:'half'});
  await check(await handleCoverRequest(request,env,{images:images(),fetchImpl:auth}),413,'REQUEST_TOO_LARGE');
  let cancelled=false;
  const stalled=new Request(`${origin}/api/covers/process`,{method:'POST',headers,body:new ReadableStream({cancel(){cancelled=true;}}),duplex:'half'});
  await check(await handleCoverRequest(stalled,env,{images:images(),fetchImpl:auth,bodyTimeoutMs:20}),408,'REQUEST_TIMEOUT');
  assert.equal(cancelled,true);
});

test('processor output is size bounded and processor stalls have a deadline',async()=>{
  const oversized=new Uint8Array(MAX_COVER_BYTES+1);oversized.set(webp);
  const tooLarge=images({input(){return {transform(){return this;},output:async()=>({response:()=>new Response(oversized)})};}});
  await check(await handleCoverRequest(upload(),env,{images:tooLarge,fetchImpl:auth}),413,'IMAGE_OUTPUT_TOO_LARGE');
  await check(await handleCoverRequest(upload(),env,{images:images({info:()=>new Promise(()=>{})}),fetchImpl:auth,processingTimeoutMs:20}),504,'IMAGE_PROCESSING_TIMEOUT');
});
