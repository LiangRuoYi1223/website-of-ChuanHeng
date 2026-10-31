const fail=(message)=>{throw new Error(message);};
function validateSettings(data) {
  if(!data || !(data.wechatQrUrl===null || typeof data.wechatQrUrl==='string' && /^https:\/\//.test(data.wechatQrUrl) && data.wechatQrUrl.length<=2048) || !(data.updatedAt===null || typeof data.updatedAt==='string' && Number.isFinite(Date.parse(data.updatedAt))) || !(data.updatedBy===null || typeof data.updatedBy==='string' && data.updatedBy)) fail('收款码设置返回的数据不完整，请重新加载。');
  return data;
}
async function administrator(client,expectedUserId) {
  if(!client?.auth?.getUser || !client?.rpc) fail('收款码设置服务暂时不可用。');
  let result;
  try{result=await client.auth.getUser();}catch{fail('暂时无法核实管理员身份，请重试。');}
  const user=result?.data?.user;
  if(result?.error || !user?.id || user.is_anonymous===true || user.app_metadata?.role!=='admin' || expectedUserId && user.id!==expectedUserId) fail('管理员登录状态已变化，请重新加载后再操作。');
  return user;
}
export async function readPaymentSettings(client) {
  const user=await administrator(client);
  let result;try{result=await client.rpc('get_payment_settings');}catch{fail('无法读取全站收款码设置，请重试。');}
  if(result?.error) fail('无法读取全站收款码设置，请确认管理员身份后重试。');
  return {...validateSettings(result?.data),viewerId:user.id};
}
export async function savePaymentSettings(client,{wechatQrUrl,expectedUpdatedAt,expectedUserId}) {
  if(!expectedUserId || !(expectedUpdatedAt===null || typeof expectedUpdatedAt==='string' && Number.isFinite(Date.parse(expectedUpdatedAt)))) fail('设置版本信息不完整，请重新加载。');
  const value=String(wechatQrUrl||'').trim();
  if(value && (!/^https:\/\//.test(value) || value.length>2048)) fail('请选择有效的收款码图片。');
  const user=await administrator(client,expectedUserId);
  let result;
  try{result=await client.rpc('save_payment_settings',{p_wechat_qr_url:value,p_expected_updated_at:expectedUpdatedAt,p_expected_user_id:user.id});}catch{fail('全站收款码保存未完成，请重新加载后核实。');}
  if(result?.error) fail('全站收款码保存未完成，设置可能已由其他管理员修改。请重新加载后核实。');
  const saved=validateSettings(result?.data);
  if(saved.updatedBy!==user.id || saved.updatedAt===null || saved.wechatQrUrl!==(value||null)) fail('无法核实保存结果，请重新加载全站设置。');
  return {...saved,viewerId:user.id};
}
