# Pi Butler — 个人工作管家（AI 秘书）

基于 [Pi](https://github.com/badlogic/pi-mono) 运行时构建的 AI 秘书 Agent，通过自然语言对话管理你的任务、日程和备忘录。

支持两种使用模式：
- **CLI 模式** — 在本地终端与 AI 对话（个人使用）
- **服务模式** — 部署为后端服务，通过 Telegram Bot、Discord Bot 或 HTTP API 与之对话（可多渠道接入）

---

## 目录

- [功能](#功能)
- [设计背景](#设计背景)
- [产品架构](#产品架构)
- [使用方式一：CLI 本地对话](#使用方式一cli-本地对话)
- [使用方式二：服务模式（Telegram / Discord / HTTP）](#使用方式二服务模式)
- [配置参考](#配置参考)
- [数据存储](#数据存储)
- [项目结构](#项目结构)

---

## 功能

- **任务管理** — 创建、更新、列表、完成、删除任务（支持优先级、截止日、标签）
- **日程管理** — 创建、更新、列表、删除日历事件（支持时间、地点）
- **备忘录** — 创建、搜索、更新、删除笔记（支持标签）
- **每日简报** — 汇总今日任务、逾期项、近 7 天日程
- **多用户隔离** — 服务模式下每个用户的数据完全独立
- **多渠道** — Telegram Bot、Discord Bot、REST API 同时运行
- **多语言** — 自动匹配用户语言（中文、英文等）
- **多 Provider** — 优先支持 OpenAI 兼容国内平台（千问 / 豆包 / Kimi / DeepSeek），也兼容其他 Provider

---

## 设计背景

### 为什么用 Pi（pi-mono）

[Pi](https://github.com/badlogic/pi-mono) 是一个轻量的 TypeScript Agent 运行时，提供：

- `@mariozechner/pi-ai` — 统一的多 Provider LLM API（Anthropic / OpenAI / Google / OpenRouter 等）
- `@mariozechner/pi-agent-core` — Agent 状态机：system prompt → LLM → tool calls → results → LLM 循环，以及事件流（streaming）

相比手写 LLM 调用循环，pi-agent-core 封装了完整的 tool use 协议和流式输出，让我们专注于业务逻辑（工具定义 + 存储层）。

### 借鉴 OpenClaw 的服务化思路

[OpenClaw](https://github.com/openclaw/openclaw) 是一个成熟的个人 AI 助手服务平台，其核心架构：

```
多渠道 (WhatsApp / Telegram / Slack / Discord ...)
              │
              ▼
      Gateway（长驻进程）       ← 控制面：会话管理、路由、鉴权
              │
              ▼
      Pi Agent（RPC 模式）      ← 业务面：LLM 调用、工具执行
```

Pi Butler 借鉴了这一分层思想，以更轻量的方式实现：
- **Gateway 层**：会话管理 + 消息路由，每用户独立 Agent 实例
- **Adapter 层**：每个渠道一个独立适配器，统一消息格式后交给 Gateway
- **Storage 层**：每用户独立数据目录，数据不互相泄露

---

## 产品架构

```
Telegram Bot      Discord Bot      HTTP REST/SSE
     │                 │                 │
     └────────┬─────────┘─────────────────┘
              │         统一消息格式 IncomingMessage
              ▼
   ┌─────────────────────────────────┐
   │           Gateway               │
   │                                 │
   │  ┌─────────────────────────┐   │
   │  │     SessionManager      │   │  ← 按 channel:userId 隔离
   │  │  (30min 超时自动回收)    │   │
   │  └──────────┬──────────────┘   │
   │             │                   │
   │  ┌──────────▼──────────────┐   │
   │  │     Agent Pool          │   │  ← 每会话一个 pi-agent-core Agent
   │  │  (pi-agent-core)        │   │
   │  └──────────┬──────────────┘   │
   │             │                   │
   │  ┌──────────▼──────────────┐   │
   │  │     Tool Layer          │   │  ← 8 个工具，绑定用户 Storage
   │  └─────────────────────────┘   │
   └─────────────────────────────────┘
              │
   ~/.pi-butler/data/users/{channel}_{userId}/
              ├── tasks.json
              ├── schedule.json
              └── notes.json
```

### 会话隔离策略

| 模式 | Session Key | 适用场景 |
|------|------------|---------|
| CLI 模式 | 单用户，共享默认 Storage | 个人本地使用 |
| 服务模式 | `{channel}:{userId}` | 多用户、多渠道 |

同一个用户在 Telegram 和 Discord 上是**两个独立会话**（数据目录也不同）。若需跨渠道共享，可使用相同的 `userId`。

### 工具列表

| 工具名 | 功能 |
|--------|------|
| `manage_tasks` | 创建 / 更新 / 删除任务 |
| `list_tasks` | 列表任务（支持状态、优先级、标签过滤） |
| `manage_schedule` | 创建 / 更新 / 删除日历事件 |
| `list_schedule` | 列表日历事件（支持日期范围过滤） |
| `manage_notes` | 创建 / 更新 / 删除备忘录 |
| `search_notes` | 搜索备忘录（关键词 + 标签） |
| `get_daily_summary` | 每日简报（任务 + 日程汇总） |
| `get_current_time` | 获取当前时间（支持时区） |

---

## 使用方式一：CLI 本地对话

在本地终端直接与 AI 对话，数据存在 `~/.pi-butler/data/`。

### 安装

```bash
git clone <this-repo>
cd pi-butler
pnpm install
pnpm run build
```

### 配置 LLM

CLI 现在支持**首次启动引导**，即使没提前配 `.env` 也可直接进入配置流程。

#### 方式 A：首次启动引导（推荐）

首次运行 `pnpm start` / `pnpm dev`，若未检测到可用模型，会进入 onboarding：

- `1) OAuth 登录`（复用 ChatGPT/Codex 订阅）
- `2) 设置 AI API Key`
  - OpenAI 兼容（自定义中转站 `Base URL + Model`）
  - 千问（DashScope）
  - 豆包（Ark）
  - Kimi（Moonshot）
  - DeepSeek
  - Anthropic
  - Google/Gemini
- `3) 退出`

在 onboarding 里设置 API Key 后，还可以选择**写入当前目录 `.env`**，下次自动生效。

#### 方式 B：手动配置 `.env`

```bash
cp .env.example .env
```

示例（OpenAI 兼容 + 自定义中转站）：

```ini
PI_BUTLER_PROVIDER=openai
OPENAI_BASE_URL=https://your-relay.example.com/v1
OPENAI_API_KEY=sk-xxxx
PI_BUTLER_MODEL=qwen-plus
```

也支持兼容别名：

```ini
OPENAI_COMPAT_API_KEY=sk-xxxx
OPENAI_COMPAT_BASE_URL=https://your-relay.example.com/v1
OPENAI_COMPAT_MODEL=qwen-plus
```

> `.env` 已加入 `.gitignore`，不会被提交到 Git。

### 启动

```bash
# 生产模式（需先 build）
pnpm start

# 开发模式（直接运行 TypeScript，无需 build）
pnpm dev
```

### 示例对话

```
You: 帮我创建一个任务：明天下午 3 点前完成季报 PPT，高优先级
AI: 好的，我来为你创建这个任务...
    ✅ 创建任务：季报 PPT
    已设置截止日期为明天（2026-03-01），优先级：高

You: 今天有什么安排？
AI: 📋 今日简报（2026-02-28）
    待处理任务 3 项，进行中 1 项...
```

---

## 使用方式二：服务模式

将 Pi Butler 部署为后端服务，可同时支持：
- **Telegram Bot** — 直接在 Telegram 和机器人对话
- **Discord Bot** — 在 Discord 频道 @mention 机器人，或私信
- **HTTP API** — 通过 REST/SSE 接口接入自定义前端

### 2.1 配置

```bash
cp .env.example .env
```

编辑 `.env`：

```ini
# LLM（推荐：国内 OpenAI 兼容平台，示例为千问）
PI_BUTLER_PROVIDER=openai
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
OPENAI_API_KEY=sk-xxxx
PI_BUTLER_MODEL=qwen-plus

# OAuth（可选，用于 ChatGPT/Codex 订阅授权）
# OAUTH_OPENAI_AUTH_URL=
# OAUTH_OPENAI_TOKEN_URL=
# OAUTH_OPENAI_CLIENT_ID=
# OAUTH_OPENAI_CLIENT_SECRET=
# OAUTH_OPENAI_REDIRECT_URI=http://localhost:3000/api/auth/oauth/callback
# OAUTH_OPENAI_SCOPE=openid profile offline_access
# OAUTH_OPENAI_BASE_URL=https://api.openai.com/v1
# OAUTH_OPENAI_MODEL=gpt-4o

# Telegram Bot（可选，不填则不启动）
TELEGRAM_BOT_TOKEN=123456789:ABC...

# Discord Bot（可选，不填则不启动）
DISCORD_BOT_TOKEN=MTk...

# 服务端口（默认 3000）
# PI_BUTLER_PORT=3000
```

### 2.2 如何获取 Bot Token

**Telegram Bot Token**
1. 在 Telegram 搜索 `@BotFather`
2. 发送 `/newbot`，按提示输入名称
3. 获得 `TELEGRAM_BOT_TOKEN`

**Discord Bot Token**
1. 进入 [Discord Developer Portal](https://discord.com/developers/applications)
2. 创建 Application → Bot → 开启 `Message Content Intent`
3. 复制 Token 作为 `DISCORD_BOT_TOKEN`
4. 用 OAuth2 URL 邀请 Bot 进入服务器

### 2.3 启动服务

```bash
# 开发模式
pnpm dev:server

# 生产模式（需先 build）
pnpm build
pnpm server
```

启动后输出：

```
[Pi Butler Server] listening on http://0.0.0.0:3000
  POST /api/auth/oauth/start — start OAuth
  GET  /api/auth/oauth/callback — OAuth callback
  GET  /api/auth/status      — auth status
  POST /api/auth/disconnect  — disconnect auth
  POST /api/chat        — SSE streaming
  POST /api/chat/sync   — blocking JSON
  GET  /health          — health check

[Telegram] Bot started
[Discord]  Logged in as ButlerBot#1234
```

### 2.4 在 Telegram 使用

配置好 Token 启动服务后，直接在 Telegram 搜索你的 Bot，发送消息即可：

```
你：帮我创建一个任务
Bot：好的，请告诉我任务的标题、截止日期和优先级...
```

> 每个 Telegram 用户的数据存储在 `~/.pi-butler/data/users/telegram_{userId}/`，互相隔离。

### 2.5 在 Discord 使用

- **私信**：直接私信 Bot
- **频道**：在频道内 `@ButlerBot 帮我查看今日任务`

### 2.6 HTTP API 使用

**流式响应（SSE）**

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"userId": "user1", "message": "今天有什么任务？"}' \
  --no-buffer
```

响应（Server-Sent Events）：

```
event: tool_start
data: {"type":"tool_start","toolName":"get_daily_summary"}

event: tool_end
data: {"type":"tool_end","toolName":"get_daily_summary","isError":false}

event: text_delta
data: {"type":"text_delta","text":"📋 今日简报（2026-02-28）\n"}

event: done
data: {"type":"done"}
```

**同步响应（阻塞式）**

```bash
curl -X POST http://localhost:3000/api/chat/sync \
  -H "Content-Type: application/json" \
  -d '{"userId": "user1", "message": "帮我创建一个任务：写周报，今天内完成"}'
```

响应：

```json
{ "reply": "好的，已为你创建任务「写周报」，截止今日。" }
```

**OAuth 授权（可选）**

1) 开始授权（返回 `authUrl`，前端跳转到该地址）：

```bash
curl -X POST http://localhost:3000/api/auth/oauth/start \
  -H "Content-Type: application/json" \
  -d '{"channel":"http","userId":"user1","provider":"openai_codex"}'
```

2) 用户完成授权后，OAuth Provider 会回调：

```text
GET /api/auth/oauth/callback?code=...&state=...
```

3) 查看当前用户授权状态：

```bash
curl "http://localhost:3000/api/auth/status?channel=http&userId=user1"
```

4) 解绑授权：

```bash
curl -X POST http://localhost:3000/api/auth/disconnect \
  -H "Content-Type: application/json" \
  -d '{"channel":"http","userId":"user1"}'
```

> 运行时策略：用户已绑定 OAuth 时优先使用 OAuth 凭据；未绑定时继续走 `.env` 中的 API Key。

**清除会话上下文**

```bash
curl -X POST http://localhost:3000/api/sessions/http/user1/clear
```

**健康检查**

```bash
curl http://localhost:3000/health
# {"status":"ok","activeSessions":2,"uptime":3600}
```

---

## 配置参考

所有配置通过项目根目录的 `.env` 文件设置（复制 `.env.example` 修改即可）。

### LLM

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PI_BUTLER_PROVIDER` | 推荐固定为 `openai`（OpenAI 兼容模式） | 自动检测 |
| `OPENAI_BASE_URL` | 厂商 OpenAI 兼容端点 | — |
| `OPENAI_API_KEY` | 厂商 API Key | — |
| `PI_BUTLER_MODEL` | 厂商模型名 | 自动检测 |
| `OPENAI_COMPAT_API_KEY` | `OPENAI_API_KEY` 兼容别名 | — |
| `OPENAI_COMPAT_BASE_URL` | `OPENAI_BASE_URL` 兼容别名 | — |
| `OPENAI_COMPAT_MODEL` | `PI_BUTLER_MODEL` 兼容别名 | — |
| `QWEN_API_KEY` / `DASHSCOPE_API_KEY` | 千问 API Key 别名（自动桥接到 OpenAI 兼容配置） | — |
| `DOUBAO_API_KEY` / `ARK_API_KEY` | 豆包 API Key 别名（自动桥接） | — |
| `KIMI_API_KEY` / `MOONSHOT_API_KEY` | Kimi API Key 别名（自动桥接） | — |
| `DEEPSEEK_API_KEY` | DeepSeek API Key 别名（自动桥接） | — |
| `ANTHROPIC_API_KEY` | Anthropic API Key（可选） | — |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Google API Key（可选） | — |

> 自动桥接规则：当检测到上述国内厂商别名 Key 时，会自动补全 `OPENAI_API_KEY`、默认 `OPENAI_BASE_URL` 与默认模型（可在 `.env` 中覆盖）。

### OAuth（可选）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OAUTH_OPENAI_AUTH_URL` | OAuth 授权地址 | — |
| `OAUTH_OPENAI_TOKEN_URL` | OAuth 换 token 地址 | — |
| `OAUTH_OPENAI_CLIENT_ID` | OAuth Client ID | — |
| `OAUTH_OPENAI_CLIENT_SECRET` | OAuth Client Secret | — |
| `OAUTH_OPENAI_REDIRECT_URI` | OAuth 回调地址 | `http://localhost:3000/api/auth/oauth/callback` |
| `OAUTH_OPENAI_SCOPE` | OAuth scope | `openid profile offline_access` |
| `OAUTH_OPENAI_BASE_URL` | OAuth 凭据下使用的 OpenAI 兼容 base URL | `https://api.openai.com/v1` |
| `OAUTH_OPENAI_MODEL` | OAuth 凭据下默认模型 | `gpt-4o` |

**推荐预设（国内）**

```ini
# 千问（阿里 DashScope）
PI_BUTLER_PROVIDER=openai
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
OPENAI_API_KEY=sk-xxxx
PI_BUTLER_MODEL=qwen-plus

# 豆包（火山方舟）
# OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
# PI_BUTLER_MODEL=doubao-1.5-pro-32k-250115

# Kimi（Moonshot）
# OPENAI_BASE_URL=https://api.moonshot.cn/v1
# PI_BUTLER_MODEL=moonshot-v1-8k

# DeepSeek
# OPENAI_BASE_URL=https://api.deepseek.com/v1
# PI_BUTLER_MODEL=deepseek-chat
```

### 自定义端点（代理 / 本地模型）

| 变量 | 说明 |
|------|------|
| `OPENAI_BASE_URL` | OpenAI 兼容端点，支持 Ollama、LM Studio、第三方代理 |
| `ANTHROPIC_BASE_URL` | Anthropic 代理端点 |

**Ollama 本地模型示例：**

```ini
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=ollama
PI_BUTLER_PROVIDER=openai
PI_BUTLER_MODEL=llama3.2
```

**LM Studio 示例：**

```ini
OPENAI_BASE_URL=http://localhost:1234/v1
OPENAI_API_KEY=lm-studio
PI_BUTLER_PROVIDER=openai
PI_BUTLER_MODEL=你加载的模型名
```

### Bot

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | —（不设置则不启动） |
| `DISCORD_BOT_TOKEN` | Discord Bot Token | —（不设置则不启动） |

### 服务

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PI_BUTLER_PORT` | HTTP 服务端口 | `3000` |

---

## 数据存储

所有数据以 JSON 文件持久化：

**CLI 模式**

```
~/.pi-butler/data/
├── tasks.json
├── schedule.json
└── notes.json
```

**服务模式（按渠道 + 用户隔离）**

```
~/.pi-butler/data/users/
├── telegram_123456789/
│   ├── tasks.json
│   ├── schedule.json
│   └── notes.json
├── discord_987654321/
│   └── ...
└── http_user1/
    └── ...
```

---

## 项目结构

```
src/
├── main.ts                   # CLI 模式入口
├── storage.ts                # 存储层：Storage 类（参数化 dataDir）+ 默认单例
├── tools.ts                  # 8 个 AgentTool + createTools(storage) 工厂函数
└── server/
    ├── server.ts             # 服务模式入口（Express + Bot 启动）
    ├── gateway.ts            # Gateway：消息路由 + LLM 解析
    ├── session.ts            # SessionManager：per-user Agent 池，30min 超时回收
    ├── constants.ts          # SYSTEM_PROMPT
    └── adapters/
        ├── types.ts          # IncomingMessage / OutgoingChunk 类型
        ├── http.ts           # HTTP REST + SSE 适配器
        ├── telegram.ts       # Telegram Bot 适配器（grammy）
        └── discord.ts        # Discord Bot 适配器（discord.js）
```

### 技术依赖

| 包 | 用途 |
|----|------|
| `@mariozechner/pi-agent-core` | Agent 运行时（tool 执行循环、事件流、状态管理） |
| `@mariozechner/pi-ai` | 统一多 Provider LLM API |
| `@sinclair/typebox` | TypeBox schema 定义工具参数（JSON Schema + TypeScript 类型同步） |
| `express` | HTTP 服务器（REST + SSE） |
| `grammy` | Telegram Bot 框架 |
| `discord.js` | Discord Bot 框架 |
| `chalk` | CLI 彩色输出 |

---

## License

MIT
