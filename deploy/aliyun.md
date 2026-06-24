# 阿里云 ECS 部署步骤

## 1. 推荐实例

- 地域：如果主要自己国内访问，选中国大陆离你近的地域；如果不想备案域名，选中国香港。
- 系统：Ubuntu 22.04 LTS。
- 配置：1 核 1G 起步即可，2 核 2G 更舒服。
- 安全组：至少开放 `22`、`80`、`443`。临时测试可开放 `4174`。

## 2. 服务器初始化

SSH 登录服务器后执行：

```bash
sudo apt update
sudo apt install -y curl git nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pnpm pm2
```

## 3. 上传代码

如果代码已经放到 Git 仓库：

```bash
git clone <你的仓库地址> flashcards
cd flashcards
```

如果没有 Git 仓库，可以在本机用 `scp` 上传整个项目，但不要上传 `node_modules`、`dist`、`dist-server`、`data`。

## 4. 构建和启动

```bash
pnpm install
pnpm build
PORT=4174 HOST=0.0.0.0 pm2 start pnpm --name flashcards -- start:remote
pm2 save
pm2 startup
```

测试：

```bash
curl http://127.0.0.1:4174/api/health
```

## 5. Nginx 反向代理

创建配置：

```bash
sudo tee /etc/nginx/sites-available/flashcards >/dev/null <<'EOF'
server {
    listen 80;
    server_name _;

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

之后访问服务器公网 IP 即可。

## 6. 数据位置

数据文件在：

```text
data/flashcards.sqlite
```

建议定期备份这个文件。
