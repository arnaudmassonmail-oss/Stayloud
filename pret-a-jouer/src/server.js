import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './db.js';
import { createApp } from './app.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = openDb(process.env.DB_FILE || join(root, 'data', 'pret-a-jouer.sqlite'));
const handler = createApp(db, { publicDir: join(root, 'public'), fuzzSecret: process.env.FUZZ_SECRET });
const port = Number(process.env.PORT) || 8790;

createServer(handler).listen(port, () => {
  console.log(`Prêt'à Jouer : http://localhost:${port}`);
});
