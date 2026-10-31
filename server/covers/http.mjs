import { getAuthConfiguration, verifyUser, requireSameOrigin, readBounded, jsonResponse } from '../tracks/http.mjs';
import { TrackError } from '../tracks/parse.mjs';
import { processCover, MAX_COVER_BYTES } from './processor.mjs';

export { MAX_COVER_BYTES };
export const MAX_COVER_REQUEST_BYTES = MAX_COVER_BYTES + 64 * 1024;

function errorResponse(error) {
  const known=error instanceof TrackError;
  return jsonResponse({error:{code:known?error.code:'INTERNAL_ERROR',message:known?error.message:'暂时无法处理封面，请稍后重试。'}},known?error.status:500);
}

async function readUpload(request,options) {
  const contentType=request.headers.get('content-type') || '';
  if (!/^multipart\/form-data\s*(?:;|$)/i.test(contentType)) throw new TrackError('UNSUPPORTED_MEDIA_TYPE','请通过文件上传表单提交封面图片。',415);
  const length=request.headers.get('content-length');
  if(length!==null){
    if(!/^\d+$/.test(length)) throw new TrackError('INVALID_UPLOAD','上传请求长度无效。',400);
    if(Number(length)>MAX_COVER_REQUEST_BYTES) throw new TrackError('REQUEST_TOO_LARGE','封面上传请求不能超过 3 MiB 加 64 KiB。',413);
  }
  const controller=new AbortController();let timer;
  const requested=Number(options.bodyTimeoutMs);
  const timeoutMs=Number.isFinite(requested)&&requested>0?Math.min(requested,30000):30000;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new TrackError('REQUEST_TIMEOUT','上传超时，请重新选择图片后重试。',408));controller.abort();},timeoutMs);});
  let bytes;
  try {bytes=await Promise.race([readBounded(request.body,MAX_COVER_REQUEST_BYTES,'REQUEST_TOO_LARGE','封面上传请求不能超过 3 MiB 加 64 KiB。',413,controller.signal),deadline]);}
  finally {clearTimeout(timer);}
  let form;
  try {form=await new Request(request.url,{method:'POST',headers:{'content-type':contentType},body:bytes}).formData();}
  catch {throw new TrackError('INVALID_UPLOAD','文件上传格式无效，请重新选择图片。',400);}
  const entries=[...form.entries()];const file=entries[0]?.[1];
  if(entries.length!==1||entries[0][0]!=='file'||typeof file!=='object'||typeof file.name!=='string'||typeof file.arrayBuffer!=='function') throw new TrackError('INVALID_UPLOAD','请仅提交一个名为 file 的图片文件。',400);
  if(file.size>MAX_COVER_BYTES) throw new TrackError('FILE_TOO_LARGE','封面图片不能超过 3 MiB。',413);
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new TrackError('UNSUPPORTED_FORMAT','封面仅支持 JPEG、PNG 或 WebP 图片。',415);
  return file;
}

export async function handleCoverRequest(request,env={},options={}) {
  const url=new URL(request.url);
  if(url.pathname!=='/api/covers/process') return null;
  if(request.method!=='POST') return jsonResponse({error:{code:'METHOD_NOT_ALLOWED',message:'此接口仅支持 POST。'}},405,{allow:'POST'});
  try {
    requireSameOrigin(request,url);
    const config=getAuthConfiguration(env);
    if(!config) throw new TrackError('SERVICE_UNAVAILABLE','封面服务尚未完成身份配置，请稍后再试。',503);
    await verifyUser(request,config,{...options,allowedRoles:['admin'],forbiddenMessage:'只有已授权的管理员可以处理活动封面。'});
    const file=await readUpload(request,options);
    const result=await processCover(file,options.images || env.IMAGES,options);
    return new Response(result.bytes,{headers:{'content-type':'image/webp','cache-control':'no-store','x-content-type-options':'nosniff','x-cover-processed':'1','x-cover-original-bytes':String(result.originalBytes),'x-cover-output-bytes':String(result.bytes.byteLength)}});
  } catch(error) {return errorResponse(error);}
}
