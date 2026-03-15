/**
 * Normaliza películas en la BD (títulos, años inválidos, etc.).
 * Por ahora: corrige películas cuyo año guardado es mayor al año actual
 * (ej. "2067" tomado como año en vez de título) re-fetchando la ficha y actualizando nombre y año.
 *
 * Uso: node src/normalize-movies.js
 *   o: npm run normalize-movies
 */

import 'dotenv/config';
import { getDb } from './db.js';
import { getMovieVipLink } from './scraper.js';
import { parseTitleInfo } from './catalogo.js';
import { cleanMovieTitle } from './filters.js';

const DELAY_MS = 600;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function normalizeMoviesWithInvalidYear() {
  const db = await getDb();
  const currentYear = new Date().getFullYear();

  const rows = await db.all(
    `SELECT id, title, year, peliculasgd_url FROM movies
     WHERE year IS NOT NULL AND year <> '' AND CAST(year AS INTEGER) > ?
     ORDER BY id`,
    currentYear
  );

  if (!rows.length) {
    console.log(`No hay películas con año > ${currentYear}. Nada que normalizar.`);
    await db.close();
    return { updated: 0, errors: 0 };
  }

  console.log(`Normalizar películas (año > ${currentYear})\n`);
  console.log(`Encontradas: ${rows.length}\n`);

  let updated = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const movie = rows[i];
    process.stdout.write(`  [${i + 1}/${rows.length}] id=${movie.id} "${movie.title.slice(0, 40)}..." `);

    if (!movie.peliculasgd_url) {
      console.log('sin peliculasgd_url, omitida');
      continue;
    }

    let data;
    try {
      data = await getMovieVipLink(movie.peliculasgd_url);
    } catch (err) {
      errors++;
      console.log(`error: ${err?.message || err}`);
      if (i < rows.length - 1) await delay(DELAY_MS);
      continue;
    }

    const { year, quality } = parseTitleInfo(data.title, { maxYear: currentYear });
    const baseTitle = cleanMovieTitle(data.title, { year, quality });
    const suffixParts = [];
    if (year) suffixParts.push(`(${year})`);
    if (quality) suffixParts.push(`[${quality}]`);
    const finalTitle = suffixParts.length
      ? `${baseTitle} ${suffixParts.join(' - ')}`
      : baseTitle;

    await db.run('UPDATE movies SET title = ?, year = ? WHERE id = ?', finalTitle, year || null, movie.id);
    updated++;
    console.log(`→ "${finalTitle.slice(0, 50)}..."`);

    if (i < rows.length - 1) await delay(DELAY_MS);
  }

  await db.close();
  console.log('');
  console.log(`Actualizadas: ${updated} | Errores: ${errors}`);
  return { updated, errors };
}

async function main() {
  try {
    console.log('Scrapgd — Normalizar películas\n');
    await normalizeMoviesWithInvalidYear();
    console.log('Listo.');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
