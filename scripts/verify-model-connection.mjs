import fs from 'node:fs';
import path from 'node:path';
import {NodeApiClient,unwrap,createTurnCollector} from '../src/dsh-client.js';
const root=path.resolve(import.meta.dirname,'..');
const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
const api=new NodeApiClient(cfg.dsh.baseUrl,10000,{token:cfg.dsh.authToken||'',tokenExplicit:!!cfg.dsh.authToken,allowRemote:false});
const controller=new AbortController();const deadline=setTimeout(()=>controller.abort(),60000);
const record={at:new Date().toISOString(),provider:cfg.dsh.provider,model:cfg.dsh.model,syntheticOnly:true,qqMessagesSent:0};
let sessionId;
try{
 sessionId=unwrap(await api.sessions.create({cwd:root,agentPreset:'qq-chat-v2'},controller.signal),'create').sessionId;
 record.sessionId=sessionId;
 unwrap(await api.sessions.selectModel({sessionId,provider:cfg.dsh.provider,model:cfg.dsh.model,reasoningEffort:cfg.dsh.reasoningEffort},controller.signal),'model');
 const stream=api.events.mux({},controller.signal);const collector=createTurnCollector();
 let readyResolve;const ready=new Promise(resolve=>readyResolve=resolve);
 const result=(async()=>{for await(const envelope of stream){const frame=envelope.payload;if(frame.type==='session/snapshot'&&frame.sessionId===sessionId)readyResolve();if(frame.type==='session/event'&&frame.sessionId===sessionId){const ended=collector.push(frame.event);if(ended)return ended;}if(frame.type==='stream/error')throw Error('diagnostic_stream_error');}throw Error('diagnostic_stream_ended');})();
 result.catch(()=>{});stream.follow(sessionId);
 await Promise.race([ready,result.then(()=>{throw Error('Stream ended before subscription');})]);record.subscribed=true;
 const start=performance.now();
 unwrap(await api.sessions.prompt({sessionId,mode:'queue',content:[{type:'text',text:'这是本机网络修复后的独立连通性诊断，会话没有绑定任何QQ联系人或群。不要调用任何工具，不要发送任何QQ消息，不操作文件，只输出 OK。'}]},controller.signal),'prompt');
 const ended=await result;record.elapsedMs=Math.round(performance.now()-start);record.endKind=ended.reason.kind;record.reply=ended.text;record.ok=ended.reason.kind!=='error'&&/OK/i.test(ended.text);if(!record.ok)record.error=ended.reason.error?.message||'No OK result';
}catch(error){record.ok=false;record.error=error.message;}finally{
 clearTimeout(deadline);controller.abort();
 if(sessionId){try{await api.stopSessionWork(sessionId,{timeoutMs:5000});unwrap(await api.workspace.archiveSession({sessionId}),'archive');record.testSessionArchived=true;}catch{record.testSessionArchived=false;}}
 fs.mkdirSync(path.join(root,'state/maintenance'),{recursive:true});fs.appendFileSync(path.join(root,'state/maintenance/model_connection_history.jsonl'),JSON.stringify(record)+'\n');fs.writeFileSync(path.join(root,'state/maintenance/model_connection_recovery_20261026.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
}
process.exit(record.ok?0:1);
