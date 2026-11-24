# MERGE_NOTES — OpenInbox + CunInbox AI 合并版

> 底座：[sums001/OpenInbox](https://github.com/sums001/OpenInbox)（MIT）
> AI 功能来源：[cunzhangcrypto/CunInbox](https://github.com/cunzhangcrypto/CunInbox)（MIT）
> 两个项目均为 MIT 开源协议，版权声明保留在各自原文件与 LICENSE 中。
> 本目录 `merged/` 是合并后的可部署版本；`../openinbox/` 与 `../cuninbox/` 是合并前拉取的原始代码，供对照。

## 一句话

在 OpenInbox（免费、无限域名邮箱，跑在 Cloudflare Workers + D1 上）里加入了 CunInbox 的
AI 功能：邮件分类、数字身份发现、每日摘要、安全中心、AI 对话助手。收发信核心流程未动，
一键部署不受影响。

## 改了什么

### 后端（`src/worker/`）

| 文件 | 改动 |
|---|---|
| `db/migrations/0010_ai.sql` | 新增 4 张表（见下） |
| `services/ai-client.ts` | 新增：AI 客户端。优先 Workers AI，失败或未绑定时降级到 OpenAI 兼容接口（DeepSeek 默认）；`chat` / `chatWithJSON` / `cleanText` / `extractJSON` |
| `services/ai-analysis.ts` | 新增：邮件分类、身份发现（精确域名匹配）、安全扫描、批量分析、分析列表/统计、确认身份 |
| `services/ai-identities.ts` | 新增：数字身份增删改查 |
| `services/ai-digest.ts` | 新增：每日摘要生成、按用户列取、每日定时批量生成 |
| `routes/ai.ts` | 新增：`/ai/*` API（状态、设置、分析、身份、摘要、安全、对话） |
| `services/inbound.ts` | 收信成功后 `waitUntil` 异步触发 AI 分析，不阻塞收信；仅真实收信、非垃圾邮件才触发 |
| `cron.ts` | 每日 `17 3 * * *` 分支加 `ai-digest`：为昨天收到邮件的用户各生成一份摘要 |
| `app.ts` | 挂载 `app.route('/ai', ai)`（在全局 `requireUser` 之后） |
| `db/settings.ts`、`shared/constants.ts`、`shared/schemas.ts` | 新增 AI 配置项（开关/提供方/模型/地址/加密 Key）与校验 schema |
| `env.ts`、`wrangler.jsonc` | 新增可选的 Workers AI 绑定 `"ai": {"binding": "AI"}` |

### 前端（`src/web/`）

| 文件 | 改动 |
|---|---|
| `pages/ai/AiRoutes.tsx` | 新增：`/ai/*` 下 6 个子页（身份、分析、摘要、安全、助手、设置） |
| `App.tsx` | 加 lazy 路由 `/ai/*`（独立分块 `AiRoutes-*.js`） |
| `components/layout/AppShell.tsx` | 顶栏导航加 “AI” 入口 |

### 测试

`test/unit/ai.test.ts`：17 个用例，覆盖 `cleanText`、`extractJSON`、安全关键词匹配、
风险分级阈值、分类值校验。

## 新增的 D1 表（`0010_ai.sql`）

| 表 | 用途 | 作用域 |
|---|---|---|
| `email_analysis` | 邮件 AI 分析结果（分类、摘要、key_info、平台、置信度、是否新身份） | 按邮箱（mailbox），可见性 = 邮箱成员关系 |
| `identities` | 数字身份（平台、分类、状态、身份邮箱、用途、备注、最近活跃） | 按用户（确认身份的用户拥有） |
| `security_events` | 安全事件（密码变更 / 异常登录 / 数据泄露，风险等级，处理状态） | 按邮箱（mailbox） |
| `daily_digests` | 每日摘要（日期、内容、重要邮件数、邮件 id 列表） | 按用户 + 日期唯一 |

## 部署要多配什么

| 配置 | 是否必填 | 说明 |
|---|---|---|
| Workers AI 绑定 | 否 | `wrangler.jsonc` 已加 `"ai": {"binding": "AI"}`，不绑定也能部署；未绑定时自动走降级接口 |
| AI 开关 | 否 | 默认关闭。在应用内 AI → 设置里打开 |
| OpenAI 兼容接口 Key | 仅在不用 Workers AI 时需要 | 在 AI 设置里填（DeepSeek 默认地址 `https://api.deepseek.com`，模型默认 `deepseek-chat`）。Key 经 `ENCRYPTION_KEY` 加密后存 `settings` 表，不进代码、不进 `wrangler.jsonc` |

**一键部署不受影响**：没有新增必填绑定，没有新增必填 Secret，没有改 cron 触发器，
迁移由 Worker 启动时自动执行。

## D1 之外的可选部分

- **附件**：仍走 OpenInbox 现有的可选 R2-over-S3 方案，不强制；AI 功能不依赖 R2/KV。
- **AI 推理**：Workers AI 绑定可选；不绑定则用 OpenAI 兼容接口（需自备 Key）。
- **AI 开关默认关闭**：不开 AI 时收信流程与原版完全一致，零额外调用、零额外开销。

## 没移植的功能及原因

- **CunInbox 的 Vue 3 前端**：与 OpenInbox 的 React 前端无法共存，AI 页面用 React 重写。
- **CunInbox 的 `platform` 表**：改为把平台名/域名/分类直接存在分析与身份记录里，少一张表、少一次关联。
- **Telegram 推送、注册密钥、RBAC 权限体系**：与 AI 合并无关，OpenInbox 已有自己的用户/权限模型。
- **`phishing` / `suspicious` 安全类型**：CunInbox 常量里有，但关键词表里没有对应词，永远产生不了，是不可达分支，未移植。
- **`checkInactiveIdentities`（90 天未活跃标记）**：在 CunInbox 全仓库无调用方，是死代码，未移植。
- **`ai_task` 表**：在 CunInbox 全仓库无读写，是死表，未建。
- **AI 对话助手的历史记录**：CunInbox 本身就是单轮、无历史、无持久化，`context` 参数接收后被忽略；本版同样单轮。

## 与 CunInbox 原版的行为差异（有意修正）

1. **平台匹配用精确匹配**：CunInbox 用 `domain LIKE '%...%'` 模糊匹配，可能把邮件挂到错误的平台；本版用 `platform_domain = ?` 精确匹配。
2. **AI 返回值做校验**：CunInbox 把模型返回的 `category`/`confidence` 原样入库；本版校验分类与平台分类是否在白名单内、置信度是否在 0–1 之间，非法值丢弃。
3. **分析与安全事件按邮箱作用域**：CunInbox 按用户；OpenInbox 的邮箱可多人共用，本版按邮箱成员关系决定可见性，身份与摘要仍按用户。
4. **对话助手身份计数 bug 已修**：CunInbox 的 `identityService.list` 返回数组本身，system prompt 里的身份数恒为 0；本版用 `identities.length`。
5. **`/analysis/echarts` 全站统计未移植**：原接口无 userId 过滤，会泄露他人数据；本版的 `/ai/analysis/stats` 按用户可访问的邮箱过滤。

## 验证结果（2026-11-23，`merged/` 内实测）

- `npm run typecheck`（worker / web / node / test 四个 tsconfig）：通过，退出码 0
- `npm run build`：通过，1.74s；AI 页面独立分块 `AiRoutes-*.js`，lazy 路由生效
- `npm test`：113 passed，1 skipped（13 个文件，12 通过 1 跳过）
- `npx vitest run test/unit/ai.test.ts`：17/17 通过
- 未做真实部署验证：部署需要用户自己的 Cloudflare 账号与域名，部署后请先在备用域名上验证收信与 AI 分析，再用于重要邮件。

## 主题：浅色 / 深色切换（2026-11-23 新增）

- 项目本来已有主题基础（`src/web/lib/theme.ts` 的 light / dark / system 三档、localStorage `oi.theme`、默认跟随系统、系统切换时自动跟随；`src/web/index.css` 里 `.dark` 一套变量），但切换入口只藏在头像菜单和设置页里，深色也只是通用深灰。
- 本次改动：
  - `src/web/components/layout/AppShell.tsx`：顶栏搜索框右侧、头像左侧加了一个主题切换按钮（月亮/太阳图标），点一下在浅色和深色之间直接切换；图标显示的是将要切换到的模式（浅色时显示月亮，深色时显示太阳）。三档完整选择（浅色 / 深色 / 跟随系统）仍在头像菜单和设置页里。
  - `src/web/index.css`：深色主题改成 CunInbox 风格的深空蓝黑（底色 `#070b16`、卡片 `#0c1224`），主色改成青紫霓虹紫 `#8b7cff`，另加了极淡的紫/青星云光晕（透明度 0.06–0.09，只做氛围，不影响文字对比度）。浅色主题未动。
  - `src/web/lib/theme.ts`：深色下的 `theme-color` meta 改成 `#070b16`。
- 选择持久化在 localStorage，下次打开保持；默认跟随系统，系统切换时选了“跟随系统”会自动跟变。切换是全局的，Mail / Admin / `/ai/*` 6 个页都走同一套 token，全部跟随。
- 验证：`npm run typecheck` 通过；`npm run build` 通过（1.81s）；`npm test` 113 passed，1 skipped；本地 `wrangler dev --local` 实测点按钮切换立即生效（浅色底 `rgb(246,246,248)` → 深色底 `rgb(7,11,22)`），刷新后选择保持。截图在 `~/workspace/mail-merge/shots/theme-light-*.png` 与 `theme-dark-*.png`（总览页 + `/ai/identities`）。
- 注意：AI 徽章/标签走的是 token + color-mix 配色，代码层面确认跟随主题；本地没有真实 AI 分析数据，带数据的徽章深色效果未做目视验证，部署后开 AI 跑一批分析再看一眼即可。

## 玻璃拟态改版（dxexb.com 风格，2026-11-23）

按用户自己的导航站 dxexb.com（气气导航）改版：全屏实拍背景图 + 深色半透明毛玻璃卡片，浅色/深色两套主题都改。只改样式层，未动功能逻辑、路由、API；主题切换按钮与浅色/深色/跟随系统三档保留可用。

### 改了哪些文件
- **新增 `src/web/lib/background.ts`**：壁纸 store（localStorage 持久化，`useSyncExternalStore`，无服务端状态、无新 API 路由）。默认 Bing 每日壁纸，按日期缓存、每天换；可填自定义图片 URL；“换一张”在近 8 天内轮换（idx 0–7）。
- **新增 `src/web/components/Background.tsx`**：`<BackgroundLayer />` 全屏背景层（z-index -1）：兜底渐变 div + `<img>`（object-cover，加载成功淡入、失败隐藏）+ 主题遮罩层。
- **`src/web/main.tsx`**：`<BackgroundLayer />` 挂在 `<App />` 之前，登录页/设置页也能看到背景。
- **`src/web/index.css`**：玻璃 token——浅色底色改半透明白（`--bg` rgb(255 255 255 / 0.55)、`--surface` / 0.68、浅色描边白 / 0.65），深色底色改半透明藏青（`--bg` rgb(7 11 22 / 0.55)、`--surface` rgb(12 18 36 / 0.62)、描边白 / 0.14）；`--reading` 保持近不透明（浅色 / 0.94、深色 / 0.94）保证邮件正文可读；圆角加大（sm 10 / md 14 / lg 18 / xl 20 / 2xl 22px）；阴影收弱；body 底色改为兜底渐变 token；旧的深色星云渐变移除，改为 `.app-bg` 层类；全局规则给 `.bg-bg/.bg-surface/.bg-surface-2/.bg-surface-3` 加 `backdrop-filter: blur(20px) saturate(1.5)`。**注意**：这里只写未加前缀的 `backdrop-filter`——Tailwind v4 的 Lightning CSS 会把“前缀+未前缀”双写时丢掉未前缀的，而当前 Chromium（156）已不认 `webkitBackdropFilter`，双写会导致计算值 `none`、模糊完全不生效（第一轮截图就是这个问题，修后构建产物同时含 `-webkit-` 与未前缀两条）。
- **`src/web/pages/settings/AccountSettings.tsx`**：外观设置新增“背景”卡片：当前壁纸预览缩略图、Bing 版权行（有则显示）、自定义图片 URL 输入、“使用这张图片”/“换一张 Bing 壁纸”（自定义图启用时禁用）/“回到 Bing 每日壁纸”按钮、保存提示。**换背景入口：设置 → 外观 → 背景。**
- 侧边栏/邮件页补 `bg-bg` 玻璃底：`src/web/pages/admin/AdminRoutes.tsx`、`src/web/pages/ai/AiRoutes.tsx`、`src/web/pages/settings/SettingsPage.tsx` 的 aside；`src/web/pages/mail/MailPage.tsx` 的邮件列表与阅读区。
- 可读性微调：浅色遮罩 `--bg-veil` 从白 / 0.30–0.38 加强到 / 0.44–0.52；浅色次要文字加深（`--text-muted` #5b5b68 → #4f4f5c，`--text-faint` #8a8a97 → #6d6d7b）。

### 背景图方案
- 主来源：Bing 每日壁纸重定向端点 `https://bing.biturl.top/?resolution=1920&format=image&index={idx}&mkt=zh-CN`，用普通 `<img>` 加载，**不需要 CORS**。
- 为什么不用 Bing 元数据接口做主来源：`https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1` 不返回 `Access-Control-Allow-Origin`（2026-11-23 curl 实测），浏览器 `fetch()` 会被 CORS 拒绝。该接口现在只做 best-effort 补充（取标题与规范 URL），失败是正常情况。
- 兜底：图片加载失败时显示内置深色渐变（浅色为蓝灰渐变、深色为深蓝渐变），不打包任何固定图片；每天按日期换图。
- 限制：本机无头 Chromium 无法直连公网（`ERR_TUNNEL_CONNECTION_FAILED`，shell curl 经 egress 代理可达），所以验证时用 curl 下载当日真实 Bing 图（2026-11-23 当日图：蕨类嫩叶，1920x1080）放本地 `http://127.0.0.1:8901/bing-today.jpg`，走同一条自定义 URL 代码路径验证；真实部署时浏览器直接加载 Bing 图，无此问题。

### 验证（2026-11-23，本地 `wrangler dev --local`，测试账号 `admin@example.test`）
- `npm run typecheck` 通过（4 个 tsconfig）；`npm run build` 通过（2.69s / 3.19s）；`npm test` **113 passed，1 skipped**。
- 截图前逐页核对：背景图 `naturalWidth` 1920、opacity 1；`backdrop-filter` 计算值 `blur(20px) saturate(1.5)`（非 `none`）；卡片底色浅色 `rgba(255,255,255,0.68)`、深色 `rgba(12,18,36,0.62)`。
- 目视确认：卡片内照片已模糊成柔和色块/光斑，面板外照片清晰；深色总览、深色 AI 身份页、深色收件箱、浅色总览、浅色登录页文字均清晰可读。唯一遗留小项：浅色总览右上角 “Today since 00:00 UTC · updated just now” 这一行极淡的元数据在最亮的照片区域对比度仍偏低（已随 `--text-faint` 加深改善），属于次要信息，可接受。
- 截图在 `~/workspace/mail-merge/shots/`：`glass-light-overview.png`、`glass-dark-overview.png`、`glass-dark-ai-identities.png`、`glass-dark-inbox.png`（另有 `glass-light-login.png` 在 /tmp，未归档）。
- 开发服务器注意事项：`npm run build` 后运行中的 `wrangler dev --local` 会变 stale（`/` 返回 404），需按 PID 杀掉旧进程再重起；**不要用 `pkill -f "wrangler dev"`**（会误杀调用方 shell），`fuser -k 8787/tcp` 也曾杀错 PID，按显式 PID 杀最稳。

## 悬浮玻璃板布局（2026-11-23）
- 整个应用外壳改成一块悬浮在背景照片上的圆角玻璃板：`main.tsx` 里 `<App />` 外包一层 `.app-frame.bg-bg`，`index.css` 新增 `.app-frame`——桌面端四边各留 24px 空隙（`margin: 1.5rem`，`height: calc(100% - 3rem)`），圆角 20px，`overflow: hidden`（内容在框内滚动、不溢出圆角），带边框和阴影；小屏（<640px）空隙 12px。
- 顶栏、边栏、内容区都在框内；登录/设置等非 AppShell 页同样在框内（frame 包在 `<App />` 外层）。功能、路由、API 未动。
- 验证：`npm run typecheck`、`npm run build` 通过，`npm test` 113 passed、1 skipped；页内实测 frame 位于 (24,24) 1392×852（视口 1440×900），圆角 20px，深色生效，背景图（Bing idx=1 雕塑图）已加载；截图 `~/workspace/mail-merge/shots/glass-dark-overview.png` 目视确认四边露出背景。
