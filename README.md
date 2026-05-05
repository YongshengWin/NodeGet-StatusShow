# NodeGet-StatusShow

一个服务器状态展示页

## 开发

```bash
npm i
npm run dev
```

# 部署

build 完是纯静态站 丢哪都行

## 一键部署

推荐做法是：

1. Fork 本仓库到你自己的 GitHub
2. 不要把真实 token 直接提交到 `public/config.json`
3. 在 Cloudflare 里绑定你的 GitHub 仓库，开启自动构建部署
4. 在 Cloudflare 的构建环境变量里配置 `SITE_NAME` / `SITE_FOOTER` / `SITE_1`
5. 以后上游有更新时，在 GitHub 点 `Sync fork`，Cloudflare 会自动重新部署

仓库里的 `public/config.json` 建议只保留示例值，真实配置交给 Cloudflare 环境变量注入

## Cloudflare 自动部署

如果你用的是 Cloudflare Workers 静态资源部署，推荐配置：

- Build command: `npm run build`
- Output directory: `dist`
- Root directory: 仓库根目录

把下面这些环境变量加到 Cloudflare 的生产环境：

```env
SITE_NAME=针针
SITE_LOGO=
SITE_FOOTER=小针针
SITE_1=name="macmini",backend_url="wss://dmit.115emby.top:52443",token="你的真实 token"
```

示例文件见 `.env.production.example`

这样构建时会自动执行 `scripts/build-config.mjs`，把环境变量写进最终产物里的 `config.json`

## 更新流程

以后只需要：

1. 在 GitHub 打开你自己的 fork
2. 点击 `Sync fork`
3. 点击 `Update branch`
4. 等 Cloudflare 自动触发新一轮 build 和 deployment

# 环境变量

> 环境变量是 **build 时** 注入的 改完之后必须重新部署一次才会生效 在面板里光改不重新跑 build 是没用的

```
SITE_NAME=狼牙的探针
SITE_LOGO=https://example.com/logo.png
SITE_FOOTER=Powered by NodeGet
SITE_1=name="master-1",backend_url="wss://m1.example.com",token="abc123"
SITE_2=name="master-2",backend_url="wss://m2.example.com",token="xyz789" 
```

前三个对应 `site_name` / `site_logo` / `footer` 不写就用默认值

`SITE_n` 是主控 值用 `key="value"` 拿逗号串起来 支持 `name` / `backend_url` / `token` 三个字段 值里要塞引号或反斜杠的话用 `\"` 和 `\\` 转义

从 `SITE_1` 开始连续往上数 中间断了就停 所以加新主控接着 `SITE_3` `SITE_4` 就行

一个 `SITE_n` 都没设的话脚本啥也不干 直接用仓库里那份 `config.json` 本地 `npm run dev` 走的是 vite 直接起 也不会触发这个脚本

可以只有一个 `SITE` 不强制 `SITE_2` `SITE_3` 之类的
