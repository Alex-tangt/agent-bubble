// Run deliberately against the actual managed backend. Creates exactly two new summary tasks and one follow-up.
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../server/config.js';
import type { SourceDocument,SourceInput,Task,TaskEvent } from '../server/types.js';
import { MemoryBaseClient } from '../server/memory-base.js';

const config=loadConfig();
assert.ok(config.memoryBase,'Enable the KB integration before running this acceptance');
const base=`http://127.0.0.1:${config.port}/api/`;
const headers={authorization:'Bearer '+config.token,'content-type':'application/json'};
const memory=new MemoryBaseClient(config.memoryBase);
const fixtures=[{kind:'article',id:'0e69be02f741f7c77bf812c51f78e0d681437b3b15cc920f89e39c1707488675'},
  {kind:'video',id:'00ea8357ea139256d8f710ab75bdb397a2e2530b872de561f47307f804c3e50b'}];
const report:{testedAt:string;tasks:Array<Record<string,unknown>>;followUp?:Record<string,unknown>}={testedAt:new Date().toISOString(),tasks:[]};
const directory=join(config.dataDir,'knowledge-base-acceptance',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(directory,{recursive:true});
async function api(path:string,payload?:unknown){
  const response=await fetch(base+path,{method:payload===undefined?'GET':'POST',headers,...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Bubble API returned HTTP ${response.status} for ${path}`);
  return response.json();
}
async function wait(id:string):Promise<Task>{
  const started=Date.now();while(Date.now()-started<300000){const task=await api('tasks/'+id) as Task;if(!['queued','running'].includes(task.status))return task;await new Promise(resolve=>setTimeout(resolve,1000));}
  throw new Error('Live task timed out; the accepted task remains in the actual backend');
}
const database=new DatabaseSync(join(config.dataDir,'bubble.sqlite'),{readOnly:true});
try{
  const health=await api('health');assert.equal(health.memoryBase?.enabled,true);
  for(const fixture of fixtures){
    const path=join(config.dataDir,'sources',fixture.id+'.json');const bytes=await readFile(path);
    const source=JSON.parse(bytes.toString('utf8')) as SourceDocument;assert.equal(source.kind,fixture.kind);assert.ok(source.text);
    const row=database.prepare('SELECT source_input FROM conversations WHERE source_id=? ORDER BY created_at LIMIT 1').get(fixture.id);
    assert.ok(row,'Existing source must have a recorded conversation input');const input=JSON.parse(String(row.source_input)) as SourceInput;
    assert.equal(input.kind,'url','This live acceptance reuses the exact original URL input and cache');
    const accepted=await api('tasks',{clientRequestId:'kb-live-'+randomUUID(),source:input,
      message:fixture.kind==='video'?'请按已有真实字幕总结视频，最多 250 字，保留两个时间点和来源链接。':'请总结这篇已取得的真实文章，最多 250 字，说明核心概念并保留来源链接。'}) as Task;
    const task=await wait(accepted.id);assert.equal(task.status,'completed',task.error??'');assert.ok(task.result);
    assert.equal(task.memorySave?.status,'saved',task.memorySave?.error??'');assert.ok(task.memorySave?.uri);
    const original=await memory.get(task.memorySave.uri);assert.equal(original.content,task.result);
    assert.equal(task.memorySave.contentHash,createHash('sha256').update(task.result).digest('hex'));
    const retry=await api(`tasks/${task.id}/memory/retry`,{}) as Task;assert.equal(retry.memorySave?.uri,task.memorySave.uri);assert.equal(retry.memorySave?.requestId,task.memorySave.requestId);
    assert.deepEqual(await readFile(path),bytes,'Historical source cache must remain byte-identical');
    report.tasks.push({kind:fixture.kind,taskId:task.id,conversationId:task.conversationId,sourceId:fixture.id,title:source.title,sourceUrl:source.url,
      uri:task.memorySave.uri,requestId:task.memorySave.requestId,contentHash:task.memorySave.contentHash,bytes:Buffer.byteLength(task.result),model:config.model,
      saved:true,readByteExact:true,retrySameUri:true,sourceUnchanged:true});
    await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report.tasks.at(-1)));
  }
  const article=report.tasks[0]!;const video=report.tasks[1]!;
  const accepted=await api('tasks',{clientRequestId:'kb-live-read-'+randomUUID(),conversationId:article.conversationId,
    message:`请使用 memory_search 查询知识库中保存的「${video.title}」总结，接着用 memory_get 读取这个 URI 的原文：${video.uri}。根据读到的知识库内容，用 100 字说明该视频讲了什么，并附 URI。必须实际调用这两个知识库工具；不要仅依据当前文章回答。`}) as Task;
  const follow=await wait(accepted.id);assert.equal(follow.status,'completed',follow.error??'');assert.equal(follow.memorySave,null,'Normal follow-up must not become another captured summary');
  const eventsDatabase=new DatabaseSync(join(config.dataDir,'bubble.sqlite'),{readOnly:true});
  let names:string[];
  try{names=eventsDatabase.prepare("SELECT data FROM events WHERE task_id=? AND type='memory_tool' ORDER BY id").all(follow.id).map(row=>(JSON.parse(String(row.data)) as {name:string}).name);}
  finally{eventsDatabase.close();}
  assert.ok(names.includes('memory_search'),'Actual pi run must call memory_search');assert.ok(names.includes('memory_get'),'Actual pi run must call memory_get');
  report.followUp={taskId:follow.id,conversationId:follow.conversationId,tools:names,autoSaved:false,resultHash:createHash('sha256').update(follow.result!).digest('hex')};
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:join(directory,'report.json'),followUp:report.followUp}));
}finally{database.close();}
