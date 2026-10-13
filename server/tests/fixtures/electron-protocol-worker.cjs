// Transport fixture reproduces Windows GUI stdin EOF; no browser or network page is loaded.
const {createConnection}=require('node:net');const {createInterface}=require('node:readline');
const fs=require('node:fs');const path=require('node:path');
const profile=process.argv[2],port=Number(process.argv[3]),nonce=process.argv[4];
process.stdin.destroy();let reads=0;const timers=new Map();
fs.writeFileSync(path.join(profile,'fixture-meta.json'),JSON.stringify({pid:process.pid,stdinClosed:process.stdin.destroyed,providerKeyPresent:!!process.env.DEEPSEEK_API_KEY,connectionTokenPresent:!!process.env.AGENT_BUBBLE_TOKEN}));
const bad=createConnection({host:'127.0.0.1',port},()=>bad.write(JSON.stringify({event:'ready',nonce:'wrong'})+'\n'));
bad.once('close',()=>{
 const socket=createConnection({host:'127.0.0.1',port},()=>socket.write(JSON.stringify({event:'ready',nonce})+'\n'));
 const send=value=>socket.write(JSON.stringify(value)+'\n');
 createInterface({input:socket}).on('line',line=>{
  const message=JSON.parse(line);
  if(message.command==='read'){
   if(message.url.endsWith('/crash'))process.exit(2);
   const response=()=>{reads++;send({id:message.id,ok:true,page:{url:message.url,contentType:'text/html',text:'<h1>fixture</h1><p>read '+reads+'</p>'}});};
   if(message.url.endsWith('/slow'))timers.set(message.id,setTimeout(response,3000));else response();
  }
  if(message.command==='cancel'){clearTimeout(timers.get(message.targetId));timers.delete(message.targetId);}
  if(message.command==='login')send({id:message.id,ok:true});
  if(message.command==='finish_login'){send({event:'login_closed'});send({id:message.id,ok:true});}
  if(message.command==='close'){send({id:message.id,ok:true});socket.end();}
 });
 socket.on('error',()=>{});socket.once('close',()=>process.exit(0));
});
bad.on('error',()=>{});
