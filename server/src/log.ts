// Minimal structured logger. Silenced with LOG_LEVEL=silent (used by tests).
// LOG_FORMAT=json writes one JSON object per line (time, level, scope,
// message) for hosting log collectors (M12); the default is plain text.

type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const threshold = order[(process.env.LOG_LEVEL as Level | "silent") ?? "info"] ?? order.info;
const json = process.env.LOG_FORMAT === "json";

/** One log line in the chosen format. */
export function formatLine(level: Level, scope: string, message: string, asJson: boolean, time = new Date()): string {
  if (asJson) return JSON.stringify({ time: time.toISOString(), level, scope, message });
  return `${time.toISOString()} ${level.toUpperCase()} [${scope}] ${message}`;
}

function write(level: Level, scope: string, message: string): void {
  if (order[level] < threshold) return;
  const line = formatLine(level, scope, message, json);
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (scope: string, message: string) => write("debug", scope, message),
  info: (scope: string, message: string) => write("info", scope, message),
  warn: (scope: string, message: string) => write("warn", scope, message),
  error: (scope: string, message: string) => write("error", scope, message),
};
