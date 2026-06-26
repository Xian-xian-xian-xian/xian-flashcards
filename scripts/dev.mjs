import { spawn } from "node:child_process";
import net from "node:net";

const preferredPort = Number(process.env.PORT ?? 4174);
const host = process.env.HOST ?? "0.0.0.0";

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findPort(start) {
  for (let port = start; port < start + 50; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`找不到可用的 API 端口：${start}-${start + 49}`);
}

const port = await findPort(preferredPort);
const env = {
  ...process.env,
  HOST: host,
  PORT: String(port),
  VITE_API_TARGET: `http://127.0.0.1:${port}`
};

const concurrentlyBin = process.platform === "win32" ? "concurrently.cmd" : "concurrently";
const child = spawn(
  concurrentlyBin,
  ["-n", "api,web", "-c", "orange,cyan", "tsx watch server/index.ts", "vite --host 0.0.0.0"],
  { env, stdio: "inherit" }
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
