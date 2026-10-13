import {access,mkdir,mkdtemp,readFile,realpath,rm,stat,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import type {Config} from './config.js';
import {parseCaptions,transcriptText,validSegments,timestamp} from './captions.js';
import {fetchPublic,publicUrl} from './network.js';
import {MediaProcessError,runMediaProcess,type MediaProcess} from './media-process.js';
import {SourceUnavailable,type SourceDocument} from './types.js';
import {availableBilibiliCookies} from './bilibili-session.js';
import {QwenAsr,type AudioTranscript} from './qwen-asr.js';

type VideoContent=Omit<SourceDocument,'id'|'fetchedAt'>;
interface Caption {data?:string;url?:string;ext?:string}
interface AudioFormat {format_id?:string;url?:string;vcodec?:string;acodec?:string;filesize?:number;filesize_approx?:number}
interface Metadata {id?:string;title?:string;duration?:number;subtitles?:Record<string,Caption[]>;automatic_captions?:Record<string,Caption[]>;formats?:AudioFormat[];entries?:unknown[]}
export interface VideoServices {
  process:MediaProcess;
  fetchCaption:(url:string,signal?:AbortSignal)=>Promise<string>;
  checkPublicDestination:(url:string)=>Promise<void>;
  transcribeCloud:(audio:string,duration:number,signal?:AbortSignal,onProgress?:(message:string)=>void)=>Promise<AudioTranscript>;
}
export function videoUrl(input:string):{url:string;part:number} {
  const parsed=new URL(input);
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||(parsed.port&&!['80','443'].includes(parsed.port)))throw new SourceUnavailable('只支持标准 HTTP/HTTPS 视频链接','VIDEO_UNSUPPORTED');
  if(!['bilibili.com','www.bilibili.com','m.bilibili.com'].includes(parsed.hostname))throw new SourceUnavailable('请提供 B 站普通视频页面链接','VIDEO_UNSUPPORTED');
  const id=parsed.pathname.match(/^\/video\/(BV[A-Za-z0-9]{10}|av[1-9]\d*)\/?$/)?.[1];
  const rawPart=parsed.searchParams.get('p')??'1';
  const part=Number(rawPart);
  if(!id||!/^\d+$/.test(rawPart)||!Number.isSafeInteger(part)||part<1||part>1000)throw new SourceUnavailable('目前支持 BV / av 普通视频和明确的分 P 链接；请检查链接','VIDEO_UNSUPPORTED');
  return {url:`https://www.bilibili.com/video/${id}/?p=${part}`,part};
}
function errorForTool(error:unknown):SourceUnavailable {
  if(!(error instanceof MediaProcessError))return new SourceUnavailable('视频工具返回异常，请稍后重试','MEDIA_TOOL_FAILED');
  if(error.reason==='missing')return new SourceUnavailable('后端缺少视频工具，请运行媒体工具安装脚本','MEDIA_TOOL_UNAVAILABLE');
  if(error.reason==='timeout')return new SourceUnavailable('视频来源处理超时，请在原会话重试','FETCH_TIMEOUT');
  if(error.reason==='output_limit')return new SourceUnavailable('视频信息过大，请分享单个视频或选定分 P','MEDIA_TOO_LARGE');
  if(/login required|please login|not logged|cookies|sign in|会员|登录/i.test(error.stderr))return new SourceUnavailable('该视频需要有效的 B 站登录状态，请配置自己的 Cookie 或补充字幕','AUTH_REQUIRED');
  if(/HTTP Error 403|412|429|risk|restricted|访问限制/i.test(error.stderr))return new SourceUnavailable('B 站限制了本次访问，请稍后重试或补充字幕','RATE_LIMITED');
  return new SourceUnavailable('暂时无法取得视频内容，请稍后在原会话重试','HTTP_TRANSIENT');
}
function languages(subtitles:Record<string,Caption[]>):string[] {
  const score=(key:string)=>/^(zh|cmn)(-|$)/i.test(key)?0:/^ai[-_]zh/i.test(key)?1:/^en/i.test(key)?2:3;
  return Object.keys(subtitles).filter(key=>!/^danmaku$/i.test(key)).sort((a,b)=>score(a)-score(b));
}
export class VideoReader {
  private services:VideoServices;
  constructor(private config:Config,services:Partial<VideoServices>={}) {
    const cloud=new QwenAsr(config);
    this.services={process:runMediaProcess,fetchCaption:async(url,signal)=>(await fetchPublic(url,signal)).text,checkPublicDestination:async(url)=>{await publicUrl(url);},
      transcribeCloud:(audio,duration,signal,onProgress)=>cloud.transcribe(audio,duration,signal,onProgress),...services};
  }
  private command():string {
    if(this.config.ytDlpCommand!=='yt-dlp')return this.config.ytDlpCommand;
    return [resolve('.tools/python/Scripts/yt-dlp.exe'),resolve('.tools/python/bin/yt-dlp')].find(existsSync)??'yt-dlp';
  }
  private async arguments():Promise<string[]> {
    const args=['--ignore-config','--no-cache-dir','--no-colors','--no-playlist','--socket-timeout','15','--retries','1','--extractor-retries','1'];
    const cookiesFile=availableBilibiliCookies(this.config);
    if(cookiesFile){
      await access(cookiesFile).catch(()=>{throw new SourceUnavailable('配置的 B 站登录文件不存在，请检查后端设置','AUTH_REQUIRED');});
      args.push('--cookies',cookiesFile);
    }
    return args;
  }
  async read(input:string,signal?:AbortSignal,onProgress?:(message:string)=>void,cachedTranscript?:SourceDocument):Promise<VideoContent> {
    const started=performance.now();
    const timings={metadata:0,subtitles:0,download:0,transcription:0,total:0};
    signal?.throwIfAborted();
    const selected=videoUrl(input);
    const args=await this.arguments();
    onProgress?.(`正在获取视频信息与第 ${selected.part} P 字幕`);
    let probe:{stdout:string;stderr:string}|undefined;
    for(let attempt=0;attempt<2;attempt++){
      try {
        // writesubtitles triggers the extractor. Simulation keeps subtitles in metadata only.
        probe=await this.services.process(this.command(),[...args,'--dump-single-json','--skip-download','--ignore-no-formats-error','--write-subs','--sub-langs','all,-danmaku','-f','bestaudio','--',selected.url],{signal,timeoutMs:70000});
        break;
      }catch(error){
        signal?.throwIfAborted();const mapped=errorForTool(error);
        if(attempt===1||!['HTTP_TRANSIENT','FETCH_TIMEOUT'].includes(mapped.reason))throw mapped;
        onProgress?.('视频信息暂时获取失败，正在重试一次');
      }
    }
    let metadata:Metadata;
    try{metadata=JSON.parse(probe!.stdout) as Metadata;}catch{throw new SourceUnavailable('视频工具没有返回有效数据，请在原会话重试','CONTENT_INCOMPLETE');}
    if(/only the preview will be extracted|supporter-only video|仅能试看|仅支持试看/i.test(probe!.stderr))throw new SourceUnavailable('该视频只取得试看或受限内容，未将其当作完整视频处理；请提供有权访问的字幕','ACCESS_DENIED');
    if(!metadata||typeof metadata!=='object'||metadata.entries)throw new SourceUnavailable('请分享单个视频或指定分 P，首版不会遍历整个合集','VIDEO_UNSUPPORTED');
    if(typeof metadata.title!=='string'||!metadata.title.trim())throw new SourceUnavailable('没有取得视频标题，无法校验来源','CONTENT_INCOMPLETE');
    const common={kind:'video' as const,title:metadata.title,url:selected.url,videoPart:selected.part,
      durationSeconds:typeof metadata.duration==='number'&&Number.isFinite(metadata.duration)?metadata.duration:undefined};
    const tracks={...metadata.automatic_captions,...metadata.subtitles};
    timings.metadata=Math.round(performance.now()-started);
    const subtitlesStarted=performance.now();
    let captionFailed=false;
    for(const language of languages(tracks)){
      if(!Array.isArray(tracks[language]))continue;
      for(const caption of tracks[language]!){
        if(!caption.data&&!['json','srt','vtt'].includes(caption.ext??''))continue;
        onProgress?.('正在读取平台字幕');
        try{
          const content=caption.data??(caption.url?await this.services.fetchCaption(caption.url,signal):'');
          const segments=parseCaptions(content);
          if(!segments.length){captionFailed=true;continue;}
          signal?.throwIfAborted();
          timings.subtitles=Math.round(performance.now()-subtitlesStarted);timings.total=Math.round(performance.now()-started);
          return {...common,method:'subtitles',language,segments,text:transcriptText(segments),transcriptBasis:'平台字幕',processingMs:timings};
        }catch{signal?.throwIfAborted();captionFailed=true;}
      }
    }
    const fallback=/Subtitles are only available when logged in|need_login_subtitle/i.test(probe!.stderr)?'平台字幕需要登录'
      :captionFailed?'平台字幕读取失败':'没有可用平台字幕';
    timings.subtitles=Math.round(performance.now()-subtitlesStarted);
    if(cachedTranscript?.method==='audio_transcription'&&cachedTranscript.url===selected.url){
      onProgress?.('未取得可用平台字幕，复用已保存的转写');
      const {id,fetchedAt,...content}=cachedTranscript;return content;
    }
    if(!this.config.video?.asrEnabled)throw new SourceUnavailable(`${fallback}。后端未启用音频转写，请补充字幕或启用转写。`,'ASR_UNAVAILABLE');
    const settings=this.config.video;
    const provider=settings.asrProvider??'local';
    if(!common.durationSeconds||common.durationSeconds<=0)throw new SourceUnavailable('没有取得有效视频时长，未启动音频转写','CONTENT_INCOMPLETE');
    if(common.durationSeconds>settings.maxDurationSeconds)throw new SourceUnavailable(`当前分 P 超过 ${Math.floor(settings.maxDurationSeconds/60)} 分钟的转写上限，请选择较短分 P 或补充字幕`,'VIDEO_TOO_LONG');
    const audioFormats=(metadata.formats??[]).filter(format=>format.vcodec==='none'&&format.acodec&&format.acodec!=='none'&&format.url);
    if(!audioFormats.length)throw new SourceUnavailable('没有取得可下载的公开音轨，请检查视频访问权限或补充字幕','AUDIO_UNAVAILABLE');
    const format=audioFormats.at(-1)!;
    if(!format.format_id||!/^[-\w.]+$/.test(format.format_id))throw new SourceUnavailable('音轨格式无效，未启动下载','CONTENT_INCOMPLETE');
    if((format.filesize??format.filesize_approx??0)>settings.maxAudioBytes)throw new SourceUnavailable('音轨超过本次下载大小上限，请选择较短视频或补充字幕','MEDIA_TOO_LARGE');
    const audioDestination=new URL(format.url!);
    if(!/\.(bilivideo\.com|bilivideo\.cn)$/.test(audioDestination.hostname)||!['','80','443','8082','4483'].includes(audioDestination.port))throw new SourceUnavailable('音轨地址不属于支持的 B 站 CDN','AUDIO_UNAVAILABLE');
    // Bilibili CDN also uses HTTPS 8082/4483. Retain the real port for downloading,
    // while the common validator still checks scheme, credentials and public DNS.
    const publicDestination=new URL(audioDestination);publicDestination.port='';
    await this.services.checkPublicDestination(publicDestination.href);
    const python=settings.pythonCommand||[resolve('.tools/python/Scripts/python.exe'),resolve('.tools/python/bin/python')].find(existsSync)||'python';
    if(provider==='local'&&!existsSync(join(settings.modelDir,'model.bin')))throw new SourceUnavailable('本地转写模型尚未准备好，请在电脑运行 setup-asr.ps1 后在原会话重试','ASR_UNAVAILABLE');
    if(provider==='qwen'&&!this.config.qwenAsr?.apiKey)throw new SourceUnavailable('后端未配置 Qwen 转写凭据','ASR_UNAVAILABLE');
    onProgress?.(`${fallback}，改用公开音轨${provider==='qwen'?'交给 Qwen 云端转写':'在电脑本地转写'}`);
    const requestedRoot=resolve(this.config.dataDir,'video-work');await mkdir(requestedRoot,{recursive:true});
    // Normalize both sides before containment checks. Windows short TEMP paths
    // and junction-backed data directories otherwise disagree with realpath(audio).
    const root=await realpath(requestedRoot);
    const work=await mkdtemp(join(root,'job-'));
    if(!work.startsWith(root+sep))throw new Error('Invalid media workspace');
    try{
      const infoPath=join(work,'video.json');
      // Keep signed URLs/headers private and temporary. Reuse the exact selected-P metadata.
      await writeFile(infoPath,JSON.stringify({...metadata,formats:[format],url:format.url,subtitles:{},automatic_captions:{},requested_subtitles:null,requested_formats:null,requested_downloads:null}),'utf8');
      onProgress?.(`正在下载第 ${selected.part} P 音轨（${timestamp(common.durationSeconds)}）`);
      let downloaded:{stdout:string;stderr:string};
      const downloadStarted=performance.now();
      try{downloaded=await this.services.process(this.command(),[...args,'--load-info-json',infoPath,'--no-write-subs','--no-write-auto-subs','--no-progress','--no-simulate',
        '--max-filesize',String(settings.maxAudioBytes),'-f',format.format_id,'-o',join(work,'audio.%(ext)s'),'--print','after_move:filepath'],{signal,timeoutMs:300000,maxOutputBytes:100000});}
      catch(error){signal?.throwIfAborted();throw errorForTool(error);}
      const path=downloaded.stdout.trim().split(/\r?\n/).at(-1)??'';
      if(!path)throw new SourceUnavailable('没有下载到音轨，可能超过大小限制或访问失败','AUDIO_UNAVAILABLE');
      const audio=await realpath(path).catch(()=>{throw new SourceUnavailable('下载的音轨文件不可用','AUDIO_UNAVAILABLE');});
      if(!audio.startsWith(work+sep))throw new SourceUnavailable('音轨文件路径异常，未启动转写','CONTENT_INCOMPLETE');
      const audioStat=await stat(audio);
      if(!audioStat.isFile()||audioStat.size<100||audioStat.size>settings.maxAudioBytes)throw new SourceUnavailable('音轨为空或超过大小上限，未启动转写','MEDIA_TOO_LARGE');
      timings.download=Math.round(performance.now()-downloadStarted);
      const transcriptionStarted=performance.now();
      let transcript:{segments?:unknown;language?:unknown;duration?:unknown;model?:unknown;timingsMs?:AudioTranscript['timingsMs']};
      if(provider==='qwen')transcript=await this.services.transcribeCloud(audio,common.durationSeconds,signal,onProgress);
      else {
      onProgress?.('正在加载本地转写模型');
      let result:{stdout:string;stderr:string};
      try{result=await this.services.process(python,[resolve('scripts/transcribe-audio.py'),'--audio',audio,'--model-dir',settings.modelDir,'--threads',String(settings.threads)],{
        signal,timeoutMs:settings.maxRunMs,maxOutputBytes:12000000,onStderrLine:line=>{
          try{const event=JSON.parse(line);if(event.type==='progress'&&typeof event.seconds==='number'&&Number.isFinite(event.seconds))onProgress?.(`正在本地转写 ${timestamp(event.seconds)} / ${timestamp(common.durationSeconds!)}`);}catch{/* Ignore library diagnostics. */}
        }});}catch(error){
        signal?.throwIfAborted();
        if(error instanceof MediaProcessError&&error.reason==='timeout')throw new SourceUnavailable('本地转写超时，请在原会话重试或补充字幕','FETCH_TIMEOUT');
        if(error instanceof MediaProcessError&&/ASR_DEPENDENCY_MISSING|ASR_MODEL_MISSING/.test(error.stderr))throw new SourceUnavailable('本地转写依赖或模型未就绪，请运行 setup-asr.ps1','ASR_UNAVAILABLE');
        if(error instanceof MediaProcessError&&/ASR_NO_SPEECH/.test(error.stderr))throw new SourceUnavailable('音轨没有识别到有效语音，请补充字幕或转写文本','ASR_NO_SPEECH');
        throw new SourceUnavailable('本地音频转写失败，请在原会话重试或补充字幕','ASR_FAILED');
      }
      try{transcript=JSON.parse(result.stdout);}catch{throw new SourceUnavailable('转写程序没有返回有效结果','CONTENT_INCOMPLETE');}
      }
      timings.transcription=Math.round(performance.now()-transcriptionStarted);
      const segments=validSegments(transcript.segments);
      if(!segments.length)throw new SourceUnavailable('音轨没有识别到有效语音，请补充字幕','ASR_NO_SPEECH');
      if(!Array.isArray(transcript.segments)||segments.length!==transcript.segments.length||typeof transcript.duration!=='number'
        ||!Number.isFinite(transcript.duration)||Math.abs(transcript.duration-common.durationSeconds)>Math.max(3,common.durationSeconds*0.005)
        ||segments.some(segment=>segment.end>(transcript.duration as number)+1))throw new SourceUnavailable('音轨时长或转写结果不完整，未将片段当作整个视频总结','CONTENT_INCOMPLETE');
      signal?.throwIfAborted();
      onProgress?.(`${provider==='qwen'?'Qwen 云端':'本地'}转写完成，正在保存带时间戳的全文`);
      timings.total=Math.round(performance.now()-started);
      const details=Object.fromEntries(Object.entries(transcript.timingsMs??{}).filter(([key,value])=>['modelLoad','audioPreparation','recognition','upload','cloudWait'].includes(key)&&typeof value==='number'&&Number.isFinite(value)&&value>=0));
      return {...common,method:'audio_transcription',segments,text:transcriptText(segments),language:typeof transcript.language==='string'?transcript.language:undefined,
        transcriptionModel:typeof transcript.model==='string'?transcript.model:'faster-whisper',transcriptionProvider:provider,
        transcriptBasis:`${provider==='qwen'?'Qwen 云端':'本地'}音频转写（${fallback}）`,processingMs:{...timings,...details}};
    }finally{await rm(work,{recursive:true,force:true});}
  }
}
