import assert from 'node:assert/strict';
import test from 'node:test';
import {readPaymentSettings,savePaymentSettings} from '../src/payments/settings.js';
const admin={id:'admin',app_metadata:{role:'admin'}};
const initial={wechatQrUrl:null,updatedAt:null,updatedBy:null};
const updated={wechatQrUrl:'https://project.supabase.co/storage/v1/object/public/activity-covers/admin/qr.webp',updatedAt:'2026-11-01T01:00:00Z',updatedBy:'admin'};
test('global payment settings verify the administrator and carry timestamp plus actor guards',async()=>{
 const calls=[];const client={auth:{getUser:async()=>({data:{user:admin}})},rpc:async(name,args)=>{calls.push({name,args});return{data:name==='get_payment_settings'?initial:updated}}};
 assert.deepEqual(await readPaymentSettings(client),{...initial,viewerId:admin.id});
 assert.deepEqual(await savePaymentSettings(client,{wechatQrUrl:updated.wechatQrUrl,expectedUpdatedAt:null,expectedUserId:admin.id}),{...updated,viewerId:admin.id});
 assert.deepEqual(calls[1],{name:'save_payment_settings',args:{p_wechat_qr_url:updated.wechatQrUrl,p_expected_updated_at:null,p_expected_user_id:admin.id}});
});
test('global settings never write for switched, anonymous or user-metadata-only identities',async()=>{
 for(const user of [{...admin,id:'other'},{...admin,is_anonymous:true},{id:'admin',user_metadata:{role:'admin'}},null]){
  let calls=0;const client={auth:{getUser:async()=>({data:{user}})},rpc:async()=>{calls++;return{data:updated}}};
  await assert.rejects(()=>savePaymentSettings(client,{wechatQrUrl:updated.wechatQrUrl,expectedUpdatedAt:null,expectedUserId:admin.id}));assert.equal(calls,0);
 }
});
test('stale or malformed settings responses never claim the global QR was saved',async()=>{
 for(const response of [{error:{code:'40001'}},{data:{}},{data:{...updated,wechatQrUrl:'javascript:bad'}},{data:{...updated,updatedAt:'bad'}}]){
  const client={auth:{getUser:async()=>({data:{user:admin}})},rpc:async()=>response};
  await assert.rejects(()=>savePaymentSettings(client,{wechatQrUrl:updated.wechatQrUrl,expectedUpdatedAt:null,expectedUserId:admin.id}));
 }
});
