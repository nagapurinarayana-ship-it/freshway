import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerMessage, replyToCustomerMessage, handleCustomerMessages } from '../src/customer-messages.js';

function fakeEnv(){
  const calls=[];
  return {
    calls,
    DB:{prepare(sql){return {sql,bind(...args){this.args=args;return this;},async run(){calls.push({sql:this.sql,args:this.args,method:'run'});return {meta:{changes:0}};},async first(){calls.push({sql:this.sql,args:this.args,method:'first'});return null;},async all(){calls.push({sql:this.sql,args:this.args,method:'all'});return {results:[]};}};}}
  };
}

test('customer messages require a useful subject and body',async()=>{
  const env=fakeEnv();
  await assert.rejects(createCustomerMessage(env,'customer-1',{subject:'x',message:'hello'}),e=>e.status===400&&/subject/i.test(e.message));
  await assert.rejects(createCustomerMessage(env,'customer-1',{subject:'Delivery issue',message:'no'}),e=>e.status===400&&/message/i.test(e.message));
});

test('owner reply validates ids and message length before accessing the database',async()=>{
  const env=fakeEnv();
  await assert.rejects(replyToCustomerMessage(env,'not-an-id',{reply:'Hello there'}),e=>e.status===400);
  await assert.rejects(replyToCustomerMessage(env,'00000000-0000-4000-8000-000000000000',{reply:'x'}),e=>e.status===400);
  assert.equal(env.calls.length,0);
});

test('unsupported customer messages method is rejected',async()=>{
  const result=await handleCustomerMessages(new Request('https://freshway.invalid/api/customer/messages',{method:'DELETE'}),{},'customer-1');
  assert.equal(result.status,405);
  assert.equal(result.data.error,'Method not allowed.');
});
