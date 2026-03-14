/**
 * Inicializa solo la base de datos (tablas + vista).
 * No ejecuta scraping. Útil para crear/verificar scrapgd.db.
 *
 * Uso: npm run db
 */
import 'dotenv/config';
import { getDb } from './db.js';

async function main() {
  const db = await getDb();
  console.log('BD inicializada: scrapgd.db (tablas y vista listas)');
  const count = await db.get('SELECT COUNT(*) AS n FROM movies');
  console.log('Películas en BD:', count?.n ?? 0);
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
