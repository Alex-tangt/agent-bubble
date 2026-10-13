import {JSDOM} from 'jsdom';
import {Readability} from '@mozilla/readability';
import {fetchPublic} from './network.js';
import {SourceUnavailable} from './types.js';
import {setTimeout as delay} from 'node:timers/promises';

export type ArticlePage={text:string;url:string;contentType:string};
export type ArticleDocument={title:string;text:string;url:string;method:'readability'|'browser_readability'};
export type PageLoader=(url:string,signal?:AbortSignal)=>Promise<ArticlePage>;
export const articleSelectors='.Post-RichTextContainer .RichText, .RichText.ztext, #js_content, .articleDetail-content, .article-content';

function textOf(element:Element):string {
 const clone=element.cloneNode(true) as Element;
 clone.querySelectorAll('script,style,noscript,nav,aside,footer,.recommend-list,.recommend-article').forEach(n=>n.remove());
 clone.querySelectorAll('br').forEach(n=>n.replaceWith('\n'));
 clone.querySelectorAll('p,div,section,h1,h2,h3,h4,li,tr,blockquote,pre').forEach(n=>n.append('\n\n'));
 return (clone.textContent??'').replace(/[ \t]+\n/g,'\n').replace(/\n[ \t]*\n+/g,'\n\n').trim();
}
function unavailable(document:Document,url:string):SourceUnavailable {
 const host=new URL(url).hostname;
 const body=textOf(document.body).slice(0,6000);
 if(/当前环境异常|完成验证后|去验证|验证码|安全验证|正在进行安全检测/.test(body)) return new SourceUnavailable(`${host} 要求访问验证，请在项目专用浏览器完成验证后重试`,'VERIFICATION_REQUIRED');
 if(/您当前请求存在异常|暂时限制本次访问|40362|访问过于频繁/.test(body)) return new SourceUnavailable(`${host} 暂时限制当前访问，请在项目专用浏览器检查页面后重试`,'ACCESS_DENIED');
 if(/登录后.*(?:查看|阅读)|请先登录|sign in to (?:read|continue)/i.test(body)||/\/signin|\/login/.test(new URL(url).pathname)) return new SourceUnavailable(`${host} 要求登录，请在项目专用浏览器登录后重试`,'AUTH_REQUIRED');
 return new SourceUnavailable('没有取得完整文章正文，请检查文章是否仍可访问','CONTENT_UNAVAILABLE');
}
export function extractArticle(html:string,url:string):{title:string;text:string} {
 const dom=new JSDOM(html,{url});
 try {
  const d=dom.window.document;
  const host=new URL(url).hostname;
  const selectors=host==='mp.weixin.qq.com'?['#js_content']:host==='zhuanlan.zhihu.com'||host.endsWith('.zhihu.com')?['.Post-RichTextContainer .RichText','.RichText.ztext']:host==='36kr.com'||host.endsWith('.36kr.com')?['.articleDetail-content','.article-content']:[];
  for(const selector of selectors) {
   const node=d.querySelector(selector); if(!node) continue;
   const text=textOf(node);if(text.length<120) continue;
   if((host==='36kr.com'||host.endsWith('.36kr.com'))&&selector==='.article-content'&&!text.includes('该文观点仅代表作者本人')) throw new SourceUnavailable('36氪正文尚未加载完整，请稍后重试','CONTENT_INCOMPLETE');
   const title=(d.querySelector('#activity-name,h1')?.textContent||d.querySelector('meta[property="og:title"]')?.getAttribute('content')||d.title||host).trim();
   return {title,text};
  }
  const problem=unavailable(d,url);
  if(problem.reason!=='CONTENT_UNAVAILABLE') throw problem;
  const article=new Readability(d).parse();
  const text=article?.textContent?.replace(/\n[ \t]*\n+/g,'\n\n').trim()??'';
  if(text.length<120) throw new SourceUnavailable('没有取得足够正文，页面可能需要登录；请检查来源页面','CONTENT_UNAVAILABLE');
  return {title:article?.title?.trim()||host,text};
 } finally {dom.window.close();}
}

export class ArticleReader {
 constructor(private loaders:{fetchPage:PageLoader;renderPage?:PageLoader}={fetchPage:fetchPublic}){}
 async read(url:string,signal?:AbortSignal,onProgress?:(message:string)=>void):Promise<ArticleDocument> {
  let original:unknown;
  onProgress?.('正在获取文章页面');
  try {
   let page:ArticlePage;
   try {page=await this.loaders.fetchPage(url,signal);}
   catch(error) {
    signal?.throwIfAborted();
    if(!(error instanceof SourceUnavailable)||!['HTTP_TRANSIENT','FETCH_TIMEOUT'].includes(error.reason)) throw error;
    onProgress?.('网站暂时无法连接，正在重试一次');
    await delay(500,undefined,{signal});
    page=await this.loaders.fetchPage(url,signal);
   }
   signal?.throwIfAborted();
   if(page.contentType && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(page.contentType)) throw new SourceUnavailable('该链接不是可读取的文章','UNSUPPORTED_CONTENT');
   const article=/text\/plain/.test(page.contentType)?{title:new URL(page.url).hostname,text:page.text.trim()}:extractArticle(page.text,page.url);
   if(article.text.length<120) throw new SourceUnavailable('文章正文过短','CONTENT_UNAVAILABLE');
   return {...article,url:page.url,method:'readability'};
  } catch(error) {signal?.throwIfAborted();original=error;}
  if(original instanceof SourceUnavailable&&['RATE_LIMITED','CONTENT_NOT_FOUND','UNSUPPORTED_CONTENT','HTTP_TRANSIENT','FETCH_TIMEOUT'].includes(original.reason)) throw original;
  if(!this.loaders.renderPage) throw original;
  onProgress?.('正在用浏览器读取文章正文');
  const page=await this.loaders.renderPage(url,signal);
  signal?.throwIfAborted();
  return {...extractArticle(page.text,page.url),url:page.url,method:'browser_readability'};
 }
}
