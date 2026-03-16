/**
 * Ejecución complementaria por consola: extrae la información de una sola
 * página de detalle de PeliculasGD y la guarda en la BD.
 *
 * Uso:
 *   node src/fetch-detail.js "https://www.peliculasgd.net/..."
 *   npm run fetch-detail -- "https://www.peliculasgd.net/..."
 */

import 'dotenv/config';
import { getMovieVipLink } from './scraper.js';
import { extractVipLinks } from './vip-browser.js';
import { parseTitleInfo } from './catalogo.js';
import { getDb } from './db.js';
import { cleanMovieTitle } from './filters.js';
import { getFuenteFromUrl, getPreviewFromUrl, getGDriveDownloadUrl, getGDriveFileSizeFromDownloadPage, isGDriveLinkExcluded, delay as utilDelay } from './utils.js';

function getDetailUrlFromArgs() {
  const url = process.argv[2];
  if (!url || !url.trim()) {
    console.error('Uso: node src/fetch-detail.js <URL de detalle PeliculasGD>');
    console.error('Ejemplo: node src/fetch-detail.js "https://www.peliculasgd.net/pelicula/..."');
    process.exit(1);
  }
  return url.trim();
}

async function main() {
  const detailUrl = getDetailUrlFromArgs();
  console.log('Scrapgd — Extracción por URL de detalle\n');
  console.log('URL:', detailUrl);
  console.log('');

  const db = await getDb();

  const existing = await db.get('SELECT id, title FROM movies WHERE peliculasgd_url = ?', detailUrl);
  if (existing) {
    console.log(`Ya existe en BD: "${existing.title}" (id ${existing.id}). Omitida.`);
    await db.close();
    return;
  }

  try {
    const data = await getMovieVipLink(detailUrl);
    let vipLinks = [];
    if (data.vipLink) {
      vipLinks = (await extractVipLinks(data.vipLink)).filter((item) => {
        const url = typeof item === 'string' ? item : item.url;
        return !isGDriveLinkExcluded(url);
      });
    }

    const currentYear = new Date().getFullYear();
    const { year, quality } = parseTitleInfo(data.title, { maxYear: currentYear });
    const baseTitle = cleanMovieTitle(data.title, { year, quality });

    let finalTitle = baseTitle;
    const suffixParts = [];
    if (year) suffixParts.push(`(${year})`);
    if (quality) suffixParts.push(`[${quality}]`);
    if (suffixParts.length) {
      finalTitle = `${baseTitle} ${suffixParts.join(' - ')}`;
    }

    const uploadDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const result = await db.run(
      `INSERT INTO movies (page_number, title, year, quality, peliculasgd_url, vip_url, url_poster, download_attempts, upload_date)
       VALUES (NULL, ?, ?, ?, ?, ?, ?, 0, ?)`,
      finalTitle,
      year || null,
      quality || null,
      data.url,
      data.vipLink || null,
      data.posterUrl || null,
      uploadDate,
    );
    const movieId = result.lastID;

    if (vipLinks.length === 0) {
      await db.run('UPDATE movies SET download_attempts = download_attempts + 1 WHERE id = ?', movieId);
    }

    for (let i = 0; i < vipLinks.length; i++) {
      const item = vipLinks[i];
      const url = typeof item === 'string' ? item : item.url;
      const source = getFuenteFromUrl(url);
      const preview = getPreviewFromUrl(url);
      const isGDrive = source === 'Google Drive';
      const downloadUrl = isGDrive ? (typeof item === 'object' && item.downloadUrl ? item.downloadUrl : getGDriveDownloadUrl(url)) : null;
      let fileSize = null;
      if (downloadUrl) {
        fileSize = await getGDriveFileSizeFromDownloadPage(downloadUrl);
        if (i < vipLinks.length - 1) await utilDelay(400 + Math.round(Math.random() * 300));
      }
      await db.run(
        'INSERT OR IGNORE INTO vip_links (movie_id, url, source, preview, file_size, download_url) VALUES (?, ?, ?, ?, ?, ?)',
        movieId,
        url,
        source,
        preview,
        fileSize,
        downloadUrl,
      );
    }

    const badge = data.vipLink
      ? vipLinks.length
        ? `OK — ${vipLinks.length} enlace(s) guardado(s)`
        : 'OK — 0 enlaces (intento registrado)'
      : 'OK — sin enlace VIP en la página';
    console.log(`Guardado: "${finalTitle}" (id ${movieId}). ${badge}`);
  } catch (err) {
    const msg = err?.code === 'ECONNABORTED' ? 'timeout' : (err?.message || String(err));
    console.error('Error:', msg);
    process.exit(1);
  } finally {
    await db.close();
  }
}

main();
