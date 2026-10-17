// Starts the game server and the Vite client together for local development.
// Kept dependency-free on purpose; Ctrl+C stops both processes.
import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

const processes = [
  { name: "server", args: ["run", "dev", "-w", "server"] },
  { name: "client", args: ["run", "dev", "-w", "client"] },
].map(({ name, args }) => {
  const child = spawn(npm, args, { stdio: ["ignore", "pipe", "pipe"], shell: isWindows });
  const prefix = (stream, target) =>
    stream.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.trim()) target.write(`[${name}] ${line}\n`);
      }
    });
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`[${name}] exited with code ${code}`);
    shutdown(code ?? 1);
  });
  return child;
});

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of processes) child.kill();
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
