# 闪记

一个本地优先的网页闪记卡应用，支持卡组管理、表格导入、自动发音、艾宾浩斯复习、浏览器通知、橙色主题和暗黑模式。

## 运行

```bash
pnpm install
pnpm dev
```

打开 Vite 输出的地址：

- Windows 本机浏览器：`http://localhost:5173`
- 安卓浏览器：手机和电脑连接同一 Wi-Fi，打开终端输出的 `Network` 地址，例如 `http://192.168.x.x:5173`

开发模式会自动寻找可用的 API 端口，并把 Vite 代理指向该端口；如果 `4174` 已被占用，会自动顺延。

远程开发启动：

```bash
pnpm dev:remote
```

生产远程启动：

```bash
pnpm remote
```

默认监听 `0.0.0.0:4174`，可用服务器 IP 访问；如果要改端口：

```bash
PORT=8080 pnpm start:remote
```

## 发布到云端

本地提交并推到 GitHub：

```bash
git add README.md package.json server src vite.config.ts scripts 模版
git commit -m "Release 0.2.7"
GIT_SSH_COMMAND="ssh -i ~/.ssh/codex_aliyun_flashcards -o IdentitiesOnly=yes" git push origin main
```

推到 GitHub 只更新仓库，不会自动更新 ECS。推荐用本地当前提交直接覆盖 ECS 代码，再在服务器重新构建并重启 PM2；这样不依赖服务器上的 Git 工作区是否干净：

```bash
# 先备份线上代码和数据库
ssh -i ~/.ssh/codex_aliyun_flashcards root@121.43.195.214 'set -e; ts=$(date +%Y%m%d%H%M%S); cd /root; tar --exclude=flashcards/node_modules --exclude=flashcards/dist --exclude=flashcards/dist-server --exclude=flashcards/.git -czf flashcards.pre-release.$ts.tar.gz flashcards; cp flashcards/data/flashcards.sqlite flashcards.sqlite.pre-release.$ts'

# 从本机把当前 Git 提交展开到 ECS，保留服务器上的 data/、node_modules、dist、dist-server 和 .git
git archive HEAD | ssh -i ~/.ssh/codex_aliyun_flashcards root@121.43.195.214 "tar -x -C /root/flashcards"

# 在服务器重新构建、重启服务
ssh -i ~/.ssh/codex_aliyun_flashcards root@121.43.195.214 'set -e; cd /root/flashcards; pnpm install; pnpm build; pm2 restart flashcards --update-env; pm2 save'
```

验证线上版本：

```bash
curl http://127.0.0.1:4174/api/health
curl http://121.43.195.214/api/health
```

如果页面仍显示旧版本，优先确认 `dist/assets` 的更新时间和 `pm2 list` 里的 `flashcards` 是否刚重启；浏览器端可用 `Cmd+Shift+R` 或 `Ctrl+F5` 强制刷新缓存。

## 功能

- 卡组最多 5 层嵌套，支持创建、编辑、删除。
- 卡片支持创建、搜索、收藏、编辑、删除。
- CSV、TSV、XLSX 或粘贴表格批量导入，并提供普通卡、单词卡、选择题卡、填空题卡模板。
- 学习页按卡片类型自动显示闪记卡、选择题或填空题，并支持沉浸式学习和学习字号调整。
- 浏览器 `speechSynthesis` 手动发音，学习页自动发音可在设置中开启或关闭。
- 严格固定艾宾浩斯间隔：5 分钟、30 分钟、12 小时、1 天、2 天、4 天、7 天、15 天、30 天、90 天。
- 认识 / 模糊 / 不认识反馈：
  - 认识：进入下一阶段。
  - 模糊：保持当前阶段，30 分钟后复习。
  - 不认识：回到第 1 阶段，5 分钟后复习。
- 浅色、暗黑、跟随系统主题。

数据保存在 `data/flashcards.sqlite`，该目录默认不会提交到 Git。
