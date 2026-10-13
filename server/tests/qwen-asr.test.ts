import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {QwenAsr,parseQwenTranscript} from '../qwen-asr.js';
import {SourceUnavailable} from '../types.js';
import {safeError} from '../runner.js';
import {loadConfig,type Config} from '../config.js';
import {runMediaProcess} from '../media-process.js';
import {browserEnvironment} from '../article-browser.js';

const model='qwen-audio-3.0-asr-flash-filetrans';
const rawTranscript={properties:{original_duration_in_milliseconds:30000},transcripts:[{channel_id:0,sentences:[{begin_time:0,end_time:2000,text:'开头内容'},{begin_time:28000,end_time:29900,text:'结尾内容'}]}]};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const policy={upload_host:'https://test.oss-cn-beijing.aliyuncs.com/',upload_dir:'temporary/test',oss_access_key_id:'temporary-id',signature:'temporary-signature',policy:'temporary-policy',x_oss_object_acl:'private',x_oss_forbid_overwrite:'true'};
async function fixture(){
  const directory=await mkdtemp(join(tmpdir(),'bubble-qwen-'));const audio=join(directory,'audio.m4a');await writeFile(audio,Buffer.alloc(500));
  const config:Config={host:'127.0.0.1',port:0,dataDir:directory,token:'test-token-longer-than-24-characters',apiKey:'summary-key',model:'deepseek-flash',baseUrl:'https://api.deepseek.com/v1',ytDlpCommand:'yt-dlp',maxRunMs:30000,
    qwenAsr:{apiKey:'sk-ws-test.private.key',baseUrl:'https://dashscope.aliyuncs.com/api/v1',model,pollMs:1}};
  return {directory,audio,config,async close(){assert.ok(directory.startsWith(join(tmpdir(),'bubble-qwen-')));await rm(directory,{recursive:true,force:true});}};
}

test('Qwen uploads privately, submits exact filetrans model, polls, saves timestamps and reuses the completed job',async()=>{
  const f=await fixture();const calls:string[]=[];let polls=0;
  try{
    const cloud=new QwenAsr(f.config,{checkDestination:async()=>{},wait:async()=>{},fetch:async(input,init)=>{
      const url=String(input);calls.push(url);const headers=new Headers(init?.headers);
      if(url.includes('/uploads?')){assert.equal(headers.get('authorization'),'Bearer '+f.config.qwenAsr!.apiKey);return json({data:policy});}
      if(url===policy.upload_host){assert.equal(headers.get('authorization'),null);const form=init?.body;assert.ok(form instanceof FormData);assert.equal([...form.keys()].at(-1),'file');assert.equal(form.get('x-oss-object-acl'),'private');return new Response('',{status:200});}
      if(url.endsWith('/transcription')){
        assert.equal(headers.get('x-dashscope-async'),'enable');assert.equal(headers.get('x-dashscope-ossresourceresolve'),'enable');
        const body=JSON.parse(String(init?.body));assert.equal(body.model,model);assert.equal(body.input.file_urls.length,1);assert.match(body.input.file_urls[0],/^oss:\/\/temporary\/test\//);assert.deepEqual(body.parameters,{channel_id:[0]});
        return json({output:{task_id:'test-task-1234',task_status:'PENDING'}});
      }
      if(url.endsWith('/tasks/test-task-1234')){polls++;return json({output:polls===1?{task_status:'RUNNING'}:{task_status:'SUCCEEDED',results:[{subtask_status:'SUCCEEDED',transcription_url:'https://result.oss-cn-beijing.aliyuncs.com/result.json?Signature=private'}]}});}
      assert.equal(headers.get('authorization'),null);return json(rawTranscript);
    }});
    const result=await cloud.transcribe(f.audio,30);assert.equal(result.segments[1]!.start,28);assert.equal(result.model,model);
    assert.equal((await cloud.transcribe(f.audio,30)).duration,30);assert.equal(calls.filter(url=>url.endsWith('/transcription')).length,1);
    const files=await readdir(join(f.directory,'qwen-asr','jobs'));assert.equal(files.length,2);
    for(const file of files){const text=await readFile(join(f.directory,'qwen-asr','jobs',file),'utf8');assert.ok(!text.includes(f.config.qwenAsr!.apiKey));assert.ok(!text.includes('Signature=private'));}
  }finally{await f.close();}
});

test('interrupted cloud polling resumes the saved task without uploading or submitting a second billable job',async()=>{
  const f=await fixture();const controller=new AbortController();let submits=0,uploads=0;
  try{
    const request:typeof fetch=async(input)=>{
      const url=String(input);
      if(url.includes('/uploads?')){uploads++;return json({data:policy});}
      if(url===policy.upload_host)return new Response('',{status:200});
      if(url.endsWith('/transcription')){submits++;return json({output:{task_id:'resume-task-1234',task_status:'PENDING'}});}
      if(url.endsWith('/tasks/resume-task-1234'))return json({output:{task_status:controller.signal.aborted?'SUCCEEDED':'RUNNING',results:[{subtask_status:'SUCCEEDED',transcription_url:'https://result.oss-cn-beijing.aliyuncs.com/a.json'}]}});
      return json(rawTranscript);
    };
    const first=new QwenAsr(f.config,{checkDestination:async()=>{},fetch:request,wait:async()=>{controller.abort('cancelled');throw 'cancelled';}});
    await assert.rejects(first.transcribe(f.audio,30,controller.signal),error=>error==='cancelled');
    const result=await new QwenAsr(f.config,{checkDestination:async()=>{},fetch:request,wait:async()=>{}}).transcribe(f.audio,30);
    assert.equal(result.duration,30);assert.equal(submits,1);assert.equal(uploads,1);
  }finally{await f.close();}
});

test('PENDING cancellation requests the cloud cancel endpoint and accepts its JSON string response',async()=>{
  const f=await fixture();const controller=new AbortController();let cancels=0;
  try{
    const cloud=new QwenAsr(f.config,{checkDestination:async()=>{},wait:async()=>{controller.abort('cancelled');throw 'cancelled';},fetch:async(input,init)=>{
      const url=String(input);if(url.includes('/uploads?'))return json({data:policy});if(url===policy.upload_host)return new Response('',{status:200});
      if(url.endsWith('/transcription'))return json({output:{task_id:'pending-task-1234',task_status:'PENDING'}});
      if(url.endsWith('/cancel')){cancels++;assert.equal(init?.method,'POST');assert.equal(init?.body,undefined);return json('request-id');}
      return json({output:{task_status:'PENDING'}});
    }});
    await assert.rejects(cloud.transcribe(f.audio,30,controller.signal),error=>error==='cancelled');assert.equal(cancels,1);
  }finally{await f.close();}
});

test('ASR API errors redact the dotted workspace key and fail before any upload on authentication errors',async()=>{
  const f=await fixture();let calls=0;
  try{
    const cloud=new QwenAsr(f.config,{checkDestination:async()=>{},fetch:async()=>{calls++;return json({code:'InvalidApiKey',message:f.config.qwenAsr!.apiKey},401);}});
    await assert.rejects(cloud.transcribe(f.audio,30),error=>error instanceof SourceUnavailable&&error.reason==='ASR_AUTH_REQUIRED'&&!error.message.includes('test.private'));
    assert.equal(calls,1);assert.equal(safeError(new Error('key sk-ws-test.private.key rejected')),'key [已隐藏] rejected');
  }finally{await f.close();}
});

test('success status with failed subtask never becomes a usable transcript',async()=>{
  const f=await fixture();
  try{
    const cloud=new QwenAsr(f.config,{checkDestination:async()=>{},fetch:async(input)=>{
      const url=String(input);if(url.includes('/uploads?'))return json({data:policy});if(url===policy.upload_host)return new Response('',{status:200});
      if(url.endsWith('/transcription'))return json({output:{task_id:'failed-subtask-1234',task_status:'PENDING'}});
      return json({output:{task_status:'SUCCEEDED',results:[{subtask_status:'FAILED',code:'FILE_DOWNLOAD_FAILED'}]}});
    }});
    await assert.rejects(cloud.transcribe(f.audio,30),error=>error instanceof SourceUnavailable&&error.reason==='ASR_FAILED');
  }finally{await f.close();}
});

test('Qwen validates full duration and all sentence timestamps, rather than relying on speech-only duration',()=>{
  assert.equal(parseQwenTranscript({...rawTranscript,transcripts:rawTranscript.transcripts.map(item=>({...item,content_duration_in_milliseconds:5000}))},30,model).duration,30);
  for(const data of [{...rawTranscript,properties:{original_duration_in_milliseconds:10000}},
    {...rawTranscript,transcripts:[{channel_id:0,sentences:[{begin_time:30000,end_time:2000,text:'坏分段'}]}]}])assert.throws(()=>parseQwenTranscript(data,30,model),SourceUnavailable);
});

test('an ambiguous submission is not automatically retried and unsafe API destinations receive no credential',async()=>{
  const f=await fixture();let submits=0,calls=0;
  try{
    const cloud=new QwenAsr(f.config,{checkDestination:async()=>{},fetch:async(input)=>{
      const url=String(input);if(url.includes('/uploads?'))return json({data:policy});if(url===policy.upload_host)return new Response('',{status:200});
      submits++;throw new Error('request failed');
    }});
    await assert.rejects(cloud.transcribe(f.audio,30),error=>error instanceof SourceUnavailable&&error.reason==='ASR_SUBMISSION_UNKNOWN');assert.equal(submits,1);
    f.config.qwenAsr!.baseUrl='https://other.example/api/v1';
    await assert.rejects(new QwenAsr(f.config,{fetch:async()=>{calls++;return json({});}}).transcribe(f.audio,30),error=>error instanceof SourceUnavailable&&error.reason==='ASR_UNAVAILABLE');assert.equal(calls,0);
  }finally{await f.close();}
});

test('cloud credentials choose Qwen automatically and never reach media tools or browser child processes',async()=>{
  const cfg=loadConfig({AGENT_BUBBLE_TOKEN:'test-token-longer-than-24-characters',DEEPSEEK_API_KEY:'summary-test-key',DASHSCOPE_API_KEY:'sk-ws-test.private.key'});
  assert.equal(cfg.video?.asrProvider,'qwen');assert.equal(cfg.qwenAsr?.model,model);
  const old=process.env.DASHSCOPE_API_KEY;process.env.DASHSCOPE_API_KEY='test-child-secret';
  try{assert.equal(browserEnvironment().DASHSCOPE_API_KEY,undefined);
    const output=await runMediaProcess(process.execPath,['-e','process.stdout.write(process.env.DASHSCOPE_API_KEY || "stripped")'],{timeoutMs:10000});assert.equal(output.stdout,'stripped');
  }finally{if(old===undefined)delete process.env.DASHSCOPE_API_KEY;else process.env.DASHSCOPE_API_KEY=old;}
});
