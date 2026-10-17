// Minimal structured logger. Silenced with LOG_LEVEL=silent (used by tests).

type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const threshold = order[(process.env.LOG_LEVEL as Level | "silent") ?? "info"] ?? order.info;

function write(level: Level, scope: string, message: string): void {
  if (order[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${message}`;
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (scope: string, message: string) => write("debug", scope, message),
  info: (scope: string, message: string) => write("info", scope, message),
  warn: (scope: string, message: string) => write("warn", scope, message),
  error: (scope: string, message: string) => write("error", scope, message),
};
