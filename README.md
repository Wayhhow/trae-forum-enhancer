<div align="center">

# 🌙 TRAE 论坛增强助手

**一键暗黑模式 · 列表数据增强 · 帖子温度计 · 随机漫游**

为 [TRAE 官方中文社区](https://forum.trae.cn/) 打造的油猴脚本，让逛论坛更舒服一点。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.2.2-blue.svg)](CHANGELOG.md)
[![Discourse](https://img.shields.io/badge/Discourse-2026.x-green.svg)](https://forum.trae.cn/)

[**立即安装**](#-安装) · [功能一览](#-功能一览) · [更新日志](CHANGELOG.md) · [反馈问题](../../issues)

</div>

---

## ✨ 功能一览

### 🌙 暗黑模式一键切换

顶栏右上角新增月亮/太阳按钮，一键切换全站暗黑模式。

- 覆盖 60+ 个 Discourse CSS 变量，帖子页、编辑器、弹窗、侧边栏全部适配
- 背景色采用与 TRAE 品牌一致的深灰色系，不是粗暴的反色
- 偏好自动保存，下次打开自动跟随

### 📊 列表页数据增强

帖子列表每一行直接看到关键信息，不用再点进去才知道值不值得读：

| 增强项 | 效果 |
| --- | --- |
| ❤️ 点赞数 | 浏览量旁边显示该帖累计点赞 |
| 🔥 热门标识 | 热度 ≥ 70 的帖子自动标记 |
| ✅ 已解决徽章 | 已采纳答案的帖子标题旁显示 `✓ 已解决` |

### 🌡️ 帖子温度计

每行一条迷你温度条，颜色从绿到红直观反映帖子热度：

```
热度 = 点赞(40%) + 回复(35%) + 浏览(25%) × 时间衰减
```

- 按 7 天半衰期衰减：刚被回复的老帖不会一直"发烧"，新帖更容易被看到
- 悬停温度条可看明细：`热度 98 · 45 赞 · 36 回复 · 1.6k 浏览`

### 🎲 随机漫游

顶栏骰子按钮，随机打开一个帖子。

- 基于论坛官方 sitemap（约 9 万个话题），能翻到几年前的考古帖
- 数据源不可用时自动降级到最新帖子列表
- 点击时骰子会转一圈 🎲

## 📦 安装

### 前提

安装任一油猴扩展（推荐 Tampermonkey）：

- Chrome：[Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- Edge / Firefox：扩展商店搜索 "Tampermonkey"

### 方式一：一键安装（推荐）

直接点击下方链接，Tampermonkey 会自动弹出安装面板：

> 👉 **[点此安装脚本](https://raw.githubusercontent.com/Wayhhow/trae-forum-enhancer/main/trae-forum-enhancer.user.js)**

### 方式二：手动安装

1. 打开 Tampermonkey 面板 → 「添加新脚本」
2. 清空默认内容，把 [`trae-forum-enhancer.user.js`](trae-forum-enhancer.user.js) 的全部内容粘贴进去
3. `Ctrl + S` 保存，刷新 `forum.trae.cn` 即可

## 🛠️ 技术实现

- **纯本地运行**：`@grant none`，不申请任何油猴特权，全部基于页面 API
- **三路数据源兜底**：拦截站内 `fetch` 响应 → 解析首屏 `data-preloaded` 预载数据 → 兜底自行请求一次列表页 `.json`，零额外开销也不漏数据
- **零侵入**：所有钩子均包裹容错，不影响论坛原有功能
- **SPA 友好**：`MutationObserver` 监听路由切换，翻页/换分类自动增强新行

## 🗺️ 路线图

- [ ] 代码块一键复制
- [ ] 阅读进度条与预计耗时
- [ ] 我的年度报告（发挥脑洞中）

有想加的功能？[开个 Issue 聊聊](../../issues/new?template=feature_request.yml)。

## ❓ FAQ

**Q：切换暗黑模式后个别图片很刺眼？**
A：图片本身不受主题影响，属于正常现象；后续版本可能加入图片亮度自动调节。

**Q：列表页数据偶尔显示不出来？**
A：数据来自列表接口，网络波动时可能延迟 1-2 秒出现；刷新页面即可。

**Q：论坛官方改版后脚本会失效吗？**
A：脚本只依赖 Discourse 标准结构（2026.x），兼容性较好。若失效请提 [Bug 反馈](../../issues/new?template=bug_report.yml)。

## 📄 许可

[MIT License](LICENSE) © 2026 [Wayhhow](https://github.com/Wayhhow)

欢迎 Fork、二开、分发，保留版权声明即可。

---

<div align="center">

觉得有用的话，顺手点个 ⭐ 吧～

</div>
