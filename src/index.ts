import { config as loadEnv } from 'dotenv';
loadEnv({ quiet: true });
import { cleanupClicks, openDatabase } from './db.js';
import { createServer } from './server.js';

const db = openDatabase(process.env.DATABASE_PATH ?? './data/links.db');
const retentionDays = Math.max(0, Number(process.env.CLICK_RETENTION_DAYS ?? 365) || 0);

const app = createServer(db);
const port = Number(process.env.PORT ?? 3200);
const host = process.env.HOST ?? '0.0.0.0';
const server = app.listen(port, host, () =>
  console.log(`Link shortener listening on http://${host}:${port}`)
);
server.on('error', (error) => {
  console.error(`Cannot listen on port ${port}: ${error.message}`);
  process.exit(1);
});

cleanupClicks(db, retentionDays);
const cleanupTimer = setInterval(() => cleanupClicks(db, retentionDays), 24 * 60 * 60 * 1000);

function shutdown() {
  clearInterval(cleanupTimer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
