import {loadConfig} from '../server/config.js';
import {safeError} from '../server/runner.js';
const config=loadConfig();
const finish=process.argv.includes('--finish'),statusOnly=process.argv.includes('--status');
const site=process.argv.find(arg=>arg.startsWith('--site='))?.slice(7)??'zhihu';
if(!['zhihu','wechat'].includes(site))throw new Error('Supported --site values: zhihu, wechat');
const host=['0.0.0.0','::'].includes(config.host)?'127.0.0.1':config.host;
try {
 const response=await fetch(`http://${host.includes(':')?'['+host+']':host}:${config.port}/api/article-browser/login${finish?'/finish':''}`,{
  method:statusOnly?'GET':'POST',headers:{authorization:'Bearer '+config.token,'content-type':'application/json'},
  ...(!statusOnly?{body:JSON.stringify(finish?{}:{site})}:{}),signal:AbortSignal.timeout(90000),
 });
 const data=await response.json();if(!response.ok)throw new Error(data.message??'Login request failed');
 console.log(JSON.stringify(data));
 if(data.state==='waiting')console.log('Complete login in the project browser, then close its entire window. To exit without logging in: npm run browser:login -- --finish');
}catch(error){console.error(safeError(error,[config.apiKey,config.token]));process.exitCode=1;}
