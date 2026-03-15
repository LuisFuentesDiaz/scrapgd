/**
 * Retries VIP link extraction for movies that have no rows in vip_links.
 * Uses vip_url to fetch the download links page directly.
 *
 * Usage: node src/retry-missing-links.js
 *    or: npm run retry-links
 */

import 'dotenv/config';
import { getDb } from './db.js';
import { extractVipLinks } from './vip-browser.js';
import { getFuenteFromUrl, getPreviewFromUrl } from './utils.js';

const DELAY_BETWEEN_MOVIES_MS = 800;
const MAX_PASSES = 2;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function retryMoviesMissingLinks() {
  const db = await getDb();

  const missing = await db.all(
    `SELECT id, title, vip_url FROM v_movies_sin_vip_links
     WHERE vip_url IS NOT NULL AND COALESCE(download_attempts, 0) < 3
     ORDER BY id`
  );

  if (!missing.length) {
    console.log('No hay películas sin enlaces (con vip_url y menos de 3 intentos). Nada que reejecutar.');
    await db.close();
    return { processed: 0, withLinks: 0, stillMissing: 0 };
  }

  console.log(`Películas sin links con vip_url: ${missing.length}\n`);

  let withLinks = 0;
  let stillMissing = 0;

  for (let i = 0; i < missing.length; i++) {
    const movie = missing[i];
    process.stdout.write(`  [${i + 1}/${missing.length}] ${movie.title.slice(0, 50)}...`);

    let links = [];
    try {
      links = await extractVipLinks(movie.vip_url);
    } catch (err) {
      console.log(` error: ${err?.message || err}`);
      if (i < missing.length - 1) await delay(DELAY_BETWEEN_MOVIES_MS);
      continue;
    }

    if (links.length) {
      for (const url of links) {
        const source = getFuenteFromUrl(url);
        const preview = getPreviewFromUrl(url);
        await db.run(
          'INSERT OR IGNORE INTO vip_links (movie_id, url, source, preview) VALUES (?, ?, ?, ?)',
          movie.id,
          url,
          source,
          preview
        );
      }
      withLinks++;
      console.log(` OK (${links.length} links)`);
    } else {
      stillMissing++;
      await db.run('UPDATE movies SET download_attempts = COALESCE(download_attempts, 0) + 1 WHERE id = ?', movie.id);
      console.log(' 0 links');
    }

    if (i < missing.length - 1) {
      const delayMs = links.length > 0 ? 400 + Math.round(Math.random() * 400) : DELAY_BETWEEN_MOVIES_MS;
      await delay(delayMs);
    }
  }

  await db.close();
  console.log('');
  console.log(`Procesadas: ${missing.length} | Con enlaces insertados: ${withLinks} | Siguen sin enlaces: ${stillMissing}`);
  return { processed: missing.length, withLinks, stillMissing };
}

async function main() {
  try {
    console.log('Scrapgd — Reejecutar enlaces VIP (hasta 2 vueltas)\n');

    for (let pass = 1; pass <= MAX_PASSES; pass++) {
      console.log(`--- Vuelta ${pass}/${MAX_PASSES} ---\n`);
      const result = await retryMoviesMissingLinks();
      if (result.processed === 0) break;
    }

    console.log('Listo.');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
