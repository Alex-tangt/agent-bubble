import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {loadConfig} from '../server/config.js';
import {availableBilibiliCookies} from '../server/bilibili-session.js';
import {SourceRepository} from '../server/sources.js';
import {VideoReader} from '../server/video.js';
import {runMediaProcess} from '../server/media-process.js';
import {createApp} from '../server/app.js';
import {safeError} from '../server/runner.js';
import type {Task} from '../server/types.js';

// Only this acceptance harness ignores known captions, to verify the actual cloud fallback.
// The production reader always remains subtitle-first.
const config=loadConfig();
assert.ok(config.qwenAsr?.apiKey,'Set DASHSCOPE_API_KEY in private .env');
const reuse=process.argv.find(arg=>arg.startsWith('--reuse='))?.slice(8);if(reuse)assert.match(reuse,/^[\dTZ-]+$/);
const directory=join(config.dataDir,'qwen-validation',reuse??new Date().toISOString().replace(/[:.]/g,'-'));
const liveConfig={...config,dataDir:directory,cookiesFile:availableBilibiliCookies(config),
  video:config.video?{...config.video,asrProvider:'qwen' as const}:undefined,articleBrowser:undefined};
class CloudValidationReader extends VideoReader {
  override async read(...args:Parameters<VideoReader['read']>){
    const source=await super.read(...args);
    return {...source,transcriptBasis:'Qwen 云端音频转写（验收主动跳过平台字幕；原视频登录后有字幕）'};
  }
}
const reader=new CloudValidationReader(liveConfig,{process:async(command,args,options)=>{
  const result=await runMediaProcess(command,args,options);
  if(args.includes('--dump-single-json')){
    const metadata=JSON.parse(result.stdout);metadata.subtitles={};metadata.automatic_captions={};
    return {stdout:JSON.stringify(metadata),stderr:result.stderr+'\nValidation harness deliberately ignores platform captions.'};
  }
  return result;
}});
const sources=new SourceRepository(liveConfig,reader);
const instance=createApp(liveConfig,undefined,sources);
const headers={authorization:'Bearer '+config.token};
const url=process.argv.find(arg=>arg.startsWith('--url='))?.slice(6)??'https://www.bilibili.com/video/BV1t2HQ6EEaD/?p=1';
const started=performance.now();
async function terminal(id:string):Promise<Task>{
  const deadline=Date.now()+config.maxRunMs;
  while(Date.now()<deadline){const task=instance.store.getTask(id)!;if(!['queued','running'].includes(task.status))return task;await new Promise(resolve=>setTimeout(resolve,300));}
  throw new Error('Summary task timed out');
}
try{
  const source=await sources.acquire({kind:'url',value:url},AbortSignal.timeout(config.video!.maxRunMs),progress=>console.log(JSON.stringify({progress})));
  assert.equal(source.method,'audio_transcription');assert.equal(source.transcriptionProvider,'qwen');assert.equal(source.transcriptionModel,config.qwenAsr.model);
  assert.ok(source.segments?.length);assert.ok(source.text.length>1000);assert.ok(source.segments.at(-1)!.end<=(source.durationSeconds??0)+1);
  const acquisitionMs=Math.round(performance.now()-started);
  const task=(await instance.app.inject({method:'POST',url:'/api/tasks',headers,payload:{clientRequestId:randomUUID(),source:{kind:'url',value:url},message:'依据当前视频的转写，用中文总结三个主要内容，注明转写来源和时间点，最多 250 字。'}})).json<Task>();
  const summary=await terminal(task.id);assert.equal(summary.status,'completed',summary.error??'');assert.match(summary.result!,/Qwen|千问/i);
  const follow=(await instance.app.inject({method:'POST',url:'/api/tasks',headers,payload:{clientRequestId:randomUUID(),conversationId:task.conversationId,message:'解释最后两分钟的内容，引用一个时间点，最多 100 字。'}})).json<Task>();
  const response=await terminal(follow.id);assert.equal(response.status,'completed',response.error??'');
  const report={status:'pass',testedAt:new Date().toISOString(),url,sourceId:source.id,model:source.transcriptionModel,method:source.method,provider:source.transcriptionProvider,
    durationSeconds:source.durationSeconds,segments:source.segments.length,characters:source.text.length,firstSegments:source.segments.slice(0,3),lastSegments:source.segments.slice(-3),
    processingMs:source.processingMs,acquisitionMs,totalMs:Math.round(performance.now()-started),conversationId:task.conversationId,summary:summary.result,followUp:response.result};
  await mkdir(directory,{recursive:true});await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2),'utf8');
  console.log(JSON.stringify({status:'pass',model:report.model,durationSeconds:report.durationSeconds,segments:report.segments,characters:report.characters,acquisitionMs,processingMs:report.processingMs}));
}catch(error){console.error(safeError(error,[config.apiKey,config.token,config.qwenAsr.apiKey]));process.exitCode=1;}
finally{await instance.app.close();}
console.log('Qwen validation: '+directory);
