// `npm run reports` lists recent player reports for the product owner
// (D-042: the owner reviews reports; an admin page comes with sign-in in
// M12). Reports older than the retention period are deleted first, so this
// never shows details that should be gone. Uses the server's database
// configuration (DATABASE_URL or PGLITE_DATA_DIR); with the embedded
// development database, stop the game first (one program at a time).

import { SAFETY_CONFIG, readClock } from "@padova/shared";
import { databaseConfigFromEnv, openDatabase } from "./db/database.ts";
import { listReports, purgeReports } from "./social/socialRepository.ts";

const limit = Math.min(500, Math.max(1, Number(process.argv[2] ?? 50) || 50));
const reasons = new Map<string, string>(SAFETY_CONFIG.reportReasons.map((r) => [r.id, r.label]));
const db = await openDatabase(databaseConfigFromEnv());

async function main(): Promise<void> {
  console.log(`Database: ${db.describe()}`);
  const table = await db.query<{ name: string | null }>(`SELECT to_regclass('public.reports')::text AS name`);
  if (!table.rows[0]?.name) {
    console.log("This database has no reports yet: start the game once (it updates the database) or run npm run db:migrate.");
    return;
  }
  const removed = await purgeReports(db);
  const reports = await listReports(db, limit);
  if (removed > 0) console.log(`Deleted ${removed} report(s) older than ${SAFETY_CONFIG.reportRetentionDays} days.`);
  if (reports.length === 0) {
    console.log("No reports.");
    return;
  }
  console.log(`${reports.length} most recent report(s), newest first (kept ${SAFETY_CONFIG.reportRetentionDays} days):\n`);
  for (const report of reports) {
    console.log(`${report.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC · ${reasons.get(report.reason) ?? report.reason}`);
    console.log(`  Reported: ${report.reportedName} (account ${report.reportedAccount.slice(0, 8)}…) · by ${report.reporterName}`);
    console.log(`  Where: ${report.area}, ${readClock(report.gameMinute).label} game time`);
    if (report.note) console.log(`  Note: ${report.note}`);
    console.log(`  Report id: ${report.id}\n`);
  }
}

try {
  await main();
} finally {
  await db.close();
}
