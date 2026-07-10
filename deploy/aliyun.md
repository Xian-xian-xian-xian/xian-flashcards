# 阿里云 ECS 部署步骤

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

首次部署新版后，打开站点会先进入登录页。第一个注册的账号会自动接管旧版未绑定用户的数据；之后每个账号只能访问、修改和删除自己的卡组、卡片、复习记录和设置。为了避免公网用户随便注册，创建第一个账号后，后续注册会默认关闭。

如果你要临时开放注册给其他人创建账号，可以启动时加上：

```bash
ALLOW_REGISTRATION=true PORT=4174 HOST=0.0.0.0 pm2 start pnpm --name flashcards -- start:remote
```

线上是 HTTPS 访问，启动时应启用安全 Cookie 和跨子域名 Cookie：

```bash
COOKIE_SECURE=true COOKIE_DOMAIN=.beyour.top PORT=4174 HOST=127.0.0.1 pm2 start dist-server/server/index.js --name flashcards --update-env
```
