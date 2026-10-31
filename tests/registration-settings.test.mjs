import assert from 'node:assert/strict';
import test from 'node:test';
let parseRegistrationCapacity;
try { ({parseRegistrationCapacity}=await import('../src/applications/settings.js')); } catch {}
test('registration capacity parser exists',()=>assert.equal(typeof parseRegistrationCapacity,'function'));
test('positive whole-number participant limits are preserved',()=>{for(const [input,expected] of [['5',5],[' 10 ',10],[1,1],['100000',100000]])assert.equal(parseRegistrationCapacity(input),expected);});
test('unknown old activity capacity stays unknown',()=>{for(const value of ['',null,undefined])assert.equal(parseRegistrationCapacity(value),null);});
test('a required participant limit cannot be omitted',()=>assert.throws(()=>parseRegistrationCapacity('',{required:true}),/报名人数/));
test('invalid capacity values cannot masquerade as participant limits',()=>{for(const value of ['0','-1','1.5','1e2','NaN','100001',Infinity])assert.throws(()=>parseRegistrationCapacity(value),/报名人数/);});
