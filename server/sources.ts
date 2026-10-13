import { createHash,randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import {ArticleReader,extractArticle} from './articles.js';
import {ArticleBrowser,type ArticleLoginSite,type ArticleLoginStatus} from './article-browser.js';
import type { Config } from './config.js';
import { fetchPublic, publicUrl } from './network.js';
import { SourceUnavailable, type SourceDocument, type SourceInput, type SourceSummary } from './types.js';
import {parseCaptions,transcriptText} from './captions.js';
import {VideoReader,videoUrl} from './video.js';
import {bilibiliSessionVersion} from './bilibili-session.js';
export {parseCaptions,timestamp} from './captions.js';

export function sharedUrl(value: string): string {
  const matched = value.match(/https?:\/\/[^\s<>"“”]+/i);
  if (!matched) throw new SourceUnavailable('分享内容里没有网页链接；可以直接粘贴正文');
  return matched[0].replace(/[)）\]】。,，;；!！]+$/u,'');
}
export function sourceSummary(source: SourceDocument): SourceSummary {
  const { text,segments,...metadata } = source;
  return { ...metadata,characters:text.length,segmentCount:segments?.length ?? 0 };
}
export {extractArticle};

export class SourceRepository {
  readonly directory: string;
  private browser?:ArticleBrowser;
  private articles:ArticleReader;
  private videos:VideoReader;
  constructor(private config: Config,videoReader?:VideoReader) {
    this.directory = join(config.dataDir,'sources');
    if(config.articleBrowser?.enabled) this.browser=new ArticleBrowser(config.articleBrowser);
    this.articles=new ArticleReader({fetchPage:fetchPublic,renderPage:this.browser?(url,signal)=>this.browser!.read(url,signal):undefined});
    this.videos=videoReader??new VideoReader(config);
  }
  async close():Promise<void>{await this.browser?.close();}
  loginStatus():ArticleLoginStatus{return this.browser?.loginStatus()??{enabled:false,state:'idle',site:null,lastClosedAt:null};}
  loginSite(input:SourceInput):ArticleLoginSite|null{
    if(input.kind!=='url')return null;
    try{const host=new URL(sharedUrl(input.value)).hostname;return host==='zhihu.com'||host.endsWith('.zhihu.com')?'zhihu':host==='mp.weixin.qq.com'?'wechat':null;}catch{return null;}
  }
  async openLogin(site:ArticleLoginSite,onClosed:()=>void):Promise<ArticleLoginStatus>{
    if(!this.browser)throw new SourceUnavailable('后台没有启用文章浏览器','READER_UNAVAILABLE');
    return this.browser.openLogin(site,onClosed);
  }
  async finishLogin():Promise<ArticleLoginStatus>{await this.browser?.finishLogin();return this.loginStatus();}
  async get(id: string): Promise<SourceDocument | null> {
    if (!/^[a-f0-9]{64}$/.test(id)) return null;
    try { return JSON.parse(await readFile(join(this.directory,id + '.json'),'utf8')) as SourceDocument; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async acquire(input: SourceInput, signal?: AbortSignal,onProgress?:(message:string)=>void): Promise<SourceDocument> {
    let value = input.kind === 'url' ? sharedUrl(input.value) : input.value.trim();
    if(input.kind==='url'){
      // Canonical BV/av + P permits cache reuse across tracking/share variants.
      let parsed:URL;
      try{parsed=new URL(value);}catch{throw new SourceUnavailable('请提供有效的网页链接');}
      if(parsed.hostname==='b23.tv'||parsed.hostname.endsWith('.b23.tv'))value=await resolveBilibiliShare(value,signal);
      const host=new URL(value).hostname;
      if(host==='bilibili.com'||host.endsWith('.bilibili.com'))value=videoUrl(value).url;
    }
    const id = createHash('sha256').update(JSON.stringify({ ...input,value })).digest('hex');
    const prior = await this.get(id);
    if(prior){
      if(prior.method==='audio_transcription'&&input.kind==='url'&&new URL(value).hostname==='www.bilibili.com'){
        const session=await bilibiliSessionVersion(this.config);
        const marker=join(this.directory,id+'.caption-session');
        if(session&&await readFile(marker,'utf8').catch(()=>'')!==session){
          onProgress?.('检测到新的 B 站登录状态，优先检查平台字幕');
          try{
            const refreshed=await this.videos.read(value,signal,onProgress,prior);
            if(refreshed.method==='subtitles'){
              const source={...refreshed,id,fetchedAt:new Date().toISOString()};
              if(source.text.length>300000)throw new SourceUnavailable('内容超过首版处理范围，请提供较短的片段');
              signal?.throwIfAborted();
              const archive=join(this.directory,'archive');await mkdir(archive,{recursive:true});
              await writeFile(join(archive,id+'.'+randomUUID()+'.json'),JSON.stringify(prior),'utf8');
              await this.save(source);await writeFile(marker,session,'utf8');return source;
            }
          }catch{signal?.throwIfAborted();onProgress?.('字幕检查暂时失败，复用已保存的转写');}
          await writeFile(marker,session,'utf8');
        }
      }
      return prior;
    }
    let source: SourceDocument;
    const common = { id,fetchedAt:new Date().toISOString() };
    if (input.kind === 'text') source = { ...common,kind:'text',title:input.title || '分享的正文',url:input.originalUrl,text:value,method:'shared_text' };
    else if (input.kind === 'transcript') {
      const segments = parseCaptions(value);
      source = { ...common,kind:'video',title:input.title || '分享的字幕',url:input.originalUrl,text:segments.length ? transcriptText(segments) : value,
        method:'shared_transcript',segments };
    } else {
      let url = await publicUrl(value);
      if (url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com')) source = { ...common,...await this.videos.read(url.href,signal,onProgress) };
      else {
        const article=await this.articles.read(url.href,signal,onProgress);
        source = { ...common,...article,kind:'article' };
      }
    }
    signal?.throwIfAborted();
    if (source.text.length > 300000) throw new SourceUnavailable('内容超过首版处理范围，请提供较短的片段');
    await this.save(source);
    return source;
  }
  private async save(source:SourceDocument):Promise<void>{
    await mkdir(this.directory,{recursive:true});
    const path = join(this.directory,source.id + '.json');
    const temporary=path+'.'+randomUUID()+'.tmp';
    await writeFile(temporary,JSON.stringify(source),'utf8');
    await rename(temporary,path);
  }
}

async function resolveBilibiliShare(input:string,signal?:AbortSignal):Promise<string>{
  let next=input;
  for(let attempt=0;attempt<6;attempt++){
    const url=await publicUrl(next);
    if(url.hostname==='bilibili.com'||url.hostname.endsWith('.bilibili.com'))return videoUrl(url.href).url;
    if(url.hostname!=='b23.tv'&&!url.hostname.endsWith('.b23.tv'))throw new SourceUnavailable('B 站短链接未指向视频页面，请复制完整 BV 链接','VIDEO_UNSUPPORTED');
    let response:Response;
    try{response=await fetch(url,{redirect:'manual',signal:AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])]),headers:{'user-agent':'Mozilla/5.0'}});}
    catch{signal?.throwIfAborted();throw new SourceUnavailable('B 站短链接解析暂时失败，请重试或提供完整 BV 链接','HTTP_TRANSIENT');}
    await response.body?.cancel();
    const location=response.headers.get('location');
    if(response.status<300||response.status>=400||!location)throw new SourceUnavailable('B 站短链接没有返回视频地址，请提供完整 BV 链接','CONTENT_UNAVAILABLE');
    next=new URL(location,url).href;
  }
  throw new SourceUnavailable('B 站短链接重定向过多，请复制完整 BV 链接','VIDEO_UNSUPPORTED');
}
