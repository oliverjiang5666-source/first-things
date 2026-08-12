// ============ boot & event delegation ============

import { state, update, subscribe, todayKey } from './store.js';
import { render, Actions, Changes, applyTheme, toast } from './ui.js';
import { init as initAuto } from './auto.js';

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

// 计时进行中：每 30 秒重绘一次，让「已 N 分钟」走起来
setInterval(() => {
  if (state.timer && document.visibilityState === 'visible' && !document.querySelector('.overlay')) render();
}, 30_000);

if ('serviceWorker' in navigator) {
  // 顶层 await 可能让本模块在 load 事件之后才继续执行，因此不能只挂 load 监听
  const registerSW = () => navigator.serviceWorker.register('./sw.js').catch(() => { /* http or unsupported — fine */ });
  if (document.readyState === 'complete') registerSW();
  else window.addEventListener('load', registerSW);
}
