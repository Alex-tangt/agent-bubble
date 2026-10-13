import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {loadConfig} from '../server/config.js';
import {SourceRepository} from '../server/sources.js';
import {createApp} from '../server/app.js';
import {safeError} from '../server/runner.js';
import type {Task} from '../server/types.js';

const config=loadConfig();
const fixtures=JSON.parse(await readFile(new URL('./fixtures/articles.json',import.meta.url),'utf8')) as Array<{id:string;url:string;expectedTail?:string;expectedTitle?:string}>;
const directory=join(config.dataDir,'article-validation',new Date().toISOString().replace(/[:.]/g,'-'));
const liveConfig={...config,dataDir:directory};
const sources=new SourceRepository(liveConfig);
const llm=process.argv.includes('--llm');
const site=process.argv.find(arg=>arg.startsWith('--site='))?.slice(7);
if(site&&!['zhihu','36kr','wechat'].includes(site)) throw Error('Supported --site values: zhihu, 36kr, wechat');
const selected=fixtures.filter(f=>(!process.argv.includes('--36kr')||f.id.startsWith('36kr'))&&(!site||f.id.startsWith(site)));
const instance=llm?createApp(liveConfig,undefined,sources):undefined;
const headers={authorization:'Bearer '+config.token};
const report:Record<string,unknown>[]=[];
async function waitTask(id:string):Promise<Task>{
 for(let attempt=0;attempt<360;attempt++){
  const task=instance!.store.getTask(id)!;
  if(!['queued','running'].includes(task.status)) return task;
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw Error('Task timeout');
}
try {
 for(const fixture of selected){
  const started=Date.now();
  try {
   // Acquisition is a deterministic program step. No model is created in the default mode.
   const source=await sources.acquire({kind:'url',value:fixture.url},AbortSignal.timeout(Math.min(config.maxRunMs,180000)));
   assert.ok(source.text.length>=500,'Article content too short');
   if(fixture.expectedTitle) assert.equal(source.title,fixture.expectedTitle,'Article title mismatch');
   if(fixture.expectedTail) assert.ok(source.text.replace(/\s/g,'').includes(fixture.expectedTail.replace(/\s/g,'')),'Article ending was not acquired; refuse to summarize a partial source');
   const result:Record<string,unknown>={...fixture,status:'pass',title:source.title,characters:source.text.length,method:source.method,
    textSha256:createHash('sha256').update(source.text).digest('hex'),acquisitionMs:Date.now()-started};
   if(instance){
    const first=(await instance.app.inject({method:'POST',url:'/api/tasks',headers,payload:{clientRequestId:randomUUID(),source:{kind:'url',value:fixture.url},message:'用中文总结文章，最多 200 字，覆盖主要论点和结尾观点，附原文链接。'}})).json<Task>();
    const summary=await waitTask(first.id);assert.equal(summary.status,'completed',summary.error??'');assert.ok(summary.result);
    const sessionFile=instance.store.getConversation(first.conversationId)?.sessionFile;assert.ok(sessionFile);
    const second=(await instance.app.inject({method:'POST',url:'/api/tasks',headers,payload:{clientRequestId:randomUUID(),conversationId:first.conversationId,message:'根据同一篇文章，解释作者在结尾提出的观点；引用结尾一处原句，不超过 20 字。最多 120 字。'}})).json<Task>();
    const follow=await waitTask(second.id);assert.equal(follow.status,'completed',follow.error??'');assert.equal(second.conversationId,first.conversationId);
    assert.equal(instance.store.getConversation(first.conversationId)?.sessionFile,sessionFile);
    assert.ok(follow.result);Object.assign(result,{conversationId:first.conversationId,summary:summary.result,followUp:follow.result,usage:[summary.usage,follow.usage]});
   }
   report.push(result);console.log(JSON.stringify({id:fixture.id,status:'pass',characters:source.text.length,method:source.method,llm}));
  }catch(error){const result={...fixture,status:'fail',error:safeError(error,[config.apiKey,config.token]),errorCode:error instanceof Error&&'reason'in error?error.reason:undefined};report.push(result);console.log(JSON.stringify({id:fixture.id,status:'fail',error:result.error,errorCode:result.errorCode}));}
 }
}finally{if(instance)await instance.app.close();else await sources.close();}
await mkdir(directory,{recursive:true});await writeFile(join(directory,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),llm,articles:report},null,2));
console.log(`Article report: ${join(directory,'report.json')}`);
process.exitCode=report.some(r=>r.status==='fail')?1:0;
