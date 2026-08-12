// ============ 云同步：私有 GitHub 仓库 = 云端（零后端、免费） ============
// 整包存取一个 data.json：本地每次修改盖 syncStamp，谁的戳新谁赢——
// 单人两三台设备的场景足够，不做逐字段合并。令牌只存本机 localStorage、
// 只发往 api.github.com；导出备份与云端文件都不含任何密钥。
// 状态流：启动/回到前台 pull（远端新→整包采纳；本地新→push）；
// 本地每次修改 → 8 秒防抖 push；版本冲突（sha 变了）→ 重取远端再比戳。

import { state, replaceState } from './store.js';

const REPO_DEFAULT = 'oliverjiang5666-source/first-things-data';
const FILE = 'data.json';
const API = 'https://api.github.com';

let sha = null;              // 远端当前版本指纹；409/422 冲突时重取
let timer = null;
let lastPushedStamp = 0;     // 刚 push 过的戳：防止采纳远端后又原样推回去
let status = { state: 'off', at: 0, error: null }; // off|syncing|ok|error

export function syncStatus() { return status; }

function conf() {
  const t = state.settings.ghToken?.trim();
  return t ? { t, repo: state.settings.ghRepo?.trim() || REPO_DEFAULT } : null;
}

function setStatus(st, error = null) {
  status = { state: st, at: Date.now(), error };
}

function toast(msg) { document.dispatchEvent(new CustomEvent('yaoshi-toast', { detail: msg })); }

// UTF-8 安全的 base64
const b64enc = (s) => btoa(unescape(encodeURIComponent(s)));
const b64dec = (s) => decodeURIComponent(escape(atob(s)));

async function gh(path, opts = {}) {
  const c = conf();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${c.t}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
  return res;
}

// 云端副本不带密钥：换设备时密钥走各自的带钥匙快捷方式
function cloudCopy() {
  const s = JSON.parse(JSON.stringify(state));
  s.settings.apiKey = '';
  s.settings.ghToken = '';
  return s;
}

function adoptRemote(remote) {
  const keep = state.settings;
  remote.settings = { ...remote.settings, apiKey: keep.apiKey, ghToken: keep.ghToken, ghRepo: keep.ghRepo };
  lastPushedStamp = remote.syncStamp || 0;
  replaceState(remote);
  setStatus('ok');
  toast('已从云端同步最新数据');
}

async function push() {
  const c = conf();
  if (!c) { setStatus('off'); return; }
  if ((state.syncStamp || 0) <= lastPushedStamp) return; // 没新东西
  setStatus('syncing');
  try {
    const stamp = state.syncStamp || 0;
    const body = { message: `sync ${new Date().toISOString()}`, content: b64enc(JSON.stringify(cloudCopy())) };
    if (sha) body.sha = sha;
    const res = await gh(`/repos/${c.repo}/contents/${FILE}`, { method: 'PUT', body: JSON.stringify(body) });
    if (res.ok) {
      sha = (await res.json()).content?.sha || null;
      lastPushedStamp = stamp;
      setStatus('ok');
      return;
    }
    if (res.status === 409 || res.status === 422) {
      // 别的设备先推了：重取远端，谁新谁赢
      await pull();
      if ((state.syncStamp || 0) > lastPushedStamp) await push();
      return;
    }
    if (res.status === 401 || res.status === 403) {
      setStatus('error', '令牌无效或过期：去 GitHub 重新生成，粘到设置里');
      return;
    }
    setStatus('error', `同步失败（HTTP ${res.status}）`);
  } catch {
    setStatus('error', '网络不通，稍后自动重试'); // 下次修改/回到前台会再试
  }
}

async function pull() {
  const c = conf();
  if (!c) { setStatus('off'); return; }
  setStatus('syncing');
  try {
    const res = await gh(`/repos/${c.repo}/contents/${FILE}?t=${Date.now()}`, { cache: 'no-store' });
    if (res.status === 404) { sha = null; setStatus('ok'); return push(); } // 首次：云端还没有文件（sha 必须清掉，否则带旧 sha 推会 422 死循环）
    if (res.status === 401 || res.status === 403) { setStatus('error', '令牌无效或过期：去 GitHub 重新生成，粘到设置里'); return; }
    if (!res.ok) { setStatus('error', `读取云端失败（HTTP ${res.status}）`); return; }
    const data = await res.json();
    sha = data.sha;
    const remote = JSON.parse(b64dec((data.content || '').replace(/\n/g, '')));
    const remoteStamp = remote.syncStamp || 0;
    const localStamp = state.syncStamp || 0;
    // 本地还是白纸而云端有内容：无条件采纳云端。防住「新设备刚配好钥匙、
    // 戳比云端新」的情况——否则会把空状态推上去盖掉真数据
    const localBlank = !state.goals.length && !state.inbox.length
      && !Object.keys(state.days).length && !Object.keys(state.weeks).length;
    const remoteHasData = !!(remote.goals?.length || remote.inbox?.length
      || Object.keys(remote.days || {}).length || Object.keys(remote.weeks || {}).length);
    if (localBlank && remoteHasData) adoptRemote(remote);
    else if (remoteStamp > localStamp) adoptRemote(remote);
    else if (localStamp > remoteStamp) { setStatus('ok'); return push(); }
    else setStatus('ok');
  } catch {
    setStatus('error', '网络不通，稍后自动重试');
  }
}

// 本地有修改 → 防抖后推云端（store 的 subscribe 里调用）
export function schedulePush() {
  if (!conf()) return;
  clearTimeout(timer);
  timer = setTimeout(push, 8_000);
}

export async function syncNow() { await pull(); }

export function initSync() {
  if (conf()) pull();
  else setStatus('off');
  // 回到前台且超过 1 分钟没同步过：拉一次，接住别的设备的修改
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && conf() && Date.now() - status.at > 60_000) pull();
  });
  // 关页前如果还有没推的修改，尽力推一把（不保证成功，下次打开兜底）
  window.addEventListener('pagehide', () => {
    if (conf() && (state.syncStamp || 0) > lastPushedStamp) {
      clearTimeout(timer);
      push();
    }
  });
}

// 设置页保存令牌后调用：立即拉一次，让状态马上可见
export function onTokenChange() {
  sha = null; lastPushedStamp = 0;
  if (conf()) pull(); else setStatus('off');
}

// 供设置页显示
export function syncStatusText() {
  const s = status;
  if (s.state === 'off') return '未配置——填入 GitHub 令牌后自动开启';
  if (s.state === 'syncing') return '同步中…';
  if (s.state === 'error') return s.error || '出错了';
  return `已同步 · ${new Date(s.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}
