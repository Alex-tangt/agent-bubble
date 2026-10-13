import { randomUUID } from 'node:crypto';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import type { Task } from '../server/types.js';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const config = loadConfig();
const liveConfig = {...config,dataDir:config.dataDir + '-smoke'};
let { app,store } = createApp(liveConfig);
const headers = {authorization:'Bearer ' + config.token};
async function waitTask(id: string): Promise<Task> {
  const started = Date.now();
  while (Date.now() - started < 180000) {
    const response = await app.inject({url:'/api/tasks/' + id,headers});
    const task = response.json<Task>();
    if (!['queued','running'].includes(task.status)) return task;
    await new Promise(resolve => setTimeout(resolve,500));
  }
  throw new Error('Smoke test timed out');
}
try {
  const accepted = await app.inject({method:'POST',url:'/api/tasks',headers,payload:{clientRequestId:randomUUID(),message:'用中文总结本文，不超过 150 字。保留重要数值。',
    source:{kind:'text',title:'离线会议记录样本',value:'团队计划在 11 月上线阅读助手。首版支持文章正文和视频字幕总结，安卓端通过分享链接提交任务。后台服务使用现成 Agent 内核，手机断网后已接收任务继续执行。结果保留原文链接与字幕时间戳。试用范围为 12 人，每人每天预计提交 3 次任务。首周只测试文章总结，第二周加入字幕与结果追问。部署在个人常开主机，模型使用 DeepSeek Flash API。'}}});
  if (accepted.statusCode !== 202) throw new Error('Submit failed: ' + accepted.statusCode);
  const first = await waitTask(accepted.json<Task>().id);
  if (first.status !== 'completed' || !first.result?.includes('12')) throw new Error('Summary failed: ' + first.status + ' ' + first.error);
  const sessionFile = store.getConversation(first.conversationId)?.sessionFile;
  assert.ok(sessionFile, 'Pi session was not persisted');
  await app.close();
  ({app,store} = createApp(liveConfig));
  assert.equal(store.getConversation(first.conversationId)?.sessionFile,sessionFile);
  const follow = await app.inject({method:'POST',url:'/api/tasks',headers,payload:{clientRequestId:randomUUID(),conversationId:first.conversationId,message:'根据刚才的会议记录，试用用户每天预计合计提交多少次任务？只回答数值和计算。'}});
  const second = await waitTask(follow.json<Task>().id);
  if (second.status !== 'completed' || !second.result?.includes('36')) throw new Error('Follow-up failed: ' + second.status + ' ' + second.error);
  const videoInput = {clientRequestId:randomUUID(),message:'按时间点总结这份视频字幕，不超过 160 字。不要推断画面。',source:{kind:'transcript',title:'安卓阅读助手字幕测试',value:'1\n00:00:03,000 --> 00:00:08,000\n欢迎讨论个人阅读助手，手机的职责是分享来源与显示结果。\n\n2\n00:00:18,000 --> 00:00:24,000\n后台采用现成 Pi 内核处理上下文和工具调用，任务保存在 SQLite。\n\n3\n00:00:42,000 --> 00:00:48,000\n没有拿到视频字幕时请补充内容，不要把标题当成完整视频总结。'}};
  const receipt = await app.inject({method:'POST',url:'/api/tasks',headers,payload:videoInput});
  const video = await waitTask(receipt.json<Task>().id);
  assert.equal(video.status,'completed',video.error ?? undefined);
  assert.match(video.result!, /0:03|00:03/);
  assert.match(video.result!, /0:18|00:18/);
  const articleReceipt = await app.inject({method:'POST',url:'/api/tasks',headers,payload:{clientRequestId:randomUUID(),message:'用中文总结文章，不超过 180 字，附来源链接。',source:{kind:'url',value:'https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model/Introduction'}}});
  const article = await waitTask(articleReceipt.json<Task>().id);
  assert.equal(article.status,'completed',article.error ?? undefined);
  const articleSource = (await app.inject({url:'/api/conversations/' + article.conversationId,headers})).json().source;
  assert.equal(articleSource.method,'readability');
  const report = {testedAt:new Date().toISOString(),model:config.model,sessionReloaded:true,summary:first.result,followUp:second.result,video:video.result,
    article:{title:articleSource.title,characters:articleSource.characters,result:article.result},usage:[first.usage,second.usage,video.usage,article.usage]};
  await writeFile(join(liveConfig.dataDir,'live-test-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { await app.close(); }
