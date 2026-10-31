import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { createLocalImageBinding } from '../server/covers/local-images.mjs';
import { handlePhotoRequest } from '../server/photos/http.mjs';
import { MAX_PHOTO_BYTES, MAX_PHOTO_SOURCE_BYTES } from '../server/photos/processor.mjs';

test('real local decoder compresses >3 MiB synthetic source, keeps ratio and removes EXIF for all formats', {timeout:30000},async t=>{
  const binding=await createLocalImageBinding();
  // Deterministic synthetic noise, never a real association photo and never uploaded to storage.
  const raw=Buffer.alloc(2800*1400*3);let state=123456789;
  for(let i=0;i<raw.length;i++){state^=state<<13;state^=state>>>17;state^=state<<5;raw[i]=state&255;}
  for(const format of ['jpeg','png','webp']){
    let image=sharp(raw,{raw:{width:2800,height:1400,channels:3}}).withMetadata({exif:{IFD0:{Artist:'Synthetic local fixture',Copyright:'Not an association record'}}});
    const source=await (format==='jpeg'?image.jpeg({quality:100}):format==='webp'?image.webp({lossless:true}):image.png()).toBuffer();
    assert.ok(source.length>MAX_PHOTO_BYTES);assert.ok(source.length<=MAX_PHOTO_SOURCE_BYTES);
    const form=new FormData();form.append('file',new Blob([source],{type:`image/${format}`}),`synthetic.${format}`);
    const response=await handlePhotoRequest(new Request('http://127.0.0.1:5178/api/photos/process',{method:'POST',headers:{origin:'http://127.0.0.1:5178'},body:form}),{},{images:binding,localPreview:true});
    assert.equal(response.status,200);const output=new Uint8Array(await response.arrayBuffer());const meta=await sharp(output).metadata();
    assert.ok(output.byteLength<=MAX_PHOTO_BYTES);assert.equal(meta.format,'webp');assert.equal(meta.width,2560);assert.equal(meta.height,1280);
    assert.equal(meta.exif,undefined);assert.equal(meta.xmp,undefined);assert.equal(meta.icc,undefined);
    t.diagnostic(`${format}: source ${source.length}, output ${output.length}, ${meta.width} x ${meta.height}, EXIF/XMP/ICC absent`);
  }
});
test('real local decoder rejects signature-only content without producing output',async()=>{
  const binding=await createLocalImageBinding();const form=new FormData();form.append('file',new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'}),'broken.png');
  const response=await handlePhotoRequest(new Request('http://localhost:5178/api/photos/process',{method:'POST',headers:{origin:'http://localhost:5178'},body:form}),{},{images:binding,localPreview:true});
  assert.equal(response.status,422);assert.equal((await response.json()).error.code,'IMAGE_PROCESSING_FAILED');
});
