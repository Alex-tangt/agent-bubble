import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticleReader,extractArticle} from '../articles.js';
import {SourceUnavailable} from '../types.js';

const prose='正文讨论个人阅读助手如何保存来源、在后台执行总结，并在收到结果后继续对话。'.repeat(8);
test('platform article containers preserve all paragraphs without recommendations',()=>{
 for(const [url,container,title] of [
  ['https://mp.weixin.qq.com/s/example','js_content','公众号文章'],
  ['https://zhuanlan.zhihu.com/p/123','RichText ztext','知乎文章'],
  ['https://36kr.com/p/123','articleDetail-content','36氪文章'],
 ]) {
  const attribute=container==='js_content'?`id="${container}"`:`class="${container}"`;
  const html=`<html><head><title>${title}</title></head><body><nav>登录 搜索</nav><h1>${title}</h1><div ${attribute}><p>${prose}</p><p>最后一段验收标记。</p></div><aside>${'推荐文章和广告。'.repeat(100)}</aside></body></html>`;
  const source=extractArticle(html,url!);
  assert.ok(source.text.includes(prose));assert.ok(source.text.includes('最后一段验收标记。'));
  assert.ok(!source.text.includes('推荐文章和广告'));assert.equal(source.title,title);
 }
});
test('browser fallback receives the original URL and returns complete article data',async()=>{
 let calls=0;
 const reader=new ArticleReader({fetchPage:async()=>({text:'<html><body>正在进行安全检测</body></html>',url:'https://36kr.com/p/123',contentType:'text/html'}),
  renderPage:async(url)=>{calls++;return {text:`<html><h1>完整文章</h1><div class="articleDetail-content"><p>${prose}</p><p>文章结尾。</p></div></html>`,url,contentType:'text/html'};}});
 const source=await reader.read('https://36kr.com/p/123');
 assert.equal(calls,1);assert.equal(source.method,'browser_readability');assert.ok(source.text.endsWith('文章结尾。'));
});
test('verification pages produce a structured error instead of readable content',async()=>{
 const reader=new ArticleReader({fetchPage:async()=>({text:'<html><body>当前环境异常，完成验证后即可继续访问。去验证</body></html>',url:'https://mp.weixin.qq.com/s/example',contentType:'text/html'}),
  renderPage:async()=>({text:'<html><body>当前环境异常，完成验证后即可继续访问。去验证</body></html>',url:'https://mp.weixin.qq.com/s/example',contentType:'text/html'})});
 await assert.rejects(reader.read('https://mp.weixin.qq.com/s/example'),error=>error instanceof Error && 'reason' in error && error.reason==='VERIFICATION_REQUIRED');
});
test('cancellation during fetching does not launch a browser or classify as missing content',async()=>{
 const controller=new AbortController();let renders=0;
 const reader=new ArticleReader({fetchPage:async()=>{controller.abort('cancelled');controller.signal.throwIfAborted();throw Error('unreachable');},renderPage:async()=>{renders++;throw Error('unreachable');}});
 await assert.rejects(reader.read('https://example.org/article',controller.signal));assert.equal(renders,0);
});
test('partially rendered 36kr article is rejected before it can be cached or summarized',()=>{
 const html=`<html><h1>文章正在加载</h1><div class="article-content"><p>${prose}</p><p>这些场景共享三个</p></div></html>`;
 assert.throws(()=>extractArticle(html,'https://36kr.com/p/123'),error=>error instanceof Error&&'reason'in error&&error.reason==='CONTENT_INCOMPLETE');
});
test('HTTP rate limiting never falls back to a browser',async()=>{
 let renders=0;
 const reader=new ArticleReader({fetchPage:async()=>{throw new SourceUnavailable('访问过于频繁','RATE_LIMITED');},renderPage:async()=>{renders++;throw Error('unreachable');}});
 await assert.rejects(reader.read('https://example.org/article'));assert.equal(renders,0);
});
test('transient fetching failure retries once and succeeds without rendering',async()=>{
 let fetches=0,renders=0;
 const reader=new ArticleReader({fetchPage:async url=>{
  if(++fetches===1) throw new SourceUnavailable('暂时连接失败','HTTP_TRANSIENT');
  return {text:`<html><article><h1>文章</h1><p>${prose}</p></article></html>`,url,contentType:'text/html'};
 },renderPage:async()=>{renders++;throw Error('unreachable');}});
 const source=await reader.read('https://example.org/article');
 assert.equal(fetches,2);assert.equal(renders,0);assert.ok(source.text.includes(prose));
});
test('exhausted transient retry preserves its error and does not open a browser',async()=>{
 let fetches=0,renders=0;
 const reader=new ArticleReader({fetchPage:async()=>{fetches++;throw new SourceUnavailable('网站暂时不可用','HTTP_TRANSIENT');},renderPage:async()=>{renders++;throw Error('unreachable');}});
 await assert.rejects(reader.read('https://example.org/article'),error=>error instanceof SourceUnavailable&&error.reason==='HTTP_TRANSIENT');
 assert.equal(fetches,2);assert.equal(renders,0);
});
test('cancellation during retry backoff prevents the next request',async()=>{
 const controller=new AbortController();let fetches=0;
 const reader=new ArticleReader({fetchPage:async()=>{fetches++;throw new SourceUnavailable('网站暂时不可用','HTTP_TRANSIENT');}});
 await assert.rejects(reader.read('https://example.org/article',controller.signal,message=>{if(message.includes('重试'))controller.abort('cancelled');}));
 assert.equal(fetches,1);
});
