import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {ElectronArticleBrowser} from '../article-electron-browser.js';
import {SourceUnavailable} from '../types.js';

async function fixture(run:(browser:ElectronArticleBrowser,directory:string)=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),'agent-bubble-electron-'));
 const browser=new ElectronArticleBrowser({profileDir:directory,timeoutMs:5000,executable:process.execPath,workerScript:resolve('server/tests/fixtures/electron-protocol-worker.cjs')});
 try{await run(browser,directory);}finally{await browser.close();assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));await rm(directory,{recursive:true,force:true});}
}
test('browser transport survives stdin EOF, rejects a bad handshake, reuses its worker, and strips provider credentials',async()=>{
 const key=process.env.DEEPSEEK_API_KEY,token=process.env.AGENT_BUBBLE_TOKEN;
 process.env.DEEPSEEK_API_KEY='unit-test-provider';process.env.AGENT_BUBBLE_TOKEN='unit-test-private-token';
 try{await fixture(async(browser,directory)=>{
  assert.ok((await browser.read('https://8.8.8.8/article')).text.includes('read 1'));
  const metadata=JSON.parse(await readFile(join(directory,'fixture-meta.json'),'utf8'));
  assert.equal(metadata.stdinClosed,true);assert.equal(metadata.providerKeyPresent,false);assert.equal(metadata.connectionTokenPresent,false);
  assert.ok((await browser.read('https://8.8.8.8/article')).text.includes('read 2'));
  assert.equal(JSON.parse(await readFile(join(directory,'fixture-meta.json'),'utf8')).pid,metadata.pid);
 });}finally{if(key===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=key;if(token===undefined)delete process.env.AGENT_BUBBLE_TOKEN;else process.env.AGENT_BUBBLE_TOKEN=token;}
});
test('cancelled reads settle promptly and worker failure permits a fresh acquisition',async()=>fixture(async browser=>{
 await browser.read('https://8.8.8.8/article');
 const controller=new AbortController();const started=Date.now();
 const reading=browser.read('https://8.8.8.8/slow',controller.signal);setTimeout(()=>controller.abort('test cancellation'),100);
 await assert.rejects(reading,error=>error==='test cancellation');assert.ok(Date.now()-started<2000);
 assert.ok((await browser.read('https://8.8.8.8/article')).text.includes('read 2'));
 await assert.rejects(browser.read('https://8.8.8.8/crash'),error=>error instanceof SourceUnavailable&&error.reason==='READER_UNAVAILABLE');
 assert.ok((await browser.read('https://8.8.8.8/article')).text.includes('read 1'));
}));
test('login exit reports closure once and private destinations never enter the worker',async()=>fixture(async browser=>{
 await assert.rejects(browser.read('http://127.0.0.1/article'));
 let closed=0;assert.equal((await browser.openLogin(()=>closed++)).state,'waiting');
 assert.equal((await browser.openLogin(()=>closed++)).state,'waiting');
 await assert.rejects(browser.read('https://8.8.8.8/article'),error=>error instanceof SourceUnavailable&&error.reason==='LOGIN_IN_PROGRESS');
 assert.equal((await browser.finishLogin()).state,'idle');assert.equal(closed,1);
 assert.ok(browser.loginStatus().lastClosedAt);await browser.finishLogin();assert.equal(closed,1);
 assert.ok((await browser.read('https://8.8.8.8/article')).text.includes('read 1'));
}));
