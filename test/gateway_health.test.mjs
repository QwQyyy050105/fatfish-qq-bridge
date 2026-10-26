import test from 'node:test';
import assert from 'node:assert/strict';
import {queryGatewayHealth} from '../src/gateway-health.mjs';
const config = {httpUrl:'http://fixture.invalid',token:'SYNTHETIC_TOKEN_NOT_REAL'};
const secret = 'SYNTHETIC_SECRET_DO_NOT_ECHO';
test('DSH gateway status normalizes bad JSON without exposing response bytes', async () => {
  const result = await queryGatewayHealth(config, async () => new Response(secret));
  assert.deepEqual(result,{reachable:true,online:false,error:'gateway_invalid_json'});
  assert.ok(!JSON.stringify(result).includes(secret));
});
test('DSH gateway status never returns untrusted wording or arbitrary retcode text', async () => {
  for (const retcode of [401,secret]) {
    const result = await queryGatewayHealth(config, async () => Response.json({status:'failed',retcode,wording:secret}));
    assert.equal(result.wording,'gateway_api_failed'); assert.equal(result.retcode,retcode===401?401:null);
    assert.ok(!JSON.stringify(result).includes(secret));
  }
});
test('DSH gateway network exceptions are converted to a stable code', async () => {
  const result = await queryGatewayHealth(config, async () => { throw Error(secret); });
  assert.deepEqual(result,{reachable:false,error:'gateway_connection_failed'});
});
test('DSH gateway HTTP failures discard their response body and normalize the port hint', async () => {
  const result = await queryGatewayHealth(config, async () => new Response(secret,{status:426}));
  assert.equal(result.httpStatus,426); assert.ok(result.hint.includes('HTTP 426')); assert.ok(!JSON.stringify(result).includes(secret));
});
test('DSH gateway response size is bounded and valid login metadata remains usable', async () => {
  const limited = await queryGatewayHealth(config, async () => new Response('x'.repeat(65537)));
  assert.equal(limited.error,'gateway_response_limit');
  let request;
  const result = await queryGatewayHealth(config, async (url,init) => { request={url,init}; return Response.json({status:'ok',retcode:0,data:{user_id:'100000002',nickname:'Example Bot'}}); });
  assert.equal(request.url,'http://fixture.invalid/get_login_info'); assert.equal(request.init.redirect,'error');
  assert.deepEqual(result,{reachable:true,online:true,user_id:'100000002',nickname:'Example Bot'});
  assert.ok(!JSON.stringify(result).includes(config.token));
});
