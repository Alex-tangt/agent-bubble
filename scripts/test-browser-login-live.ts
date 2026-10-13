import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {loadConfig} from '../server/config.js';
import {createApp} from '../server/app.js';
import {browserEnvironment} from '../server/article-browser.js';
import type {Task} from '../server/types.js';

// Actual Chrome and web controls; model is stubbed, profile contains no personal login.
const directory=resolve('data','browser-login-validation',new Date().toISOString().replace(/[:.]/g,'-'));
const config=loadConfig({...process.env,DATA_DIR:directory,ARTICLE_BROWSER_PROFILE:join(directory,'profile'),AGENT_BUBBLE_TOKEN:'login-test-'+randomUUID(),DEEPSEEK_API_KEY:'unused-test-key',ARTICLE_BROWSER_ENABLED:'true'});
let modelCalls=0;
const instance=createApp(config,{run:async()=>{modelCalls++;return {text:'队列恢复测试完成',usage:{input:0,output:0,total:0}};}});
const headers={authorization:'Bearer '+config.token};
const uiBrowser=await chromium.launch({headless:true,channel:config.articleBrowser!.channel==='chromium'?undefined:config.articleBrowser!.channel,env:browserEnvironment()});
try {
 const address=await instance.app.listen({host:'127.0.0.1',port:0});
 // Prime a real headless reader to verify that opening login releases its profile.
 const before=await instance.sources.acquire({kind:'url',value:'https://36kr.com/p/4016577580208006'},AbortSignal.timeout(180000));
 assert.ok(before.text.includes('但这不是 Eazo 的终点'));
 const page=await uiBrowser.newPage({viewport:{width:1180,height:900}});
 await page.goto(address);await page.getByLabel('连接凭据').fill(config.token);
 await page.getByRole('button',{name:'连接',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector<HTMLDialogElement>('#settings')!.open);
 await page.getByRole('button',{name:'连接设置',exact:true}).click();
 await page.locator('#website-login-panel').waitFor({state:'visible'});
 await page.getByRole('button',{name:'知乎登录 / 重新登录',exact:true}).click();
 const finish=page.getByRole('button',{name:'关闭登录窗口并继续',exact:true});
 await finish.waitFor({state:'visible'});await page.waitForFunction(()=>!(document.querySelector('#finish-website-login') as HTMLButtonElement).disabled);
 const status=(await instance.app.inject({url:'/api/article-browser/login',headers})).json();
 assert.equal(status.state,'waiting');assert.equal(status.tasksPaused,true);
 const receipt=(await instance.app.inject({method:'POST',url:'/api/tasks',headers,payload:{clientRequestId:randomUUID(),source:{kind:'text',value:'实际浏览器登录与后台队列切换测试正文。'},message:'验证恢复'}})).json<Task>();
 assert.equal(instance.store.getTask(receipt.id)?.status,'queued');assert.equal(modelCalls,0);
 await finish.click();await page.waitForFunction(()=>document.querySelector('#finish-website-login')!.hasAttribute('hidden'));
 for(let i=0;i<100&&instance.store.getTask(receipt.id)?.status!=='completed';i++)await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(instance.store.getTask(receipt.id)?.status,'completed');assert.equal(modelCalls,1);
 assert.equal(instance.sources.loginStatus().state,'idle');assert.equal(instance.runner.waitingForLogin,false);
 const after=await instance.sources.acquire({kind:'url',value:'https://36kr.com/p/4013875644682372'},AbortSignal.timeout(180000));
 assert.ok(after.text.includes('36氪平台仅提供信息存储空间服务'));
 // Fixture for the actual access-denied UI, independent of the site's availability.
 const blocked=instance.store.submit({clientRequestId:randomUUID(),source:{kind:'url',value:'https://zhuanlan.zhihu.com/p/2071183687383771052'},message:'被拦截来源的入口测试'}).task;
 instance.store.updateTask(blocked.id,{status:'needs_input',error:'来源要求登录或访问验证',errorCode:'ACCESS_DENIED'});
 instance.store.updateConversation(blocked.conversationId,{title:'访问限制入口测试'});
 await page.getByRole('button',{name:'关闭',exact:true}).click();
 await page.reload();await page.locator('.conversation').filter({hasText:'访问限制入口测试'}).first().click();
 const reopen=page.getByRole('button',{name:'登录或验证后重试',exact:true});await reopen.waitFor({state:'visible'});await reopen.click();
 await finish.waitFor({state:'visible'});await page.waitForFunction(()=>!(document.querySelector('#finish-website-login') as HTMLButtonElement).disabled);
 await finish.click();await page.waitForFunction(()=>document.querySelector('#finish-website-login')!.hasAttribute('hidden'));
 assert.equal(instance.runner.waitingForLogin,false);assert.equal(instance.store.getTask(blocked.id)?.errorCode,'ACCESS_DENIED');
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:join(directory,'website-login-mobile.png')});
 const report={testedAt:new Date().toISOString(),headlessToLoginToHeadless:true,queuedWorkResumed:true,accessFailureEntry:true,reopenedLogin:true,modelStubbed:true,modelCalls,articleCharacters:[before.text.length,after.text.length]};
 await mkdir(directory,{recursive:true});await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));console.log('Browser login report: '+join(directory,'report.json'));
} finally {await uiBrowser.close();await instance.app.close();}
