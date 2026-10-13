import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { SourceUnavailable } from './types.js';

export function privateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (ip.includes(':')) {
    if (ip.startsWith('::ffff:')) {
      const tail = ip.slice(7);
      if (isIP(tail) === 4) return privateAddress(tail);
      const pair = tail.split(':');
      if (pair.length === 2) {
        const hi = parseInt(pair[0]!,16), lo = parseInt(pair[1]!,16);
        return privateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
    }
    return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || /^ff/.test(ip);
  }
  const [a,b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31)
    || (a === 192 && b === 168) || (a === 100 && b! >= 64 && b! <= 127) || a! >= 224;
}
export async function publicUrl(input: string): Promise<URL> {
  let url: URL;
  try { url = new URL(input); } catch { throw new SourceUnavailable('请提供有效的网页链接'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port))) {
    throw new SourceUnavailable('只支持标准 HTTP/HTTPS 网页链接');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g,'');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) throw new SourceUnavailable('来源需要是公开网页');
  const addresses = await lookup(hostname, { all:true }).catch(() => { throw new SourceUnavailable('无法解析来源网站，请检查链接或稍后重试','HTTP_TRANSIENT'); });
  if (!addresses.length || addresses.some(item => privateAddress(item.address))) throw new SourceUnavailable('来源需要是公开网页');
  return url;
}
export async function fetchPublic(input: string, signal?: AbortSignal, maxBytes = 2500000): Promise<{ text:string; url:string; contentType:string }> {
  let next = input;
  for (let redirect = 0; redirect <= 5; redirect++) {
    const url = await publicUrl(next);
    const response = await fetch(url, {
      redirect:'manual',signal:AbortSignal.any([AbortSignal.timeout(25000), ...(signal ? [signal] : [])]),
      headers:{ 'user-agent':'AgentBubble/0.1 (+personal reading assistant)', accept:'text/html,application/json,text/plain,*/*;q=0.5' },
    }).catch(error => {
      signal?.throwIfAborted();
      throw new SourceUnavailable(error instanceof Error && error.name === 'TimeoutError' ? '来源网页读取超时，请稍后重试' : '来源网站连接失败，请稍后重试',error instanceof Error && error.name === 'TimeoutError' ? 'FETCH_TIMEOUT' : 'HTTP_TRANSIENT');
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new SourceUnavailable('网页重定向缺少目标地址');
      next = new URL(location,url).href;
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      const reason=response.status===429?'RATE_LIMITED':response.status===404?'CONTENT_NOT_FOUND':response.status===401?'AUTH_REQUIRED':response.status===403?'ACCESS_DENIED':response.status>=500?'HTTP_TRANSIENT':'CONTENT_UNAVAILABLE';
      throw new SourceUnavailable(`来源网站返回 ${response.status}，请检查页面访问情况或稍后重试`,reason);
    }
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maxBytes) throw new SourceUnavailable('来源内容过大，请提供正文或字幕文件');
        parts.push(part.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return { text:Buffer.concat(parts).toString('utf8'),url:url.href,contentType:response.headers.get('content-type') ?? '' };
  }
  throw new SourceUnavailable('网页重定向过多，请分享原始链接');
}
