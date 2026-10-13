import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {loadConfig} from '../server/config.js';
import {SourceRepository} from '../server/sources.js';
import {availableBilibiliCookies} from '../server/bilibili-session.js';
import {createApp} from '../server/app.js';
import {safeError} from '../server/runner.js';
import type {Task} from '../server/types.js';

const config=loadConfig();
const fixtures=JSON.parse(await readFile(new URL('./fixtures/videos.json',import.meta.url),'utf8')) as Array<{id:string;url:string;expectedTitle?:string;minimumDuration?:number}>;
const id=process.argv.find(arg=>arg.startsWith('--id='))?.slice(5);
const requestedUrl=process.argv.find(arg=>arg.startsWith('--url='))?.slice(6);
const selected=requestedUrl?[{id:'custom',url:requestedUrl}]:fixtures.filter(item=>!id||item.id===id);
assert.ok(selected.length,'No matching video fixture');
const reuse=process.argv.find(arg=>arg.startsWith('--reuse='))?.slice(8);
if(reuse)assert.match(reuse,/^[\dTZ-]+$/,'Reuse must name a validation directory');
const directory=join(config.dataDir,'video-validation',reuse??new Date().toISOString().replace(/[:.]/g,'-'));
const liveConfig={...config,cookiesFile:availableBilibiliCookies(config),dataDir:directory,articleBrowser:config.articleBrowser?{...config.articleBrowser,enabled:false}:undefined};
const sources=new SourceRepository(liveConfig);
const llm=process.argv.includes('--llm');
const instance=llm?createApp(liveConfig,undefined,sources):undefined;
const headers={authorization:'Bearer '+config.token};
const report:Record<string,unknown>[]=[];
if(reuse){const old=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));report.push(...old.videos.filter((item:{id:string})=>!selected.some(fixture=>fixture.id===item.id)));}
await mkdir(directory,{recursive:true});
async function waitTask(id:string):Promise<Task>{
  const deadline=Date.now()+(config.video?.maxRunMs??config.maxRunMs);
  while(Date.now()<deadline){
    const task=instance!.store.getTask(id)!;
    if(!['queued','running'].includes(task.status))return task;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw Error('Video task timeout');
}
async function save(){await writeFile(join(directory,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),llm,videos:report},null,2));}
try{
  for(const fixture of selected){
    const started=Date.now();let previous='';
    try{
      const source=await sources.acquire({kind:'url',value:fixture.url},AbortSignal.timeout(config.video?.maxRunMs??config.maxRunMs),progress=>{
        if(progress!==previous){console.log(JSON.stringify({id:fixture.id,progress}));previous=progress;}
      });
      assert.equal(source.kind,'video');assert.ok(source.segments?.length);assert.ok(source.text.length>50);
      if(fixture.expectedTitle)assert.ok(source.title.includes(fixture.expectedTitle),'Title does not match the requested P');
      if(fixture.minimumDuration)assert.ok((source.durationSeconds??0)>=fixture.minimumDuration,'Incomplete video duration');
      const persisted=await stat(join(sources.directory,source.id+'.json'));
      const result:Record<string,unknown>={...fixture,status:'pass',title:source.title,method:source.method,basis:source.transcriptBasis,
        durationSeconds:source.durationSeconds,videoPart:source.videoPart,sourceId:source.id,segments:source.segments!.length,characters:source.text.length,processingMs:source.processingMs,
        firstSegments:source.segments!.slice(0,3),lastSegments:source.segments!.slice(-3),textSha256:createHash('sha256').update(source.text).digest('hex'),acquisitionMs:Date.now()-started,
        originalAcquisitionMs:Math.max(0,Math.round(persisted.mtimeMs-Date.parse(source.fetchedAt))),reusedCache:!!reuse};
      if(instance){
        const first=(await instance.app.inject({method:'POST',url:'/api/tasks',headers,payload:{clientRequestId:randomUUID(),source:{kind:'url',value:fixture.url},message:'用中文总结当前这一 P，说明内容依据，给出三到五个关键点和可核对的时间戳；最多 300 字。'}})).json<Task>();
        const summary=await waitTask(first.id);assert.equal(summary.status,'completed',summary.error??'');assert.ok(summary.result);
        const second=(await instance.app.inject({method:'POST',url:'/api/tasks',headers,payload:{clientRequestId:randomUUID(),conversationId:first.conversationId,message:'解释当前视频最后两分钟的内容，引用一个已有时间点，最多 150 字。'}})).json<Task>();
        const follow=await waitTask(second.id);assert.equal(follow.status,'completed',follow.error??'');assert.ok(follow.result);assert.equal(second.conversationId,first.conversationId);
        assert.equal(instance.store.getConversation(first.conversationId)?.sourceId,source.id);
        Object.assign(result,{conversationId:first.conversationId,summary:summary.result,followUp:follow.result,usage:[summary.usage,follow.usage]});
      }
      report.push(result);await save();console.log(JSON.stringify({id:fixture.id,status:'pass',method:source.method,characters:source.text.length,acquisitionMs:result.acquisitionMs,llm}));
    }catch(error){const failure={...fixture,status:'fail',error:safeError(error,[config.apiKey,config.token]),errorCode:error instanceof Error&&'reason'in error?error.reason:undefined};report.push(failure);await save();console.log(JSON.stringify(failure));}
  }
}finally{if(instance)await instance.app.close();else await sources.close();}
console.log('Video report: '+join(directory,'report.json'));
process.exitCode=report.some(item=>item.status==='fail')?1:0;
