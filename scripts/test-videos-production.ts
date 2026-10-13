import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {loadConfig} from '../server/config.js';
import type {SourceDocument,Task} from '../server/types.js';

// Imports only fully validated transcripts, then exercises the running phone-facing HTTP API.
async function main():Promise<void>{
const config=loadConfig();
const validationRoot=join(config.dataDir,'video-validation');
const latest=(await readdir(validationRoot,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort().at(-1);
assert.ok(latest,'Run test:videos first');
const validated=join(validationRoot,latest);
const validation=JSON.parse(await readFile(join(validated,'report.json'),'utf8')) as {videos:Array<{status:string;sourceId?:string;url:string;textSha256?:string;id:string;method:SourceDocument['method']}>};
const passed=validation.videos.filter(video=>video.status==='pass');
assert.ok(passed.length,'No fully validated video transcript');
await mkdir(join(config.dataDir,'sources'),{recursive:true});
for(const video of process.argv.includes('--live-acquire')?[]:passed){
  assert.match(video.sourceId!,/^[a-f0-9]{64}$/);
  const data=await readFile(join(validated,'sources',video.sourceId!+'.json'),'utf8');
  const source=JSON.parse(data) as SourceDocument;
  assert.equal(createHash('sha256').update(source.text).digest('hex'),video.textSha256);
  const destination=join(config.dataDir,'sources',video.sourceId!+'.json');
  if(await access(destination).then(()=>true,()=>false))assert.equal((JSON.parse(await readFile(destination,'utf8')) as SourceDocument).text,source.text,'Existing source differs; do not overwrite');
  else await writeFile(destination,data,'utf8');
}
if(process.argv.includes('--copy-only')){console.log(JSON.stringify({status:'pass',importedSources:passed.length}));return;}
const base=`http://127.0.0.1:${config.port}`;
const headers={authorization:'Bearer '+config.token,'content-type':'application/json'};
async function api<T>(path:string,payload?:unknown):Promise<T>{
  const response=await fetch(base+path,{headers,...(payload?{method:'POST',body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(15000)});
  const result=await response.json();assert.ok(response.ok,result.message??'HTTP request failed');return result as T;
}
async function terminal(id:string):Promise<Task>{
  const deadline=Date.now()+config.maxRunMs;
  while(Date.now()<deadline){const task=await api<Task>('/api/tasks/'+id);if(!['queued','running'].includes(task.status))return task;await new Promise(resolve=>setTimeout(resolve,500));}
  throw Error('Production task timeout');
}
await api('/api/health');
if(process.argv.includes('--audit-only')){
  const files=(await readdir(validated)).filter(file=>/^production(?:-[\w-]+)?-report\.json$/.test(file)||file==='production-report.json');
  assert.ok(files.length,'Run production validation first');
  for(const file of files){
    const evidence=JSON.parse(await readFile(join(validated,file),'utf8'));
    const conversation=await api<{source:SourceDocument;tasks:Task[]}>('/api/conversations/'+evidence.conversationId);
    assert.equal(conversation.source.id,evidence.sourceId);assert.equal(conversation.source.method,evidence.method??'audio_transcription');
    assert.ok(conversation.tasks.every(task=>task.status==='completed'));assert.equal(conversation.tasks.length,2);
    const source=await api<SourceDocument>('/api/sources/'+evidence.sourceId);
    const expected=passed.find(video=>video.sourceId===source.id)!;assert.ok(expected);
    assert.equal(createHash('sha256').update(source.text).digest('hex'),expected.textSha256);
    assert.ok(source.segments?.length);assert.ok(source.segments.at(-1)!.end<=(source.durationSeconds??0)+1);
    console.log(JSON.stringify({status:'pass',conversationId:evidence.conversationId,method:source.method,characters:source.text.length,segments:source.segments.length}));
  }
  return;
}
const requestedId=process.argv.find(arg=>arg.startsWith('--id='))?.slice(5);
const first=requestedId?passed.find(video=>video.id===requestedId):passed[0];assert.ok(first,'No matching validated video');
const started=Date.now();
const task=await api<Task>('/api/tasks',{clientRequestId:randomUUID(),source:{kind:'url',value:first.url+'&vd_source=phone-validation'},message:'总结当前这一 P 的主要内容，说明依据，给出三个要点和时间戳；遇到不清楚的专有名词请保留不确定性。最多 200 字。'});
const summary=await terminal(task.id);assert.equal(summary.status,'completed',summary.error??'');assert.ok(summary.result);
const summaryElapsedMs=Date.now()-started;
const followTask=await api<Task>('/api/tasks',{clientRequestId:randomUUID(),conversationId:task.conversationId,message:'根据同一个视频的最后两分钟，说明作者下一步计划；引用一个时间戳。最多 100 字。'});
const followUp=await terminal(followTask.id);assert.equal(followUp.status,'completed',followUp.error??'');
const thread=await api<{source:SourceDocument;tasks:Task[]}>('/api/conversations/'+task.conversationId);
assert.equal(thread.source.id,first.sourceId);assert.equal(thread.source.method,first.method);assert.equal(thread.tasks.length,2);
const fullSource=await api<SourceDocument>('/api/sources/'+first.sourceId);
assert.equal(createHash('sha256').update(fullSource.text).digest('hex'),first.textSha256);
const report={testedAt:new Date().toISOString(),sourceId:first.sourceId,method:thread.source.method,conversationId:task.conversationId,summaryTaskId:summary.id,followUpTaskId:followUp.id,summary:summary.result,followUp:followUp.result,summaryElapsedMs,totalElapsedMs:Date.now()-started,liveAcquisition:process.argv.includes('--live-acquire'),validatedSources:passed.map(video=>({id:video.id,sourceId:video.sourceId}))};
await writeFile(join(validated,requestedId?'production-'+first.id+'-report.json':'production-report.json'),JSON.stringify(report,null,2),'utf8');
console.log(JSON.stringify({status:'pass',method:thread.source.method,conversationId:task.conversationId,summaryElapsedMs,totalElapsedMs:report.totalElapsedMs}));
}
await main();
