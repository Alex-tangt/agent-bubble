import test from 'node:test';
import assert from 'node:assert/strict';
import { extractArticle,parseCaptions,sharedUrl,timestamp } from '../sources.js';
import { privateAddress,publicUrl } from '../network.js';
import { safeError } from '../runner.js';

test('article extraction keeps prose and excludes navigation/scripts',() => {
  const article = '<!doctype html><html><head><title>后台任务的边界</title></head><body><nav>订阅 登录 广告</nav><article><h1>后台任务的边界</h1>'
    + '<p>服务器保存接收回执后独立处理任务。客户端连接只用于观察进度，关闭连接不会停止服务器执行。结果和来源保存在本地目录，之后可以继续追问。</p>'.repeat(5)
    + '</article><script>stealKeys()</script></body></html>';
  const extracted = extractArticle(article,'https://example.org/article');
  assert.ok(extracted.text.includes('关闭连接不会停止'));
  assert.ok(!extracted.text.includes('stealKeys')); assert.ok(!extracted.text.includes('订阅 登录'));
  assert.throws(() => extractArticle('<html><body>请登录</body></html>','https://example.org'),/没有取得足够正文/);
});
test('SRT, VTT, and Bilibili JSON preserve timestamp evidence',() => {
  const srt = '1\n00:01:02,500 --> 00:01:04,000\n<b>第一句话</b>\n\n2\n00:02:00,000 --> 00:02:04,000\n第二句话';
  const segments = parseCaptions(srt);
  assert.equal(segments[0]?.start,62.5); assert.equal(segments[0]?.text,'第一句话'); assert.equal(segments.length,2);
  assert.equal(parseCaptions('WEBVTT\n\n00:03.000 --> 00:05.000\n你好')[0]?.start,3);
  assert.equal(parseCaptions(JSON.stringify({body:[{from:3,to:5,content:'字幕'}]}))[0]?.text,'字幕');
  assert.equal(timestamp(3662),'1:01:02');
});
test('share prose extracts links; private destinations and credentials are rejected',async () => {
  assert.equal(sharedUrl('看这个 https://b23.tv/abc123。 分享给你'),'https://b23.tv/abc123');
  for(const address of ['127.0.0.1','10.1.2.3','192.168.0.2','172.20.2.1','::1','::ffff:127.0.0.1','::ffff:c0a8:1']) assert.equal(privateAddress(address),true,address);
  assert.equal(privateAddress('8.8.8.8'),false);
  for(const url of ['http://127.0.0.1/','http://localhost/','http://user:password@example.org/','file:///etc/passwd']) await assert.rejects(publicUrl(url));
});
test('provider errors redact keys before persistence or presentation',() => {
  assert.equal(safeError(new Error('sk-abc123 secret-token'),['secret-token']),'[已隐藏] [已隐藏]');
});
