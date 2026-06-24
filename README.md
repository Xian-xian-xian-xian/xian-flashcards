# Xian 闪记卡

一个本地优先的网页闪记卡应用，支持卡组管理、表格导入、自动发音、艾宾浩斯复习、浏览器通知、橙色主题和暗黑模式。

## 运行

```bash
pnpm install
pnpm dev
```

打开 Vite 输出的地址：

- Windows 本机浏览器：`http://localhost:5173`
- 安卓浏览器：手机和电脑连接同一 Wi-Fi，打开终端输出的 `Network` 地址，例如 `http://192.168.x.x:5173`

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

## 功能

- 卡组最多 5 层嵌套，支持创建、编辑、删除。
- 卡片支持创建、搜索、收藏、编辑、删除。
- CSV、TSV、XLSX 或粘贴表格批量导入。
- Flashcards、Learn、Test、Write、Listen、Match 六种学习入口。
- 浏览器 `speechSynthesis` 自动发音。
- 严格固定艾宾浩斯间隔：5 分钟、30 分钟、12 小时、1 天、2 天、4 天、7 天、15 天、30 天、90 天。
- 认识 / 模糊 / 不认识反馈：
  - 认识：进入下一阶段。
  - 模糊：保持当前阶段，30 分钟后复习。
  - 不认识：回到第 1 阶段，5 分钟后复习。
- 浅色、暗黑、跟随系统主题。

数据保存在 `data/flashcards.sqlite`，该目录默认不会提交到 Git。
