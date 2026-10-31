import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { createLocalImageBinding } from '../server/covers/local-images.mjs';
import { handleCoverRequest } from '../server/covers/http.mjs';
import { processCover } from '../server/covers/processor.mjs';
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const origin='https://chuanheng.example';
const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test_key'};
const admin=async()=>Response.json({id:'admin',app_metadata:{role:'admin'}});

test('local Node binding runs shared authenticated pipeline: JPEG/PNG/WebP become resized WebP with metadata removed',async()=>{
  const binding=await createLocalImageBinding();
  for(const format of ['jpeg','png','webp']){
    const input=await sharp({create:{width:2400,height:1200,channels:3,background:'#ed7422'}}).withMetadata({exif:{IFD0:{Artist:'Private Photographer',Copyright:'Private source'}}}).toFormat(format).toBuffer();
    const form=new FormData();form.append('file',new Blob([input],{type:`image/${format}`}),`cover.${format}`);
    const response=await handleCoverRequest(new Request(`${origin}/api/covers/process`,{method:'POST',headers:{origin,authorization:'Bearer runtime-test-token'},body:form}),{...env,IMAGES:binding},{fetchImpl:admin});
    assert.equal(response.status,200);assert.equal(response.headers.get('x-cover-processed'),'1');
    const output=new Uint8Array(await response.arrayBuffer());
    const metadata=await sharp(output).metadata();
    assert.equal(metadata.format,'webp');assert.equal(metadata.width,1920);assert.equal(metadata.height,960);
    assert.equal(metadata.exif,undefined);assert.equal(metadata.xmp,undefined);assert.equal(metadata.icc,undefined);
    assert.ok(output.length<input.length);assert.notDeepEqual(output,new Uint8Array(input));
  }
});

test('real decoder rejects invalid image instead of treating a valid signature as valid pixels',async()=>{
  const binding=await createLocalImageBinding();
  const form=new FormData();form.append('file',new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'}),'broken.png');
  const response=await handleCoverRequest(new Request(`${origin}/api/covers/process`,{method:'POST',headers:{origin,authorization:'Bearer runtime-test-token'},body:form}),env,{images:binding,fetchImpl:admin});
  assert.equal(response.status,422);assert.equal((await response.json()).error.code,'IMAGE_PROCESSING_FAILED');
});

test('real Miniflare Images binding reports MIME format and processes the production cover pipeline', { timeout: 30000 }, async () => {
  const artifacts = resolve('artifacts');
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(join(artifacts, 'covers-miniflare-'));
  const configPath = join(directory, 'wrangler.json');
  let proxy;
  try {
    await writeFile(configPath, JSON.stringify({
      name: 'chuanheng-cover-local-binding-test',
      compatibility_date: '2026-10-30',
      images: { binding: 'IMAGES', remote: false },
    }));
    const { getPlatformProxy } = await import('wrangler');
    proxy = await getPlatformProxy({ configPath, persist: false, remoteBindings: false, envFiles: [] });
    const source = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#ed7422' } })
      .withMetadata({ exif: { IFD0: { Artist: 'Private fixture', Copyright: 'Private source' } } }).png().toBuffer();
    const file = new Blob([source], { type: 'image/png' });
    const info = await proxy.env.IMAGES.info(file.stream());
    assert.equal(info.format, 'image/png');
    assert.equal(info.width, 2400);
    assert.equal(info.height, 1200);
    const result = await processCover(file, proxy.env.IMAGES);
    const metadata = await sharp(result.bytes).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 1920);
    assert.equal(metadata.height, 960);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.xmp, undefined);
    assert.equal(metadata.icc, undefined);
    assert.ok(result.bytes.byteLength < source.byteLength);
    assert.equal(result.originalBytes, source.byteLength);
  } finally {
    await proxy?.dispose();
    await unlink(configPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(directory);
  }
});
