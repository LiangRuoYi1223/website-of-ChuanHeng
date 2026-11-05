const base='/images/redesign-v2/';
const image=(file,alt)=>({url:base+file+'.webp',alt,credit:'AI 视觉示意'});
export const IMAGE_SLOTS=[
  ['activitiesHero','活动页头图','栏目背景','activities-snow','雪山徒步氛围'],
  ['routesHero','路线页头图','栏目背景','routes-coast','海岸山脊'],
  ['galleryHero','影像页头图','栏目背景','gallery-sunset','日落山野'],
  ['newsHero','资讯页头图','栏目背景','activities-snow','雪峰山野'],
  ['aboutHero','关于川衡头图','其他页面','team-ridge','山脊同行'],
  ['footprintsHero','川衡足迹头图','其他页面','activities-snow','远山雪峰'],
  ['joinHero','加入我们头图','其他页面','join-hiker','山野徒步者'],
  ['loginBackground','登录与注册背景','其他页面','join-hiker','日落雪山'],
  ['homeAbout','首页 · 认识川衡','页面配图','team-ridge','山脊同行'],
  ['homeKnowledge','首页 · 山野知识备用图','页面配图','alpine-lake','雪峰与湖泊'],
  ['homeJoin','首页 · 加入川衡','页面配图','join-hiker','日落雪山'],
  ['aboutStory','关于川衡 · 简介配图','页面配图','team-ridge','高山山脊同行'],
  ['joinStory','加入我们 · 同行配图','页面配图','routes-coast','海岸山脊与深蓝海湾'],
  ['joinClosing','加入我们 · 页尾背景','页面配图','activities-snow','远山雪峰'],
  ['activityFallback','活动默认封面','默认封面','activities-snow','山野活动封面'],
  ['routeFallback','路线默认封面','默认封面','routes-coast','海岸路线封面'],
  ['photoFallback','影像默认图片','默认封面','gallery-sunset','日落山野影像'],
  ['articleFallback','资讯默认封面','默认封面','routes-coast','山野资讯封面'],
].map(([key,label,group,file,alt])=>({key,label,group,defaultImage:image(file,alt)}));
export function defaultSiteImages(){return {
  heroSlides:[
    {id:'summit',...image('home-summit','日落下的雪山与徒步者')},
    {id:'lake',...image('alpine-lake','雪山倒映高山湖泊')},
    {id:'camp',...image('camp-night','雪山与星空露营')},
  ],slots:Object.fromEntries(IMAGE_SLOTS.map(slot=>[slot.key,{...slot.defaultImage}]))};}
export function validImageUrl(value,{local=false}={}){
  if(typeof value!=='string'||!value||/[\\\u0000-\u0020\u007f]/.test(value))return false;
  if(local&&value.length<=1400000&&/^data:image\/(jpeg|png|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))return true;
  if(value.length>2048)return false;
  if(/^\/(?!\/)/.test(value))return true;
  try{const url=new URL(value);return /^https:\/\//i.test(value)&&url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}
}
function validateImage(value,options){
  if(!value||typeof value!=='object'||Array.isArray(value)||!validImageUrl(value.url,options)||typeof value.alt!=='string'||value.alt.length>200||typeof value.credit!=='string'||value.credit.length>200)throw new Error('图片地址或说明无效，请重新选择图片；说明和来源各限 200 字。');
  return {url:value.url,alt:value.alt,credit:value.credit};
}
export function validateSiteImages(value,{local=false}={}){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['heroSlides','slots'].includes(key)))throw new Error('图片配置格式无效，请重新加载。');
  if(!Array.isArray(value.heroSlides)||value.heroSlides.length===0)throw new Error('首页至少保留一张图片。');
  const ids=new Set();
  const heroSlides=value.heroSlides.map(item=>{
    if(!item||typeof item.id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(item.id)||ids.has(item.id))throw new Error('首页图片编号无效或重复，请重新添加。');
    ids.add(item.id);return {id:item.id,...validateImage(item,{local})};
  });
  if(!value.slots||typeof value.slots!=='object'||Array.isArray(value.slots))throw new Error('图片位置配置无效。');
  const slots={};
  for(const [key,item] of Object.entries(value.slots)){
    if(!IMAGE_SLOTS.some(slot=>slot.key===key))throw new Error('图片位置无效，请重新加载。');
    slots[key]=validateImage(item,{local});
  }
  const result={heroSlides,slots};
  if(!local&&new TextEncoder().encode(JSON.stringify(result)).length>128*1024)throw new Error('图片配置过大，请减少图片说明或图片数量后重试。');
  return result;
}
export function getSlotImage(config,key){return config?.slots?.[key]||IMAGE_SLOTS.find(slot=>slot.key===key)?.defaultImage||IMAGE_SLOTS[0].defaultImage;}
export function imageCredit(value){
  const credit=value?.credit||'';
  return value?.url?.startsWith(base)?(/AI/i.test(credit)?credit:`AI 视觉示意${credit?' · '+credit:''}`):credit;
}
function decodeState(data,options){
  if(!data||!(data.updatedAt===null||typeof data.updatedAt==='string'&&Number.isFinite(Date.parse(data.updatedAt)))||!data.config||typeof data.config!=='object'||Array.isArray(data.config))throw new Error('图片设置返回不完整，请重新加载。');
  const config=Object.keys(data.config).length?validateSiteImages(data.config,options):defaultSiteImages();
  return {config:{...config,slots:{...defaultSiteImages().slots,...config.slots}},updatedAt:data.updatedAt};
}
async function administrator(client,expectedUserId){
  let result;try{result=await client?.auth?.getUser();}catch{throw new Error('暂时无法核实管理员身份，请重试。');}
  const user=result?.data?.user;
  if(result?.error||!user?.id||user.is_anonymous===true||user.app_metadata?.role!=='admin'||expectedUserId&&user.id!==expectedUserId)throw new Error('管理员登录状态已变化，请重新加载后操作。');
  return user;
}
export async function readSiteImages(client,{admin=false}={}){
  if(!client?.rpc)throw new Error('尚未连接图片设置服务。');
  const user=admin?await administrator(client):null;
  const result=await client.rpc('get_site_images');
  if(result?.error)throw new Error('暂时无法读取全站图片，请稍后重试；若持续失败，请联系站点维护者。');
  return {...decodeState(result?.data),...(user?{viewerId:user.id}:{})};
}
export async function saveSiteImages(client,{config,expectedUpdatedAt,expectedUserId}){
  const normalized=validateSiteImages(config);
  if(!expectedUserId||!(expectedUpdatedAt===null||typeof expectedUpdatedAt==='string'&&Number.isFinite(Date.parse(expectedUpdatedAt))))throw new Error('图片设置版本不完整，请重新加载。');
  const user=await administrator(client,expectedUserId);
  let result;
  try{result=await client.rpc('save_site_images',{p_config:normalized,p_expected_updated_at:expectedUpdatedAt,p_expected_user_id:user.id});}catch{throw new Error('保存结果尚未确认，请重新加载核实。当前编辑已保留。');}
  if(result?.error)throw new Error(result.error.code==='40001'?'其他管理员或窗口已修改图片，存在版本冲突。当前编辑已保留，请复制需要的说明后重新加载。':'图片保存未完成，请核实管理员身份和网络后重试。当前编辑已保留。');
  const saved=decodeState(result?.data);
  if(!saved.updatedAt||JSON.stringify(saved.config)!==JSON.stringify({...normalized,slots:{...defaultSiteImages().slots,...normalized.slots}}))throw new Error('无法核实图片保存结果，请重新加载。');
  return {...saved,viewerId:user.id};
}
export const LOCAL_IMAGES_KEY='chuanheng-site-images-preview';
export function localSiteImagesMode(mode,search='',backendConfigured=true){
  return mode.allowLocalPreview===true&&(!backendConfigured||mode.sampleContent===true||new URLSearchParams(search).get('preview')==='1');
}
export function readLocalSiteImages(storage=globalThis.localStorage){
  const raw=storage?.getItem(LOCAL_IMAGES_KEY);
  if(!raw)return {config:defaultSiteImages(),updatedAt:null};
  return decodeState(JSON.parse(raw),{local:true});
}
export function saveLocalSiteImages(config,expectedUpdatedAt,storage=globalThis.localStorage){
  const current=readLocalSiteImages(storage);
  if(current.updatedAt!==expectedUpdatedAt)throw new Error('其他窗口已修改本地图片，存在版本冲突。请保留编辑内容后重新加载。');
  const next={config:validateSiteImages(config,{local:true}),updatedAt:new Date(Math.max(Date.now(),Date.parse(current.updatedAt||'')+1||0)).toISOString()};
  try{storage.setItem(LOCAL_IMAGES_KEY,JSON.stringify(next));}catch{throw new Error('浏览器存储空间不足，未保存图片。请换用较小图片或在云端后台上传。');}
  return next;
}
