import { createGameServer } from "./app.ts";
import { databaseConfigFromEnv, openDatabase } from "./db/database.ts";
import { migrate } from "./db/migrate.ts";
import { log } from "./log.ts";

const port = Number(process.env.PORT ?? 2567);

const db = await openDatabase(databaseConfigFromEnv());
log.info("server", `database: ${db.describe()}`);
if (process.env.DB_MIGRATE_ON_START !== "false") {
  const applied = await migrate(db);
  if (applied.length) log.info("server", `applied migrations: ${applied.join(", ")}`);
}

const server = createGameServer({ db });
await server.listen(port, "0.0.0.0");
log.info("server", `Padova Life SIM server listening on ws://0.0.0.0:${port}`);

const shutdown = async (signal: string) => {
  log.info("server", `${signal} received, shutting down`);
  await server.gracefullyShutdown(false);
  await db.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
