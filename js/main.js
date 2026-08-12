// ============ boot & event delegation ============

import { state, update, subscribe, todayKey } from './store.js';
import { render, Actions, Changes, applyTheme, toast } from './ui.js';
import { init as initAuto } from './auto.js';
import { initSync, schedulePush } from './sync.js';

// 本地配置注入：js/config.local.js 在 .gitignore 里，不会进仓库。
// 在自己电脑上把 API key 写进该文件，就不用每个浏览器手动填一遍；
// 线上（GitHub Pages）没有这个文件，静默跳过，去「设置」里粘贴即可。
try {
  const local = (await import('./config.local.js')).default || {};
  if (local.apiKey && !state.settings.apiKey) {
    update((s) => { s.settings.apiKey = local.apiKey; });
  }
  if (local.model && !localStorage.getItem('yaoshi.v1')) {
    update((s) => { s.settings.model = local.model; });
  }
} catch { /* 没有本地配置文件——正常 */ }

// 带钥匙的快捷方式：网址 #k=<OpenRouter Key>&gt=<GitHub 令牌>，打开一次自动写入
// 本机并清掉地址栏。公开仓库不能放密钥（会被扫描盗用、自动作废），所以钥匙只活在
// 用户桌面的快捷方式文件里；# 后面的部分浏览器不会发给任何服务器。
try {
  const hp = new URLSearchParams(location.hash.slice(1));
  const hk = hp.get('k');
  const gt = hp.get('gt');
  const wrote = [];
  if (hk && hk.startsWith('sk-') && state.settings.apiKey !== hk) wrote.push((s) => { s.settings.apiKey = hk; });
  if (gt && /^(github_pat_|ghp_)/.test(gt) && state.settings.ghToken !== gt) wrote.push((s) => { s.settings.ghToken = gt; });
  if (wrote.length) update((s) => wrote.forEach((w) => w(s)));
  if (hk || gt) history.replaceState(null, '', location.pathname + location.search);
} catch { /* hash 解析失败就当没有 */ }

applyTheme();
render();
subscribe(render);

// 任何动作抛错都不能变成「点了没反应」：捕获后 toast 出来，同步异步都兜住
function dispatch(fn, el, e) {
  const fail = (err) => { console.error(err); toast(`出错了：${err?.message || err}`); };
  try {
    const r = fn(el, e);
    if (r && typeof r.catch === 'function') r.catch(fail);
  } catch (err) { fail(err); }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = Actions[el.dataset.action];
  if (fn) dispatch(fn, el, e);
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  const fn = Changes[el.dataset.change];
  if (fn) dispatch(fn, el, e);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.querySelector('.overlay')) Actions['modal-close']();
    return;
  }
  if (e.key !== 'Enter') return;
  const el = e.target.closest('[data-enter]');
  if (!el) return;
  if (el.tagName === 'TEXTAREA' && e.shiftKey) return;
  e.preventDefault();
  const fn = Actions[el.dataset.enter];
  if (fn) dispatch(fn, el, e);
});

// re-render when the date rolls over while the app stays open
let lastDay = todayKey();
function checkDayChange() {
  if (todayKey() !== lastDay) {
    lastDay = todayKey();
    render();
  }
}
document.addEventListener('visibilitychange', checkDayChange);
window.addEventListener('focus', checkDayChange);
setInterval(checkDayChange, 60_000);

// 后台智能（auto.js 不 import ui，提示统一走这个事件）
document.addEventListener('yaoshi-toast', (e) => toast(e.detail));
initAuto();

// 云同步：启动拉一次，本地每次修改防抖推送（sync.js 内部自判有没有配令牌）
initSync();
subscribe(schedulePush);

// 计时进行中：每 30 秒重绘一次，让「已 N 分钟」走起来
setInterval(() => {
  if (state.timer && document.visibilityState === 'visible' && !document.querySelector('.overlay')) render();
}, 30_000);

// 申请「持久存储」：设备存储紧张时浏览器也不回收本站数据（被拒绝就算了，不影响使用）
if (navigator.storage?.persist) navigator.storage.persist().catch(() => { /* 无妨 */ });

if ('serviceWorker' in navigator) {
  // 顶层 await 可能让本模块在 load 事件之后才继续执行，因此不能只挂 load 监听
  const registerSW = () => navigator.serviceWorker.register('./sw.js').catch(() => { /* http or unsupported — fine */ });
  if (document.readyState === 'complete') registerSW();
  else window.addEventListener('load', registerSW);
}
