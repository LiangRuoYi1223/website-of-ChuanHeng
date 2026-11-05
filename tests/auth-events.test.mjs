import assert from 'node:assert/strict';
import {test} from 'node:test';
import {shouldInvalidateAuthEvent} from '../src/session/auth-events.js';

const admin={id:'admin',is_anonymous:false,app_metadata:{role:'admin'}};
const member={id:'member',is_anonymous:false};

test('repeated identity events preserve the bound account and require the current admin role',()=>{
 for(const event of ['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED']){
  assert.equal(shouldInvalidateAuthEvent(event,{user:admin},admin.id,{requireAdmin:true}),false);
  assert.equal(shouldInvalidateAuthEvent(event,{user:member},member.id),false);
  assert.equal(shouldInvalidateAuthEvent(event,{user:{...admin,id:'other'}},admin.id,{requireAdmin:true}),true);
  assert.equal(shouldInvalidateAuthEvent(event,{user:{...admin,app_metadata:{role:'member'}}},admin.id,{requireAdmin:true}),true);
  assert.equal(shouldInvalidateAuthEvent(event,{user:{...admin,is_anonymous:true}},admin.id,{requireAdmin:true}),true);
 }
});
test('the first initial session may arrive before the server read binds a viewer',()=>{
 assert.equal(shouldInvalidateAuthEvent('INITIAL_SESSION',null,null,{requireAdmin:true}),false);
 assert.equal(shouldInvalidateAuthEvent('SIGNED_IN',{user:admin},null,{requireAdmin:true}),false);
 assert.equal(shouldInvalidateAuthEvent('TOKEN_REFRESHED',{user:admin},null,{requireAdmin:true}),false);
 assert.equal(shouldInvalidateAuthEvent('INITIAL_SESSION',null,admin.id,{requireAdmin:true}),true);
 assert.equal(shouldInvalidateAuthEvent('SIGNED_IN',null,null,{requireAdmin:true}),true);
 assert.equal(shouldInvalidateAuthEvent('TOKEN_REFRESHED',{user:member},null,{requireAdmin:true}),true);
});
test('explicit sign-out and other account events invalidate even when a previous user is attached',()=>{
 for(const event of ['SIGNED_OUT','USER_DELETED','PASSWORD_RECOVERY','USER_UPDATED','UNRECOGNIZED']){
  assert.equal(shouldInvalidateAuthEvent(event,{user:admin},admin.id,{requireAdmin:true}),true);
 }
});
