# 云服务器部署步骤

## 1. 当前线上入口

- 闪记卡：<https://card.beyour.top/>
- 番茄基地：<https://tomato.beyour.top/>
- 番茄基地模拟经营：<https://tomatogame.beyour.top/>

旧服务器 IP 入口已作废；线上访问只使用以上域名。

## 2. 推荐实例

- 地域：如果主要自己国内访问，选中国大陆离你近的地域；如果不想备案域名，选中国香港。
- 系统：Ubuntu 24.04 LTS。
- 配置：1 核 1G 起步即可，2 核 2G 更舒服。
- 安全组：至少开放 `22`、`80`、`443`。`4174` 只应监听 `127.0.0.1`，不作为公网入口。

## 3. 服务器初始化

SSH 登录服务器后执行：

```bash
sudo apt update
sudo apt install -y curl git nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pnpm pm2
```

## 4. 上传代码

如果代码已经放到 Git 仓库：

```bash
git clone <你的仓库地址> flashcards
cd flashcards
```

如果没有 Git 仓库，可以在本机用 `scp` 上传整个项目，但不要上传 `node_modules`、`dist`、`dist-server`、`data`。

## 5. 构建和启动

```bash
pnpm install
pnpm build
PORT=4174 HOST=127.0.0.1 NODE_ENV=production COOKIE_SECURE=true COOKIE_DOMAIN=.beyour.top pm2 start dist-server/server/index.js --name flashcards --update-env
pm2 save
pm2 startup
```

测试：

```bash
curl http://127.0.0.1:4174/api/health
curl https://card.beyour.top/api/health
```

## 6. Nginx 反向代理

线上 Nginx 使用三个域名：

- `card.beyour.top` 反向代理到 `127.0.0.1:4174`
- `tomato.beyour.top` 服务番茄基地静态文件，并将 `/api/` 反向代理到 `127.0.0.1:4174`
- `tomatogame.beyour.top` 服务模拟经营静态文件，并将 `/api/` 反向代理到 `127.0.0.1:4174`

闪记卡反向代理示例：

```bash
sudo tee /etc/nginx/sites-available/flashcards >/dev/null <<'EOF'
server {
    listen 80;
    server_name card.beyour.top;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:4174;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/flashcards /etc/nginx/sites-enabled/flashcards
sudo nginx -t
sudo systemctl reload nginx
```

HTTPS 使用 `certbot --nginx` 为 `card.beyour.top`、`tomato.beyour.top`、`tomatogame.beyour.top` 签发证书，并强制 HTTP 跳转 HTTPS。

## 7. 数据位置

数据文件在：

```text
data/flashcards.sqlite
```

建议定期备份这个文件。

## 8. 登录与用户隔离

打开站点会先进入登录页。所有新账号（包括首次初始化）都必须填写有效邀请码，已有账号照常登录。每个账号只能访问、修改和删除自己的卡组、卡片、复习记录和设置；首个账号仍会接管旧版未绑定用户的数据。

在服务器的 `.env` 中配置 `REGISTRATION_INVITE_CODE`，登录页才会出现“有邀请码，创建账号”。邀请码区分大小写，可重复使用；只向受邀者私下提供，不要提交到 Git 或写入网页。建议生成至少 16 位随机邀请码。修改后重启服务生效。

```bash
REGISTRATION_INVITE_CODE=替换为随机邀请码
```

未配置或清空 `REGISTRATION_INVITE_CODE` 时关闭注册，即使旧的 `ALLOW_REGISTRATION=true` 仍在环境中也不能绕过邀请码。更换邀请码后，旧邀请码立即失效，已有账号不受影响。服务器仍限制每个来源 IP 每小时最多 5 次注册尝试。

番茄基地及番茄经营的共用登录页源文件为 `deploy/tomatoes-login.html`，发布脚本会同步到 `/srv/beyour/tomatoes/login/index.html`；闪记卡使用应用内登录页，两者调用同一套注册接口。

线上是 HTTPS 访问，启动时应启用安全 Cookie 和跨子域名 Cookie：

```bash
COOKIE_SECURE=true COOKIE_DOMAIN=.beyour.top PORT=4174 HOST=127.0.0.1 pm2 start dist-server/server/index.js --name flashcards --update-env
```
