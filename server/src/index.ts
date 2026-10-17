import { createGameServer } from "./app.ts";
import { log } from "./log.ts";

const port = Number(process.env.PORT ?? 2567);
const server = createGameServer();

await server.listen(port, "0.0.0.0");
log.info("server", `Padova Life SIM server listening on ws://0.0.0.0:${port}`);

const shutdown = async (signal: string) => {
  log.info("server", `${signal} received, shutting down`);
  await server.gracefullyShutdown(false);
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
