/**
 * Normaliza películas en la BD (títulos, años inválidos, etc.).
 * Por ahora: corrige películas cuyo año guardado es mayor al año actual
 * (ej. "2067" tomado como año en vez de título) re-fetchando la ficha y actualizando nombre y año.
 *
 * Uso: node src/normalize-movies.js
 *   o: npm run normalize-movies
 */

import 'dotenv/config';
import { existsSync } from 'fs';
import { getDb } from './db.js';
import { getMovieVipLink } from './scraper.js';
import { parseTitleInfo } from './catalogo.js';
import { cleanMovieTitle } from './filters.js';
import {
  getGDriveDownloadUrl,
  getGDriveFileSizeFromDownloadPage,
  getGDriveFileSizeWithPage,
  getGDriveStateFilePath,
  getGDriveFileId,
  CHROME_USER_AGENT,
  DEFAULT_VIEWPORT,
} from './utils.js';

const DELAY_MS = 600;
const DELAY_GDRIVE_PESO_MS = 0;
/** Cuántas películas se procesan en paralelo al obtener peso de Drive (más = más rápido, más riesgo de rate limit). */
const GDRIVE_PESO_CONCURRENCY = 5;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Normaliza TODOS los enlaces de Google Drive en vip_links:
 * a partir del ID genera:
 *  - url         → https://drive.google.com/file/d/ID/view
 *  - preview     → https://drive.google.com/file/d/ID/preview
 *  - download_url→ https://drive.google.com/uc?export=download&id=ID
 */
export async function normalizeVipLinksGDriveUrls() {
  const db = await getDb();

  const rows = await db.all(
    `SELECT id, movie_id, url, preview, download_url, file_size
     FROM vip_links
     WHERE source = 'Google Drive'
       AND LOWER(url) NOT LIKE '%folder%'`);

  if (!rows.length) {
    console.log('No hay enlaces VIP de Google Drive para normalizar URLs.');
    await db.close();
    return { updated: 0, withoutId: 0 };
  }

  console.log('Normalizar URLs de Google Drive en vip_links\n');
  console.log(`Encontrados: ${rows.length} enlaces de Google Drive\n`);

  let updated = 0;
  let withoutId = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const candidateUrl = row.url || '';
    const candidatePreview = row.preview || '';
    const candidateDownload = row.download_url || '';

    const id =
      getGDriveFileId(candidateUrl) ||
      getGDriveFileId(candidatePreview) ||
      getGDriveFileId(candidateDownload);

    if (!id) {
      withoutId++;
      continue;
    }

    const viewUrl = `https://drive.google.com/file/d/${id}/view`;
    const previewUrl = `https://drive.google.com/file/d/${id}/preview`;
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${id}`;

    try {
      await db.run(
        `UPDATE vip_links
         SET url = ?, preview = ?, download_url = ?, file_size = NULL
         WHERE id = ?`,
        viewUrl,
        previewUrl,
        downloadUrl,
        row.id
      );

      // Actualizar fecha de la película para reflejar normalización
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await db.run('UPDATE movies SET upload_date = ? WHERE id = ?', now, row.movie_id);

      updated++;
    } catch (err) {
      // Si la URL normalizada choca con el UNIQUE (movie_id, url), saltamos esta fila y seguimos.
      if (err && err.code === 'SQLITE_CONSTRAINT') {
        console.log(
          `Saltando vip_link id=${row.id} (movie_id=${row.movie_id}) por conflicto UNIQUE con url normalizada`
        );
        continue;
      }
      throw err;
    }

    if ((i + 1) % 100 === 0) process.stdout.write(`  ${i + 1}/${rows.length}\r`);
  }

  await db.close();
  console.log('');
  console.log(`Enlaces GDrive normalizados: ${updated} | Sin ID detectable: ${withoutId}`);
  return { updated, withoutId };
}

/**
 * Rellena file_size (peso) en vip_links. El peso se obtiene desde la URL de descarga de Google Drive
 * (span.uc-name-size, ej. "2,2G") y se aplica a TODOS los vip_links de esa película (mismo movie_id),
 * ya que el archivo es el mismo (Drive, Mega, MediaFire, etc.).
 * Requiere sesión de Google (.google-drive-state.json) para que Drive muestre esa página.
 */
export async function normalizeVipLinksFileSize() {
  const db = await getDb();

  const rows = await db.all(
    `SELECT id, movie_id, download_url FROM vip_links
     WHERE source = 'Google Drive'
       AND (file_size IS NULL OR file_size = '')
       AND download_url IS NOT NULL AND download_url <> ''
     ORDER BY movie_id, id`
  );

  if (!rows.length) {
    console.log('No hay enlaces VIP de Google Drive sin file_size. Nada que normalizar.');
    await db.close();
    return { updated: 0, errors: 0 };
  }

  // Una película puede tener varios enlaces GDrive; solo necesitamos obtener el peso una vez por movie_id
  const byMovie = new Map();
  for (const row of rows) {
    if (!byMovie.has(row.movie_id)) byMovie.set(row.movie_id, row.download_url);
  }
  const moviesToFetch = Array.from(byMovie.entries());

  console.log('Normalizar file_size (peso) en vip_links\n');
  console.log(`Películas con enlace GDrive sin peso: ${moviesToFetch.length}. El peso se aplicará a todos los enlaces de cada película.\n`);

  const statePath = getGDriveStateFilePath();
  const useSharedBrowser = existsSync(statePath);

  let updatedMovies = 0;
  let errors = 0;

  if (useSharedBrowser) {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      storageState: statePath,
      userAgent: CHROME_USER_AGENT,
      viewport: DEFAULT_VIEWPORT,
    });
    const concurrency = Math.min(GDRIVE_PESO_CONCURRENCY, moviesToFetch.length);
    console.log(`Un solo navegador; ${concurrency} películas en paralelo.\n`);

    for (let i = 0; i < moviesToFetch.length; i += concurrency) {
      const batch = moviesToFetch.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(async ([movieId, downloadUrl]) => {
          const page = await context.newPage();
          try {
            const fileSize = await getGDriveFileSizeWithPage(page, downloadUrl);
            return { movieId, downloadUrl, fileSize, err: null };
          } catch (err) {
            return { movieId, downloadUrl, fileSize: null, err };
          } finally {
            await page.close().catch(() => {});
          }
        })
      );

      for (let j = 0; j < results.length; j++) {
        const { movieId, fileSize, err } = results[j];
        const idx = i + j + 1;
        process.stdout.write(`  [${idx}/${moviesToFetch.length}] movie_id=${movieId} ... `);
        if (err) {
          errors++;
          await db.run("UPDATE vip_links SET file_size = 'fail' WHERE movie_id = ?", movieId);
          console.log(`error: ${err?.message || err} (guardado fail)`);
          continue;
        }
        if (fileSize) {
          const result = await db.run('UPDATE vip_links SET file_size = ? WHERE movie_id = ?', fileSize, movieId);
          updatedMovies++;
          const linkCount = result?.changes ?? 0;
          console.log(`${fileSize} (${linkCount} enlaces actualizados)`);
        } else {
          await db.run("UPDATE vip_links SET file_size = 'fail' WHERE movie_id = ?", movieId);
          console.log('(no obtenido, guardado fail)');
        }
      }

      if (i + concurrency < moviesToFetch.length) {
        await delay(DELAY_GDRIVE_PESO_MS + Math.round(Math.random() * 50));
      }
    }

    await browser.close();
  } else {
    console.log('Sin sesión de Google (.google-drive-state.json); se usa axios por película.\n');
    for (let i = 0; i < moviesToFetch.length; i++) {
      const [movieId, downloadUrl] = moviesToFetch[i];
      process.stdout.write(`  [${i + 1}/${moviesToFetch.length}] movie_id=${movieId} ... `);
      try {
        const fileSize = await getGDriveFileSizeFromDownloadPage(downloadUrl);
        if (fileSize) {
          const result = await db.run('UPDATE vip_links SET file_size = ? WHERE movie_id = ?', fileSize, movieId);
          updatedMovies++;
          const linkCount = result?.changes ?? 0;
          console.log(`${fileSize} (${linkCount} enlaces actualizados)`);
        } else {
          await db.run("UPDATE vip_links SET file_size = 'fail' WHERE movie_id = ?", movieId);
          console.log('(no obtenido, guardado fail)');
        }
      } catch (err) {
        errors++;
        await db.run("UPDATE vip_links SET file_size = 'fail' WHERE movie_id = ?", movieId);
        console.log(`error: ${err?.message || err} (guardado fail)`);
      }
    }
  }

  await db.close();
  console.log('');
  console.log(`Películas actualizadas: ${updatedMovies} | Errores: ${errors}`);
  return { updated: updatedMovies, errors };
}

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
    console.log('Scrapgd — Normalizar\n');

    console.log('--- 1) Normalizar URLs de Google Drive (url / preview / download_url) ---\n');
    //await normalizeVipLinksGDriveUrls();

    console.log('\n--- 3) Rellenar file_size (peso) en vip_links (por película; se aplica a todos los enlaces) ---\n');
    await normalizeVipLinksFileSize();

    console.log('\n--- 4) Corregir títulos/años inválidos en movies ---\n');
    //await normalizeMoviesWithInvalidYear();

    console.log('\nListo.');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
