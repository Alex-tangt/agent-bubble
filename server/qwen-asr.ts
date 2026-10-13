import {createHash,randomUUID} from 'node:crypto';
import {openAsBlob,createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,rename,stat} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import type {Config} from './config.js';
import {publicUrl} from './network.js';
import {validSegments} from './captions.js';
import {SourceUnavailable,type Segment} from './types.js';

export interface AudioTranscript {
  segments:Segment[];duration:number;language?:string;model:string;
  timingsMs?:{modelLoad?:number;audioPreparation?:number;recognition?:number;upload?:number;cloudWait?:number};
}
interface Job {taskId:string;createdAt:string;status:string;}
interface Services {fetch:typeof fetch;checkDestination:(url:string)=>Promise<void>;wait:(ms:number,signal:AbortSignal)=>Promise<void>;}
const fail=(message:string,reason='ASR_FAILED')=>new SourceUnavailable(message,reason);
function apiBase(input:string):string{
  const url=new URL(input);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||url.pathname.replace(/\/$/,'')!=='/api/v1'
    ||!(/^(dashscope|dashscope-intl)\.aliyuncs\.com$/.test(url.hostname)||/^[a-z0-9-]+\.(cn-beijing|ap-southeast-1)\.maas\.aliyuncs\.com$/.test(url.hostname)))
    throw fail('Qwen 转写地址无效，请使用官方地域接口','ASR_UNAVAILABLE');
  return url.href.replace(/\/$/,'');
}
function errorResponse(status:number,data:{code?:unknown}):SourceUnavailable{
  const code=typeof data.code==='string'?data.code:'';
  if(status===401||/InvalidApiKey|Unauthorized|AccessDenied|NoPermission/i.test(code))return fail('Qwen 转写凭据无效或权限不足，请检查后端配置','ASR_AUTH_REQUIRED');
  if(status===402||/quota|balance|Arrearage|Payment/i.test(code))return fail('Qwen 转写额度或余额不足，请检查云端账户','ASR_QUOTA_EXCEEDED');
  if(status===429||/Throttl|RateLimit/i.test(code))return fail('Qwen 转写暂时限流，请稍后在原会话重试','RATE_LIMITED');
  if(/ModelNotFound|ModelNotExist|InvalidModel/i.test(code))return fail('Qwen 转写模型在当前地域不可用，请检查模型配置','ASR_MODEL_UNAVAILABLE');
  return fail('Qwen 云端转写请求失败，请在原会话重试');
}
async function json(response:Response):Promise<any>{
  if(Number(response.headers.get('content-length'))>12000000)throw fail('Qwen 返回的转写文件过大','CONTENT_INCOMPLETE');
  const reader=response.body?.getReader();if(!reader)throw fail('Qwen 返回空数据','CONTENT_INCOMPLETE');
  let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>12000000)throw fail('Qwen 返回的转写文件过大','CONTENT_INCOMPLETE');chunks.push(part.value);}}
  finally{await reader.cancel().catch(()=>{});}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('Qwen 没有返回有效转写数据','CONTENT_INCOMPLETE');}
}
export function parseQwenTranscript(data:any,expectedDuration:number,model:string):AudioTranscript{
  const duration=data?.properties?.original_duration_in_milliseconds??data?.properties?.original_duration;
  const transcript=Array.isArray(data?.transcripts)?data.transcripts.find((item:any)=>item.channel_id===0):undefined;
  const sentences=transcript?.sentences;
  if(typeof duration!=='number'||!Number.isFinite(duration)||duration<=0||Math.abs(duration/1000-expectedDuration)>Math.max(3,expectedDuration*0.005))
    throw fail('Qwen 音轨时长不完整，未将片段当作整个视频总结','CONTENT_INCOMPLETE');
  if(!Array.isArray(sentences)||!sentences.length)throw fail('Qwen 没有识别到有效语音，请补充字幕','ASR_NO_SPEECH');
  const raw=sentences.map((sentence:any)=>({start:typeof sentence.begin_time==='number'?sentence.begin_time/1000:NaN,
    end:typeof sentence.end_time==='number'?sentence.end_time/1000:NaN,text:sentence.text}));
  const segments=validSegments(raw);
  if(segments.length!==raw.length||segments.some(segment=>segment.end>duration/1000+1))throw fail('Qwen 时间戳或分段不完整，未生成视频总结','CONTENT_INCOMPLETE');
  return {segments,duration:duration/1000,model,language:transcript.language??data.language};
}
export class QwenAsr {
  private services:Services;
  constructor(private config:Config,services:Partial<Services>={}){
    this.services={fetch,checkDestination:async url=>{await publicUrl(url);},wait:async(ms,signal)=>{await delay(ms,undefined,{signal});},...services};
  }
  async transcribe(audio:string,duration:number,signal?:AbortSignal,onProgress?:(message:string)=>void):Promise<AudioTranscript>{
    try{return await this.execute(audio,duration,signal,onProgress);}
    catch(error){signal?.throwIfAborted();if(error instanceof SourceUnavailable)throw error;
      throw fail(error instanceof Error&&error.name==='TimeoutError'?'Qwen 转写等待超时，已提交的回执可供重试':'Qwen 云端转写失败，请在原会话重试',error instanceof Error&&error.name==='TimeoutError'?'FETCH_TIMEOUT':'ASR_FAILED');}
  }
  private async execute(audio:string,duration:number,signal?:AbortSignal,onProgress?:(message:string)=>void):Promise<AudioTranscript>{
    const settings=this.config.qwenAsr;if(!settings?.apiKey)throw fail('后端未配置 Qwen 转写凭据','ASR_UNAVAILABLE');
    const base=apiBase(settings.baseUrl);
    const owned=AbortSignal.timeout(this.config.video?.maxRunMs??this.config.maxRunMs);
    const scope=signal?AbortSignal.any([signal,owned]):owned;
    const auth={authorization:'Bearer '+settings.apiKey};
    const request=async(url:string,init:RequestInit={},timeout=30000):Promise<Response>=>{
      scope.throwIfAborted();await this.services.checkDestination(url);scope.throwIfAborted();
      try{return await this.services.fetch(url,{...init,redirect:'error',signal:AbortSignal.any([scope,AbortSignal.timeout(timeout)])});}
      catch{scope.throwIfAborted();throw fail('Qwen 云端连接暂时失败，请在原会话重试');}
    };
    const requestJson=async(url:string,init:RequestInit={})=>{
      const response=await request(url,init);const data=await json(response);if(!response.ok)throw errorResponse(response.status,data);return data;
    };
    const file=await stat(audio);if(!file.isFile()||file.size<100||file.size>(this.config.video?.maxAudioBytes??100*1024*1024))throw fail('音轨为空或超过上传上限','MEDIA_TOO_LARGE');
    // Scope resumable cloud jobs by file content, model, region and credential; no raw secret is stored.
    const blob=await openAsBlob(audio,{type:'application/octet-stream'});
    const hash=createHash('sha256');for await(const chunk of createReadStream(audio)){scope.throwIfAborted();hash.update(chunk);}
    const audioHash=hash.digest('hex');
    const id=createHash('sha256').update([base,settings.model,createHash('sha256').update(settings.apiKey).digest('hex'),audioHash].join('\n')).digest('hex');
    const directory=join(this.config.dataDir,'qwen-asr','jobs');await mkdir(directory,{recursive:true});
    const jobPath=join(directory,id+'.json'),resultPath=join(directory,id+'.result.json');
    const save=async(path:string,value:unknown)=>{const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(value),'utf8');await rename(temporary,path);};
    const prior=await readFile(resultPath,'utf8').then(text=>JSON.parse(text) as AudioTranscript).catch(()=>null);
    if(prior){scope.throwIfAborted();onProgress?.('复用已完成的 Qwen 云端转写');return prior;}
    let job=await readFile(jobPath,'utf8').then(text=>JSON.parse(text) as Job).catch(()=>null);
    if(job&&(!/^[a-zA-Z0-9_-]{8,150}$/.test(job.taskId)||!['PENDING','RUNNING','SUCCEEDED'].includes(job.status)||!Number.isFinite(Date.parse(job.createdAt))||Date.now()-Date.parse(job.createdAt)>22*3600000))job=null;
    const started=performance.now();let uploadMs=0;
    if(!job){
      onProgress?.('正在上传音轨到 Qwen 临时存储');
      const data=await requestJson(base+'/uploads?action=getPolicy&model='+encodeURIComponent(settings.model),{headers:auth});
      const policy=data.data;
      if(!policy||!['upload_host','upload_dir','oss_access_key_id','signature','policy','x_oss_object_acl','x_oss_forbid_overwrite'].every(field=>typeof policy[field]==='string'))throw fail('Qwen 上传凭证不完整','CONTENT_INCOMPLETE');
      const host=new URL(policy.upload_host);
      if(host.protocol!=='https:'||host.username||host.password||host.port||!host.hostname.endsWith('.aliyuncs.com'))throw fail('Qwen 上传地址无效','CONTENT_INCOMPLETE');
      if(typeof policy.max_file_size_mb==='number'&&file.size>policy.max_file_size_mb*1024*1024)throw fail('音轨超过 Qwen 上传限制','MEDIA_TOO_LARGE');
      const name=randomUUID()+'.'+(basename(audio).split('.').at(-1)?.replace(/[^a-zA-Z0-9]/g,'')||'m4a');
      const key=policy.upload_dir.replace(/\/$/,'')+'/'+name;
      const form=new FormData();
      for(const [field,value] of Object.entries({'OSSAccessKeyId':policy.oss_access_key_id,'Signature':policy.signature,'policy':policy.policy,
        'x-oss-object-acl':policy.x_oss_object_acl,'x-oss-forbid-overwrite':policy.x_oss_forbid_overwrite,key,'success_action_status':'200'}))form.append(field,value as string);
      form.append('file',blob,name);
      // Temporary OSS receives signed form fields, never the provider's Bearer credential.
      const uploaded=await request(host.href,{method:'POST',body:form},300000);await uploaded.body?.cancel();
      if(!uploaded.ok)throw fail('Qwen 临时音轨上传失败，请在原会话重试');
      uploadMs=Math.round(performance.now()-started);
      onProgress?.('正在提交 Qwen 异步转写任务');
      let submitted:any;
      try{submitted=await requestJson(base+'/services/audio/asr/transcription',{method:'POST',headers:{...auth,'content-type':'application/json','X-DashScope-Async':'enable','X-DashScope-OssResourceResolve':'enable'},
        body:JSON.stringify({model:settings.model,input:{file_urls:['oss://'+key]},parameters:{channel_id:[0]}})});}
      catch(error){scope.throwIfAborted();if(error instanceof SourceUnavailable&&['ASR_AUTH_REQUIRED','ASR_QUOTA_EXCEEDED','ASR_MODEL_UNAVAILABLE','RATE_LIMITED'].includes(error.reason))throw error;
        throw fail('Qwen 转写提交结果未知，未自动重复提交；请稍后在原会话检查或重试','ASR_SUBMISSION_UNKNOWN');}
      const output=submitted.output;
      if(typeof output?.task_id!=='string'||!/^[a-zA-Z0-9_-]{8,150}$/.test(output.task_id))throw fail('Qwen 没有返回有效任务回执，未自动重复提交','ASR_SUBMISSION_UNKNOWN');
      job={taskId:output.task_id,createdAt:new Date().toISOString(),status:'PENDING'};await save(jobPath,job);
    }else onProgress?.('正在恢复已提交的 Qwen 转写任务');
    const cloudStarted=performance.now();let polls=0,pollFailures=0;
    try{
      while(true){
        scope.throwIfAborted();
        let task:any;
        try{task=await requestJson(base+'/tasks/'+job.taskId,{headers:auth});}
        catch(error){scope.throwIfAborted();if(error instanceof SourceUnavailable&&['ASR_FAILED','RATE_LIMITED'].includes(error.reason)&&pollFailures++<3){await this.services.wait(5000,scope);continue;}throw error;}
        pollFailures=0;
        const output=task.output;const status=output?.task_status;
        if(!['PENDING','RUNNING','SUCCEEDED','FAILED','CANCELED','CANCELLED','UNKNOWN'].includes(status))throw fail('Qwen 任务状态异常','CONTENT_INCOMPLETE');
        job.status=status;await save(jobPath,job);
        if(status==='SUCCEEDED'){
          const result=Array.isArray(output.results)&&output.results.length===1?output.results[0]:null;
          if(result?.subtask_status!=='SUCCEEDED'||typeof result.transcription_url!=='string'){job.status='FAILED';await save(jobPath,job);throw fail('Qwen 音轨子任务失败，未生成总结');}
          const url=new URL(result.transcription_url);
          if(url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.endsWith('.aliyuncs.com'))throw fail('Qwen 转写结果地址无效','CONTENT_INCOMPLETE');
          onProgress?.('Qwen 转写完成，正在读取全文与时间戳');
          const transcript=parseQwenTranscript(await requestJson(url.href),duration,settings.model);
          transcript.timingsMs={upload:uploadMs,cloudWait:Math.round(performance.now()-cloudStarted)};
          scope.throwIfAborted();await save(resultPath,transcript);return transcript;
        }
        if(['FAILED','CANCELED','CANCELLED','UNKNOWN'].includes(status))throw errorResponse(500,output);
        const elapsed=Math.round((performance.now()-cloudStarted)/1000);
        onProgress?.(status==='PENDING'?`Qwen 转写任务已提交，等待云端处理（${elapsed} 秒）`:`Qwen 正在云端转写（已等待 ${elapsed} 秒）`);
        await this.services.wait(Math.min(settings.pollMs*(1+Math.floor(polls++/5)),10000),scope);
      }
    }catch(error){
      // Only PENDING tasks can be cancelled server-side. A running job remains resumable.
      if(scope.aborted&&job.status==='PENDING'){
        try{const cancelled=await this.services.fetch(base+'/tasks/'+job.taskId+'/cancel',{method:'POST',headers:auth,redirect:'error',signal:AbortSignal.timeout(10000)});
          await cancelled.body?.cancel();if(cancelled.ok){job.status='CANCELED';await save(jobPath,job);}}
        catch{/* Preserve receipt if cancellation fails or the cloud task has already begun. */}
      }
      if(signal?.aborted)throw signal.reason;
      if(owned.aborted)throw fail('Qwen 转写等待超时，已保留云端任务回执，可在原会话重试','FETCH_TIMEOUT');
      throw error instanceof SourceUnavailable?error:fail('Qwen 云端转写失败，请在原会话重试');
    }
  }
}
