import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeMetadata} from '../scripts/mp-bws-preflight.mjs';

const projects = JSON.stringify([{id:'dev-id',name:'HG-DEV'},{id:'prod-id',name:'HG-PROD'}]);
const records = [
  {key:'MP_ACCESS_TOKEN_TEST',projectId:'dev-id',value:'TEST-SUPER-SECRET-DO-NOT-PRINT'},
  {key:'MP_WEBHOOK_SECRET_TEST',projectId:'dev-id',value:'TOP-SECRET-WEBHOOK-DO-NOT-PRINT'},
];

test('readiness only proves both keys exist in HG-DEV',()=>{
 assert.equal(analyzeMetadata(projects,JSON.stringify(records)),'BWS_MP_SECRETS_READY');
});

test('a secret in HG-PROD is not accepted for sandbox',()=>{
 const copies=structuredClone(records);copies[0].projectId='prod-id';
 assert.equal(analyzeMetadata(projects,JSON.stringify(copies)),'BWS_MP_SECRETS_MISSING');
});

test('missing or duplicate keys fail closed',()=>{
 assert.equal(analyzeMetadata(projects,JSON.stringify(records.slice(1))),'BWS_MP_SECRETS_MISSING');
 assert.equal(analyzeMetadata(projects,JSON.stringify([...records,records[0]])),'BWS_MP_SECRETS_MISSING');
});

test('invalid, absent, or ambiguous project metadata fails closed',()=>{
 assert.equal(analyzeMetadata('INVALID','[]'),'BWS_INVALID_RESPONSE');
 assert.equal(analyzeMetadata('[]',JSON.stringify(records)),'BWS_PROJECT_UNAVAILABLE');
 assert.equal(analyzeMetadata(JSON.stringify([{id:'a',name:'HG-DEV'},{id:'b',name:'HG-DEV'}]),JSON.stringify(records)),'BWS_PROJECT_UNAVAILABLE');
});
