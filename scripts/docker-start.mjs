import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const root = process.cwd();

// Load environment variables if available
dotenv.config({ path: path.join(root, ".env.local") });
dotenv.config({ path: path.join(root, ".env") });

const dataDir = process.env.LOCAL_DB_PATH
  ? path.dirname(path.resolve(process.env.LOCAL_DB_PATH))
  : path.join(root, ".beeblio");
mkdirSync(dataDir, { recursive: true });

// Ensure /projects directory exists if writable
try {
  mkdirSync("/projects", { recursive: true });
} catch {
  // Ignored if non-root or filesystem read-only
}

const env = {
  ...process.env,
  LOCAL_DB_PATH: process.env.LOCAL_DB_PATH || path.join(dataDir, "beeblio.sqlite"),
  AGENT_URL: process.env.AGENT_URL || "http://127.0.0.1:2000",
  HOSTNAME: process.env.HOSTNAME || "0.0.0.0",
  PORT: process.env.PORT || "3000",
};

function resolveBin(name) {
  if (process.platform === "win32") {
    return { cmd: "pnpm", prefixArgs: ["exec", name], shell: true };
  }
  const localBin = path.join(root, "node_modules", ".bin", name);
  if (existsSync(localBin)) {
    return { cmd: localBin, prefixArgs: [], shell: false };
  }
  return { cmd: "pnpm", prefixArgs: ["exec", name], shell: false };
}

function run(name, args) {
  return new Promise((resolve, reject) => {
    const { cmd, prefixArgs, shell } = resolveBin(name);
    const child = spawn(cmd, [...prefixArgs, ...args], { cwd: root, env, stdio: "inherit", shell });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${name} exited with code ${code}`))
    );
  });
}

console.log("==> Applying database migrations...");
try {
  await run("drizzle-kit", ["migrate"]);
  console.log("==> Database migrations applied successfully.");
} catch (error) {
  console.error("==> Database migration failed:", error);
  process.exit(1);
}

const isDev = process.env.NODE_ENV === "development";
console.log(`==> Starting Beeblio in ${isDev ? "development" : "production"} mode...`);
console.log(`==> Web UI will be available at http://${env.HOSTNAME === "0.0.0.0" ? "localhost" : env.HOSTNAME}:${env.PORT}`);
console.log(`==> Eve agent running internally at ${env.AGENT_URL}`);

const nextTarget = resolveBin("next");
const eveTarget = resolveBin("eve");

const children = isDev
  ? [
      spawn(nextTarget.cmd, [...nextTarget.prefixArgs, "dev", "--hostname", env.HOSTNAME, "--port", env.PORT], {
        cwd: root,
        env,
        stdio: "inherit",
        shell: nextTarget.shell,
      }),
      spawn(eveTarget.cmd, [...eveTarget.prefixArgs, "dev", "--no-ui", "--host", "127.0.0.1", "--port", "2000"], {
        cwd: root,
        env,
        stdio: "inherit",
        shell: eveTarget.shell,
      }),
    ]
  : [
      spawn(nextTarget.cmd, [...nextTarget.prefixArgs, "start", "--hostname", env.HOSTNAME, "--port", env.PORT], {
        cwd: root,
        env,
        stdio: "inherit",
        shell: nextTarget.shell,
      }),
      spawn(eveTarget.cmd, [...eveTarget.prefixArgs, "start", "--host", "127.0.0.1", "--port", "2000"], {
        cwd: root,
        env,
        stdio: "inherit",
        shell: eveTarget.shell,
      }),
    ];

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  console.log("==> Stopping Beeblio services...");
  for (const child of children) {
    try {
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/pid", child.pid.toString(), "/T", "/F"], { stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      // Child process might already have terminated
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, stop);
}

for (const child of children) {
  child.once("error", (error) => {
    console.error("Subprocess error:", error);
    stop();
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    if (!stopping) {
      console.error(`Subprocess exited with code ${code}`);
      stop();
      process.exitCode = code || 1;
    }
  });
}
