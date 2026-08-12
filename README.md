# 要事 · First Things

> 把时间花在重要的事上。

一个极简但有智能的个人计划系统：**伟大目标 → 里程碑 → 本周要事 → 今日三件事 → 30 分钟时间块**，配合每天 2 分钟、每周 15 分钟的复盘仪式，让"重要不紧急"的事不再被挤掉。

零依赖、零构建的静态网页应用。所有数据只存在你自己浏览器的 localStorage 里，永远不上传（除了你主动发给 AI 的上下文）。

设计哲学与架构详见 [DESIGN.md](DESIGN.md)。

## 快速开始

**线上版**：打开 https://oliverjiang5666-source.github.io/first-things/ ，手机上可「添加到主屏幕」当 App 用。

**本地运行**（ES Modules 需要 http 服务，不能直接双击 html）：

```bash
python3 -m http.server 8760 --directory first-things
```

然后访问 http://localhost:8760 。

## 开启 AI（可选但强烈推荐）

1. 到 [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) 创建一个 API Key（一个 key 可调用所有模型）；
2. 打开应用右上角 **设置 ⚙**，粘贴 Key。默认模型 GPT-5.6 Sol（最深思考档），出错自动回退 Claude Opus 5。

Key 只保存在当前浏览器的 localStorage，只发往 openrouter.ai。**没有 Key 时所有 AI 功能都会降级为「复制上下文」按钮**——把整理好的上下文粘贴给任意 AI 助手，效果一样。

**本机免手填（可选）**：在 `js/` 下创建 `config.local.js`（已在 `.gitignore` 中，不会入库）：

```js
export default { apiKey: 'sk-or-v1-…' };
```

## 每天怎么用

| 时刻 | 动作 | 用时 |
|---|---|---|
| 早上 | 「☀ AI 安排」：倒一遍脑子里的事，采纳方案（最多 3 件要事 + 时间块） | 1 分钟 |
| 白天 | 做完就勾掉；新冒出来的想法丢进收集箱 📥 | 随手 |
| 晚上 | 晚间复盘：写一句"今天最有进展的事"，可选 AI 教练点评 | 2 分钟 |
| 周日 | 每周规划向导：回顾上周 → 定本周要事 → 给目标预留时间 | 15 分钟 |
| 随时 | 「深度洞察」：AI 第一性原理分析你的模式、瓶颈、杠杆点 | 1 次/周 |

## 数据安全

- 数据只在本机浏览器。**换设备/清浏览器缓存会丢数据**，请定期在「回顾 → 数据备份」导出 JSON（应用会在超过两周未备份时提醒）。
- 导入备份即可在新设备恢复（API Key 不随备份迁移）。

## 部署自己的实例

Fork 本仓库 → Settings → Pages → Source 选 `main` 分支根目录 → 保存。就这么多，没有构建步骤。

## 技术形态

原生 ES Modules + localStorage + Service Worker（离线可用），无框架、无依赖、无构建。AI 经 OpenRouter（OpenAI 兼容格式）直连，结构化输出（JSON Schema strict）保证方案可一键采纳，失败自动降级重试与模型回退。
