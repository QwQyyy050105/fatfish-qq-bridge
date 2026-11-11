import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {bridgeHarness} from './audit-bridge-harness.mjs';

const master = 'fixture-console-token';
const h = await bridgeHarness({files:{'public/console.html':'<title>Fixture console</title>',
  'public/console-login.html':readFileSync(new URL('../public/console-login.html',import.meta.url),'utf8')}});
const server = h.startConsoleServer();
try {
  if (!server.listening) await once(server,'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const other = 'http://localhost:' + server.address().port;
  const post = (p,headers,from=origin) => fetch(origin + p,{method:'POST',headers:{
    'content-type':'application/json',origin:from,...headers},body:'{}'});
  const issue = (token=master,more={}) => post('/api/console/launch-ticket',{'x-console-token':token,...more});
  const redeem = (ticket,from) => post('/api/console/redeem-ticket',{'x-console-launch':ticket},from);
  const login = await fetch(origin);
  assert.equal(login.status,401);
  const page = await login.text(); assert.match(page,/id="status"/);assert.ok(!page.includes(master));
  assert.equal((await issue('wrong')).status,401);
  assert.equal((await issue(master,{'x-agent-call':'1'})).status,403);
  assert.equal((await issue(master,{'x-agent-token':'foreign'})).status,403);
  assert.equal((await post('/api/console/launch-ticket',{'x-console-token':master},'https://other.invalid')).status,403);
  const first = await (await issue()).json();
  assert.match(first.ticket,/^[A-Za-z0-9_-]{43}$/);
  assert.equal((await redeem(first.ticket,'https://other.invalid')).status,403);
  const {credential} = await (await redeem(first.ticket)).json();
  assert.match(credential,/^fb1_[A-Za-z0-9_-]{43}$/);assert.notEqual(credential,master);
  assert.equal((await redeem(first.ticket)).status,401);
  const headers={'x-console-token':credential};
  assert.equal((await fetch(origin,{headers})).status,200);
  assert.equal((await fetch(origin+'/api/status',{headers})).status,200);
  assert.equal((await fetch(other+'/api/status',{headers})).status,401);
  assert.equal((await fetch(origin+'/api/status?token='+credential)).status,401);
  assert.equal((await issue(credential)).status,401);
  assert.equal((await post('/api/console/token',headers)).status,403);
  const outstanding = await (await issue()).json();
  const rotated = await post('/api/console/token',{'x-console-token':master});
  assert.equal(rotated.status,200); assert.equal((await rotated.json()).ok,true);
  assert.equal((await redeem(outstanding.ticket)).status,401);
  assert.equal((await fetch(origin+'/api/status',{headers})).status,401);
  assert.equal((await issue(master)).status,401);
  console.log('PASS console login shell, issuer authentication, agent boundary, foreign origin, single redemption, same-origin reload, rotation and revocation');
} finally {
  await new Promise(resolve=>server.close(resolve));
  await h.close();
}
