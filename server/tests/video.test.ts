import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {VideoReader,videoUrl} from '../video.js';
import {SourceRepository} from '../sources.js';
import {parseCaptions} from '../captions.js';
import {MediaProcessError,runMediaProcess,type MediaProcess} from '../media-process.js';
import type {Config} from '../config.js';
import {SourceUnavailable} from '../types.js';
import {netscapeBilibiliCookies,authenticatedBilibiliCookies,bilibiliSessionVersion} from '../bilibili-session.js';

const publicAudio='https://upos-sz-mirrorhwo1.bilivideo.com/audio-test.m4a';
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'agent-bubble-video-'));
  const modelDir=join(root,'model');await mkdir(modelDir);await writeFile(join(modelDir,'model.bin'),'fixture');
  const cfg:Config={dataDir:root,host:'127.0.0.1',port:0,token:'test-connection-token-not-production',apiKey:'test-key',model:'deepseek-flash',baseUrl:'https://api.deepseek.com/v1',ytDlpCommand:'yt-dlp',maxRunMs:30000,
    video:{maxRunMs:30000,maxDurationSeconds:3600,maxAudioBytes:1024*1024,asrEnabled:true,pythonCommand:process.execPath,modelDir,threads:1}};
  return {cfg,root,async cleanup(){assert.ok(root.startsWith(resolve(tmpdir())+sep));await rm(root,{recursive:true,force:true});}};
}
const metadata=(extra={})=>({title:'测试视频',duration:30,formats:[{format_id:'30216',url:publicAudio,vcodec:'none',acodec:'mp4a',filesize:500}],...extra});

test('video normalization preserves selected P, removes tracking, and rejects unsupported pages',()=>{
  assert.deepEqual(videoUrl('https://www.bilibili.com/video/BV1t2HQ6EEaD?vd_source=tracking&p=2'),{url:'https://www.bilibili.com/video/BV1t2HQ6EEaD/?p=2',part:2});
  assert.equal(videoUrl('https://m.bilibili.com/video/av1234').part,1);
  for(const value of ['https://www.bilibili.com/video/BV1t2HQ6EEaD?p=0','https://www.bilibili.com/video/BV1t2HQ6EEaD?p=abc','https://www.bilibili.com/bangumi/play/ep1234','https://live.bilibili.com/123'])assert.throws(()=>videoUrl(value),SourceUnavailable);
});
test('platform subtitles win over ASR, Chinese AI captions win over English, and danmaku is excluded',async()=>{
  const f=await fixture();let calls=0;
  try{
    const process:MediaProcess=async(_command,args)=>{
      calls++;assert.ok(args.includes('--write-subs'));assert.ok(args.includes('--no-playlist'));assert.ok(args.includes('all,-danmaku'));
      return {stdout:JSON.stringify(metadata({subtitles:{danmaku:[{data:'1\n00:00:01,000 --> 00:00:02,000\n弹幕'}],en:[{data:'1\n00:00:01,000 --> 00:00:02,000\nEnglish'}],'ai-zh':[{data:JSON.stringify({body:[{from:1,to:3,content:'平台中文自动字幕'}]})}]}})),stderr:''};
    };
    const result=await new VideoReader(f.cfg,{process}).read('https://www.bilibili.com/video/BV1t2HQ6EEaD');
    assert.equal(calls,1);assert.equal(result.method,'subtitles');assert.equal(result.language,'ai-zh');assert.ok(result.text.includes('平台中文自动字幕'));assert.ok(!result.text.includes('弹幕'));
  }finally{await f.cleanup();}
});

test('project login exports only Bilibili cookies and detects usable authentication without exposing values',async()=>{
  const f=await fixture();
  try{
    const cookie={domain:'.bilibili.com',path:'/',expires:Date.now()/1000+3600,httpOnly:true,secure:true,sameSite:'Lax' as const};
    const cookies=[{...cookie,name:'SESSDATA',value:'test-private-session'},{...cookie,name:'DedeUserID',value:'123'},
      {...cookie,domain:'.unrelated.example',name:'private',value:'must-not-export'}];
    assert.equal(authenticatedBilibiliCookies(cookies),true);
    assert.equal(authenticatedBilibiliCookies(cookies.filter(c=>c.name!=='SESSDATA')),false);
    assert.equal(authenticatedBilibiliCookies(cookies.map(c=>({...c,expires:1}))),false);
    const exported=netscapeBilibiliCookies(cookies);assert.ok(!exported.includes('must-not-export'));assert.ok(exported.includes('#HttpOnly_.bilibili.com'));
    assert.equal(await bilibiliSessionVersion(f.cfg),null);
    await writeFile(join(f.root,'bilibili-cookies.txt'),exported);
    const version=await bilibiliSessionVersion(f.cfg);assert.match(version!,/^[a-f0-9]{64}$/);assert.ok(!version!.includes('test-private-session'));
  }finally{await f.cleanup();}
});

test('new login upgrades a cached ASR source to subtitles and archives its original transcript',async()=>{
  const f=await fixture();let calls=0;
  try{
    const url=videoUrl('https://www.bilibili.com/video/BV1t2HQ6EEaD').url;
    const reader=new VideoReader(f.cfg,{process:async(_command,args)=>{
      calls++;assert.ok(args.includes('--cookies'));
      return {stdout:JSON.stringify(metadata({subtitles:{'ai-zh':[{data:'1\n00:00:01,000 --> 00:00:03,000\n登录后取得的字幕'}]}})),stderr:''};
    }});
    const repository=new SourceRepository(f.cfg,reader);
    const original=await repository.acquire({kind:'transcript',value:'原音频转写'});
    const {createHash}=await import('node:crypto');
    const id=createHash('sha256').update(JSON.stringify({kind:'url',value:url})).digest('hex');
    await writeFile(join(repository.directory,id+'.json'),JSON.stringify({...original,id,url,method:'audio_transcription'}));
    await writeFile(join(f.root,'bilibili-cookies.txt'),'.bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\ttest-session\n');
    const upgraded=await repository.acquire({kind:'url',value:url});
    assert.equal(upgraded.method,'subtitles');assert.ok(upgraded.text.includes('登录后取得'));assert.equal(calls,1);
    const archive=await readdir(join(repository.directory,'archive'));assert.equal(archive.length,1);
    assert.ok((await readFile(join(repository.directory,'archive',archive[0]!),'utf8')).includes('原音频转写'));
    assert.equal((await repository.acquire({kind:'url',value:url})).method,'subtitles');assert.equal(calls,1);
    await repository.close();
  }finally{await f.cleanup();}
});

test('a login refresh with unavailable subtitles reuses cached ASR and never starts another transcription',async()=>{
  const f=await fixture();let calls=0;
  try{
    const repository=new SourceRepository(f.cfg,new VideoReader(f.cfg,{process:async()=>{calls++;return {stdout:JSON.stringify(metadata()),stderr:''};}}));
    const original=await repository.acquire({kind:'transcript',value:'保留的完整转写'});
    const url=videoUrl('https://www.bilibili.com/video/BV1t2HQ6EEaD').url;
    const {createHash}=await import('node:crypto');const id=createHash('sha256').update(JSON.stringify({kind:'url',value:url})).digest('hex');
    await writeFile(join(repository.directory,id+'.json'),JSON.stringify({...original,id,url,method:'audio_transcription'}));
    await writeFile(join(f.root,'bilibili-cookies.txt'),'.bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\ttest-session\n');
    for(let i=0;i<2;i++)assert.equal((await repository.acquire({kind:'url',value:url})).text,'保留的完整转写');
    assert.equal(calls,1);await repository.close();
  }finally{await f.cleanup();}
});
test('unavailable subtitles fall back to full audio transcription, preserve P and cache once',async()=>{
  const f=await fixture();const calls:string[][]=[];const progress:string[]=[];
  try{
    const process:MediaProcess=async(_command,args,options)=>{
      calls.push(args);
      if(args.includes('--dump-single-json'))return {stdout:JSON.stringify(metadata({subtitles:{danmaku:[{data:'评论'}]}})),stderr:'Subtitles are only available when logged in'};
      if(args.includes('--load-info-json')){
        const info=JSON.parse(await readFile(args[args.indexOf('--load-info-json')+1]!,'utf8'));assert.equal(info.title,'测试视频');
        const path=args[args.indexOf('-o')+1]!.replace('%(ext)s','m4a');await writeFile(path,Buffer.alloc(500));return {stdout:path+'\n',stderr:''};
      }
      options.onStderrLine?.(JSON.stringify({type:'progress',seconds:28}));
      return {stdout:JSON.stringify({segments:[{start:0,end:2,text:'开头信息'},{start:28,end:30,text:'最后信息'}],duration:30,language:'zh',model:'test-cpu-int8'}),stderr:''};
    };
    const reader=new VideoReader(f.cfg,{process,checkPublicDestination:async()=>{}});const sources=new SourceRepository(f.cfg,reader);
    const source=await sources.acquire({kind:'url',value:'https://www.bilibili.com/video/BV1t2HQ6EEaD?p=2'},undefined,text=>progress.push(text));
    assert.equal(source.method,'audio_transcription');assert.equal(source.videoPart,2);assert.ok(source.url?.endsWith('?p=2'));assert.match(source.transcriptBasis!,/需要登录/);
    assert.ok(source.text.includes('[0:28] 最后信息'));assert.ok(progress.some(text=>text.includes('0:28 / 0:30')));
    assert.equal(calls.length,3);assert.equal((await sources.acquire({kind:'url',value:'https://www.bilibili.com/video/BV1t2HQ6EEaD?p=2&vd_source=tracking'})).id,source.id);assert.equal(calls.length,3);
    assert.deepEqual(await readdir(join(f.root,'video-work')),[]);await sources.close();
  }finally{await f.cleanup();}
});

test('configured Qwen fallback downloads audio and preserves cloud basis without invoking a local model',async()=>{
  const f=await fixture();let cloudCalls=0,localCalls=0;
  try{
    f.cfg.video!.asrProvider='qwen';f.cfg.video!.modelDir=join(f.root,'absent-model');
    f.cfg.qwenAsr={apiKey:'test-cloud-key',model:'qwen-audio-3.0-asr-flash-filetrans',baseUrl:'https://dashscope.aliyuncs.com/api/v1',pollMs:2000};
    const reader=new VideoReader(f.cfg,{checkPublicDestination:async()=>{},process:async(_command,args)=>{
      if(args.includes('--dump-single-json'))return {stdout:JSON.stringify(metadata()),stderr:''};
      if(args.includes('--load-info-json')){const path=args[args.indexOf('-o')+1]!.replace('%(ext)s','m4a');await writeFile(path,Buffer.alloc(500));return {stdout:path,stderr:''};}
      localCalls++;throw Error('Local ASR must not run');
    },transcribeCloud:async(audio,duration)=>{cloudCalls++;assert.ok((await readFile(audio)).length);assert.equal(duration,30);
      return {segments:[{start:0,end:30,text:'云端完整转写'}],duration:30,model:f.cfg.qwenAsr!.model,timingsMs:{upload:50,cloudWait:70}};
    }});
    const source=await reader.read('https://www.bilibili.com/video/BV1t2HQ6EEaD');
    assert.equal(source.transcriptionProvider,'qwen');assert.match(source.transcriptBasis!,/Qwen 云端/);assert.equal(source.processingMs?.upload,50);
    assert.equal(cloudCalls,1);assert.equal(localCalls,0);assert.deepEqual(await readdir(join(f.root,'video-work')),[]);
  }finally{await f.cleanup();}
});

test('canonical audio paths accept a junction-backed workspace but reject files outside its job',async()=>{
  const f=await fixture();let outside=false;
  try{
    const target=join(f.root,'real-data'),alias=join(f.root,'data-alias');
    await mkdir(target);await symlink(target,alias,process.platform==='win32'?'junction':'dir');
    f.cfg.dataDir=alias;
    const reader=new VideoReader(f.cfg,{checkPublicDestination:async()=>{},process:async(_command,args)=>{
      if(args.includes('--dump-single-json'))return {stdout:JSON.stringify(metadata()),stderr:''};
      if(args.includes('--load-info-json')){
        const audio=outside?join(f.root,'outside.m4a'):args[args.indexOf('-o')+1]!.replace('%(ext)s','m4a');
        await writeFile(audio,Buffer.alloc(500));return {stdout:audio,stderr:''};
      }
      return {stdout:JSON.stringify({segments:[{start:0,end:30,text:'完整转写'}],duration:30,model:'fixture'}),stderr:''};
    }});
    assert.equal((await reader.read('https://www.bilibili.com/video/BV1t2HQ6EEaD')).method,'audio_transcription');
    outside=true;
    await assert.rejects(reader.read('https://www.bilibili.com/video/BV1t2HQ6EEaD'),
      (error:unknown)=>error instanceof SourceUnavailable&&error.reason==='CONTENT_INCOMPLETE');
    assert.deepEqual(await readdir(join(target,'video-work')),[]);
  }finally{await f.cleanup();}
});
test('subtitle network failure can use audio, but missing audio and excessive duration stop before ASR',async()=>{
  const f=await fixture();
  try{
    for(const [extra,reason] of [[{duration:4000},'VIDEO_TOO_LONG'],[{formats:[]},'AUDIO_UNAVAILABLE'],[{entries:[{},{}]},'VIDEO_UNSUPPORTED']] as const){
      let calls=0;
      const reader=new VideoReader(f.cfg,{process:async()=>{calls++;return {stdout:JSON.stringify(metadata({...extra,subtitles:{zh:[{url:'https://www.bilibili.com/caption.json',ext:'json'}]}})),stderr:''};},fetchCaption:async()=>{throw Error('unavailable');}});
      await assert.rejects(reader.read('https://www.bilibili.com/video/BV1t2HQ6EEaD'),(error:unknown)=>error instanceof SourceUnavailable&&error.reason===reason);assert.equal(calls,1);
    }
  }finally{await f.cleanup();}
});
test('bad ASR duration refuses partial results and removes private media files',async()=>{
  const f=await fixture();
  try{
    const process:MediaProcess=async(_command,args)=>{
      if(args.includes('--dump-single-json'))return {stdout:JSON.stringify(metadata()),stderr:''};
      if(args.includes('--load-info-json')){const path=args[args.indexOf('-o')+1]!.replace('%(ext)s','m4a');await writeFile(path,Buffer.alloc(500));return {stdout:path,stderr:''};}
      return {stdout:JSON.stringify({duration:10,segments:[{start:0,end:5,text:'仅前十秒'}]}),stderr:''};
    };
    await assert.rejects(new VideoReader(f.cfg,{process,checkPublicDestination:async()=>{}}).read('https://www.bilibili.com/video/BV1t2HQ6EEaD'),(error:unknown)=>error instanceof SourceUnavailable&&error.reason==='CONTENT_INCOMPLETE');
    assert.deepEqual(await readdir(join(f.root,'video-work')),[]);
  }finally{await f.cleanup();}
});
test('metadata retries transient failures once without exposing signed URLs or private errors',async()=>{
  const f=await fixture();let calls=0;
  try{
    const reader=new VideoReader(f.cfg,{process:async()=>{calls++;throw new MediaProcessError('exit','network failed https://cdn.example?secret=private-cookie');}});
    await assert.rejects(reader.read('https://www.bilibili.com/video/BV1t2HQ6EEaD'),(error:unknown)=>error instanceof SourceUnavailable&&error.reason==='HTTP_TRANSIENT'&&!error.message.includes('private-cookie'));
    assert.equal(calls,2);
  }finally{await f.cleanup();}
});
test('owned media process cancellation and timeout terminate the actual subprocess',async()=>{
  const controller=new AbortController();
  const run=runMediaProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:controller.signal,timeoutMs:10000});
  setTimeout(()=>controller.abort('cancelled'),100);
  await assert.rejects(run,error=>error==='cancelled');
  await assert.rejects(runMediaProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:100}),error=>error instanceof MediaProcessError&&error.reason==='timeout');
});
test('invalid or out-of-order caption timestamps never become source evidence',()=>{
  assert.deepEqual(parseCaptions(JSON.stringify({body:[{from:-1,to:3,content:'负数'},{from:2,to:1,content:'倒序'},{from:5,to:6,content:'有效'},{from:3,to:4,content:'回退'}]})),[{start:5,end:6,text:'有效'}]);
});
test('public Bilibili CDN port 8082 is supported while arbitrary audio destinations are refused',async()=>{
  const f=await fixture();
  try{
    let checked='';
    const reader=new VideoReader(f.cfg,{process:async(_command,args)=>{
      if(args.includes('--dump-single-json'))return {stdout:JSON.stringify(metadata({formats:[{format_id:'30280',url:'https://xy.example.mcdn.bilivideo.cn:8082/audio.m4a',vcodec:'none',acodec:'mp4a'}]})),stderr:''};
      throw new MediaProcessError('exit','stop after URL validation');
    },checkPublicDestination:async url=>{checked=url;}});
    await assert.rejects(reader.read('https://www.bilibili.com/video/BV1t2HQ6EEaD'));assert.equal(new URL(checked).port,'');assert.match(checked,/bilivideo\.cn/);
    for(const url of ['https://127.0.0.1/audio.m4a','https://evil.example/audio.m4a','https://cdn.bilivideo.cn:65535/audio.m4a']){
      const blocked=new VideoReader(f.cfg,{process:async()=>({stdout:JSON.stringify(metadata({formats:[{format_id:'30280',url,vcodec:'none',acodec:'mp4a'}]})),stderr:''})});
      await assert.rejects(blocked.read('https://www.bilibili.com/video/BV1t2HQ6EEaD'),error=>error instanceof SourceUnavailable&&error.reason==='AUDIO_UNAVAILABLE');
    }
  }finally{await f.cleanup();}
});
test('preview-only playback stops before subtitle processing, downloading, or summarizing',async()=>{
  const f=await fixture();let calls=0;
  try{
    const reader=new VideoReader(f.cfg,{process:async()=>{calls++;return {stdout:JSON.stringify(metadata({subtitles:{zh:[{data:'1\n00:00:01,000 --> 00:00:03,000\n试看内容'}]}})),stderr:'This is a supporter-only video, only the preview will be extracted'};}});
    await assert.rejects(reader.read('https://www.bilibili.com/video/BV1t2HQ6EEaD'),error=>error instanceof SourceUnavailable&&error.reason==='ACCESS_DENIED');assert.equal(calls,1);
  }finally{await f.cleanup();}
});
