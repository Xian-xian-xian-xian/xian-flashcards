# Agent Notes

## Local Build

The default shell may not have `node` on `PATH`. For this project, verify local builds with the Codex bundled Node runtime:

```bash
PATH="/Users/xian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/xian/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin:$PATH" pnpm build
```

## UI Writing And Emphasis

Do not overuse bold text in the web UI. Use bold only for important hierarchy, status, key values, or true emphasis; ordinary labels, helper text, list names, and repeated metadata should use normal or medium weight styling instead.

## ECS Deploy

Do not use the retired server IP as a public entry. Current production entry points are:

- Flashcards: `https://card.beyour.top/`
- Tomato base: `https://tomato.beyour.top/`
- Tomato game: `https://tomatogame.beyour.top/`

Run ECS deployment in visible steps so failures are easy to locate:

```bash
ssh -i ~/.ssh/codex_aliyun_flashcards -o IdentitiesOnly=yes ecs-user@114.55.96.20 'cd /srv/beyour/flashcards; pnpm install'
ssh -i ~/.ssh/codex_aliyun_flashcards -o IdentitiesOnly=yes ecs-user@114.55.96.20 'cd /srv/beyour/flashcards; pnpm build'
ssh -i ~/.ssh/codex_aliyun_flashcards -o IdentitiesOnly=yes ecs-user@114.55.96.20 'pm2 restart flashcards --update-env; pm2 save'
curl https://card.beyour.top/api/health
```
