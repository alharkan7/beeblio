import { spawn } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const root = process.cwd();
dotenv.config({ path: path.join(root, ".env.local") });
dotenv.config({ path: path.join(root, ".env") });
const dataDir = path.join(root, ".beeblio");
mkdirSync(dataDir, { recursive: true });

const eveStateFile = path.join(root, ".eve", "dev-server-state.v1.json");
if (existsSync(eveStateFile)) {
  try {
    unlinkSync(eveStateFile);
  } catch {}
}

const env = { ...process.env, LOCAL_DB_PATH: process.env.LOCAL_DB_PATH || path.join(dataDir, "beeblio.sqlite"), AGENT_URL: "http://127.0.0.1:2000" };
const isWin = process.platform === "win32";

function getCmd(name) {
  if (isWin) {
    return { cmd: "pnpm", prefixArgs: ["exec", name], shell: true };
  }
  return { cmd: path.join(root, "node_modules", ".bin", name), prefixArgs: [], shell: false };
}

function run(name, args) {
  return new Promise((resolve, reject) => {
    const target = getCmd(name);
    const child = spawn(target.cmd, [...target.prefixArgs, ...args], { cwd: root, env, stdio: "inherit", shell: target.shell });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${name} exited with ${code}`)));
  });
}

await run("drizzle-kit", ["migrate"]);

const nextTarget = getCmd("next");
const eveTarget = getCmd("eve");

const children = [
  spawn(nextTarget.cmd, [...nextTarget.prefixArgs, "dev", "--hostname", "127.0.0.1"], { cwd: root, env, stdio: "inherit", shell: nextTarget.shell }),
  spawn(eveTarget.cmd, [...eveTarget.prefixArgs, "dev", "--no-ui", "--host", "127.0.0.1", "--port", "2000"], { cwd: root, env, stdio: "inherit", shell: eveTarget.shell }),
];

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (isWin && child.pid) {
      try {
        spawn("taskkill", ["/pid", child.pid.toString(), "/T", "/F"], { stdio: "ignore" });
      } catch {}
    } else {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
for (const child of children) {
  child.once("error", (error) => { console.error(error); stop(); process.exitCode = 1; });
  child.once("exit", (code) => { if (!stopping) { console.error(`Local server exited (${code})`); stop(); process.exitCode = code || 1; } });
}

