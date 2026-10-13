const $ = id => document.getElementById(id);
const statusLabels = {queued:'已接收',running:'处理中',completed:'已完成',needs_input:'需要补充内容',failed:'处理失败',cancelled:'已停止',interrupted:'已中断'};
let token = sessionStorage.getItem('bubble-token') || '';
let kind = 'url', currentId = null, current = null, pending = null;
let previousThreadSignature = '';
let websiteLogin = null;
const busy = status => status === 'queued' || status === 'running';
async function api(path, body) {
  const response = await fetch('/api/' + path,{method:body ? 'POST' : 'GET',headers:{authorization:'Bearer ' + token,...(body ? {'content-type':'application/json'} : {})},...(body ? {body:JSON.stringify(body)} : {})});
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || '连接失败');
  return data;
}
function error(message) { $('error').textContent = message || ''; $('error').hidden = !message; }
function openSettings() { $('token').value = token; $('settings-error').hidden = true; if(!$('settings').open)$('settings').showModal(); refreshLogin().catch(e=>error(e.message)); }
$('settings-button').onclick = openSettings;
$('save-settings').onclick = async () => {
  token = $('token').value.trim();
  try { const health = await api('health'); sessionStorage.setItem('bubble-token',token); $('connection').textContent = health.model; $('connection').classList.add('connected'); $('settings').close(); error(''); await refresh(); await refreshLogin(); }
  catch (e) { $('settings-error').textContent = e.message; $('settings-error').hidden = false; }
};
function renderLogin(status){
  websiteLogin=status;$('website-login-panel').hidden=!status.enabled;
  const active=status.state!=='idle';
  $('zhihu-login').disabled=active;$('wechat-login').disabled=active;
  $('finish-website-login').hidden=!active;
  $('finish-website-login').disabled=['opening','closing'].includes(status.state);
  $('website-login-status').textContent=active?'请在弹出的窗口完成登录或验证，随后关闭整个窗口。新任务会等待登录窗口关闭。':'可以随时重新登录。是否需要更新会话，会在读取文章时检查；窗口关闭不代表登录一定成功。';
  updateLoginAction();
}
function updateLoginAction(){const last=current?.tasks.at(-1);$('website-login').hidden=websiteLogin?.enabled===false||!current?.loginSite||!['AUTH_REQUIRED','VERIFICATION_REQUIRED','ACCESS_DENIED','LOGIN_IN_PROGRESS'].includes(last?.errorCode);}
async function refreshLogin(){if(token)renderLogin(await api('article-browser/login'));}
async function startWebsiteLogin(site){
  openSettings();$('zhihu-login').disabled=true;$('wechat-login').disabled=true;
  $('website-login-status').textContent='正在打开登录窗口…';
  try {renderLogin(await api('article-browser/login',{site}));error('');}
  catch(e){error(e.message);await refreshLogin().catch(()=>{});$('website-login-status').textContent=e.message;}
}
$('zhihu-login').onclick=()=>startWebsiteLogin('zhihu');
$('wechat-login').onclick=()=>startWebsiteLogin('wechat');
$('finish-website-login').onclick=async()=>{try{renderLogin(await api('article-browser/login/finish',{}));await refresh();}catch(e){error(e.message);$('website-login-status').textContent=e.message;}};
$('website-login').onclick=()=>startWebsiteLogin(current.loginSite);
for (const button of document.querySelectorAll('[data-kind]')) button.onclick = () => {
  kind = button.dataset.kind;
  for (const item of document.querySelectorAll('[data-kind]')) item.classList.toggle('selected',item === button);
  $('source').placeholder = kind === 'url' ? '粘贴分享链接，也可以包含分享文案' : kind === 'transcript' ? '粘贴 SRT / VTT 字幕或转写文本' : '粘贴文章正文';
};
$('new-task').onclick = () => { currentId = null; current = null; pending = null; $('submit').dataset.supplement = ''; $('composer').hidden = false; $('thread').hidden = true; $('title').textContent = '读懂眼前的内容'; $('submit').textContent = '交给 Agent ↗'; error(''); };
async function submit(follow = false, supplement = false) {
  const button = follow ? $('follow-submit') : $('submit');
  const message = follow ? $('follow-up').value.trim() : $('instruction').value.trim();
  if (!message || (!follow && !$('source').value.trim())) return error('请提供内容与任务要求');
  button.disabled = true;
  try {
    const payload = {clientRequestId:crypto.randomUUID(),message,...(follow || supplement ? {conversationId:currentId} : {}),...(!follow ? {source:{kind,value:$('source').value.trim()}} : {})};
    pending ||= payload;
    const task = await api('tasks',pending);
    pending = null; currentId = task.conversationId; previousThreadSignature = '';
    $('follow-up').value = ''; $('composer').hidden = true; $('thread').hidden = false; error(''); await refresh();
  } catch (e) { error(e.message + '。保留本次提交，可重试。'); }
  finally { button.disabled = false; }
}
$('submit').onclick = () => submit(false,$('submit').dataset.supplement === 'true');
$('follow-submit').onclick = () => submit(true);
$('cancel').onclick = async () => { try { await api('tasks/' + current.tasks.at(-1).id + '/cancel',{}); await refresh(); } catch(e) { error(e.message); } };
$('retry').onclick = async () => { $('follow-up').value = current.tasks.at(-1).message; await submit(true); };
$('supplement').onclick = () => { $('composer').hidden = false; $('thread').hidden = true; $('submit').dataset.supplement = 'true'; $('submit').textContent = '补充内容并继续 ↗'; $('source').value = ''; document.querySelector('[data-kind="transcript"]').click(); };
function element(tag, className, text) { const item = document.createElement(tag); if(className) item.className = className; if(text != null) item.textContent = text; return item; }
function renderThread(conversation) {
  const signature = JSON.stringify(conversation);
  if (signature === previousThreadSignature) return;
  previousThreadSignature = signature; current = conversation;
  $('title').textContent = conversation.title; $('source-card').replaceChildren();
  if (conversation.source) {
    const source = conversation.source;
    const basis = source.method === 'audio_transcription' ? (source.transcriptionProvider==='qwen'?'Qwen 音频转写':'本地音频转写') : source.method === 'subtitles' ? '平台字幕' : source.kind === 'video' ? '字幕 / 转写' : '正文';
    $('source-card').append(element('strong','',source.title),element('div','muted',`${basis} · ${source.characters.toLocaleString()} 字符 · 已保存，可继续追问`));
    if(source.url) { const link = element('a','', '打开原始来源 ↗'); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; $('source-card').append(link); }
  } else $('source-card').append(element('div','muted','来源尚未取得'));
  const messages = [];
  for(const task of conversation.tasks) {
    messages.push(element('div','message user',task.message));
    const answer = element('article','message'); answer.append(element('div','message-label',`AGENT · ${statusLabels[task.status] || task.status}`));
    answer.append(element('pre',task.result ? '' : 'status',task.result || task.error || task.progress));
    if (task.result) {
      const download = element('button','download','保存 Markdown');
      download.onclick = async () => {
        const response = await fetch(`/api/tasks/${task.id}/result.md`,{headers:{authorization:'Bearer ' + token}});
        if(!response.ok) return error('下载失败');
        const url = URL.createObjectURL(await response.blob()); const link = element('a');link.href = url;link.download = task.id + '.md';link.click();setTimeout(() => URL.revokeObjectURL(url),1000);
      }; answer.append(download);
      const saved=task.memorySave;
      if(saved?.status==='saved')answer.append(element('div','muted',`已保存到知识库 · ${saved.uri}`));
      else if(saved?.status==='saving')answer.append(element('div','muted','正在保存到知识库…'));
      else if(saved?.status==='failed'){
        answer.append(element('div','status',saved.error||'知识库保存失败，本次结果已保留'));
        const retryMemory=element('button','download','重试保存到知识库');
        retryMemory.onclick=async()=>{retryMemory.disabled=true;try{await api(`tasks/${task.id}/memory/retry`,{});await refresh();}catch(e){error(e.message);retryMemory.disabled=false;}};
        answer.append(retryMemory);
      }
    }
    messages.push(answer);
  }
  $('messages').replaceChildren(...messages);
  const last = conversation.tasks.at(-1);
  $('cancel').hidden = !last || !busy(last.status);
  $('retry').hidden = !last || !['failed','interrupted','cancelled','needs_input'].includes(last.status);
  $('supplement').hidden = last?.status !== 'needs_input';
  updateLoginAction();
}
async function refresh() {
  if (!token) return;
  const conversations = await api('conversations');
  const buttons = conversations.map(conversation => {
    const button = element('button','conversation' + (currentId === conversation.id ? ' active' : ''));
    button.append(element('strong','',conversation.title),element('small','',statusLabels[conversation.latestTask?.status] || ''));
    button.onclick = async () => { currentId = conversation.id; pending = null; $('composer').hidden = true; $('thread').hidden = false; previousThreadSignature = ''; await refresh(); }; return button;
  });
  $('conversations').replaceChildren(...buttons);
  if(currentId) renderThread(await api('conversations/' + currentId));
}
if(token) {
  api('health').then(async health => { $('connection').textContent = health.model; $('connection').classList.add('connected'); await refresh(); await refreshLogin(); }).catch(e => { error(e.message); openSettings(); });
} else openSettings();
setInterval(() => { if(!document.hidden && token){refresh().catch(e => error(e.message));if($('settings').open)refreshLogin().catch(e=>error(e.message));} },3000);
