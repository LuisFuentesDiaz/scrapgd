import 'dotenv/config';
import { scrapePeliculasGd, getMovieVipLink } from './scraper.js';
import { extractVipLinks } from './vip-browser.js';
import { parseTitleInfo } from './catalogo.js';
import { getDb } from './db.js';
import { cleanMovieTitle } from './filters.js';
import { getFuenteFromUrl, getPreviewFromUrl, getGDriveDownloadUrl, getGDriveFileSizeFromDownloadPage, isGDriveLinkExcluded, delay as utilDelay } from './utils.js';

const PELICULAS_GD_URL = 'https://www.peliculasgd.net/';
const PAGINAS_A_PROCESAR = 0; // cantidad de páginas a recorrer
const PAGINA_COMIENZO = parseInt(process.env.SCRAPGD_PAGE_START, 10) || 1; // páginas ya recorridas (0 = desde la 1); ej. 10 → se recorren de la 11 a la 10+PAGINAS_A_PROCESAR
const DELAY_ENTRE_PELICULAS_MS = 800;
const DELAY_PELICULA_EXISTE_MS = 501;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const pageFrom = Math.max(1, PAGINA_COMIENZO); // primera página a recorrer (comienzo 10 → empezamos en la 11)
  const pageTo = PAGINA_COMIENZO + PAGINAS_A_PROCESAR;
  console.log('Scrapgd — PeliculasGD.net\n');
  console.log(`Páginas: ${pageFrom} a ${pageTo} (${PAGINAS_A_PROCESAR} páginas${PAGINA_COMIENZO > 0 ? `, empezando después de la página ${PAGINA_COMIENZO}` : ''})\n`);

  const db = await getDb();
  let totalNuevas = 0;
  let totalOmitidas = 0;

  for (let p = pageFrom; p <= pageTo; p++) {
    const url = p === 1 ? PELICULAS_GD_URL : `${PELICULAS_GD_URL}page/${p}/`;
    let pageTitle, entries;
    try {
      const result = await scrapePeliculasGd(url);
      pageTitle = result.pageTitle;
      entries = result.entries;
    } catch (err) {
      console.log(`Página ${p}: error (${err?.code === 'ECONNABORTED' ? 'timeout' : err?.message || err}), se omite`);
      continue;
    }
    console.log(`Página ${p}: ${pageTitle} — ${entries.length} películas`);

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      process.stdout.write(`  [${i + 1}/${entries.length}] ${e.title.slice(0, 50)}...`);

      // 1) ¿Ya existe esta ficha en BD? (por URL de PeliculasGD)
      const existing = await db.get(
        'SELECT id FROM movies WHERE peliculasgd_url = ?',
        e.url,
      );
      if (existing) {
        totalOmitidas++;
        console.log(' ya en BD, omitida');
        if (i < entries.length - 1) await delay(DELAY_PELICULA_EXISTE_MS);
        continue;
      }

      // 2) Scraping normal de ficha + VIP
      let hadLinks = false;
      try {
        const data = await getMovieVipLink(e.url);
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

        // Reconstruir título mostrando año y calidad normalizados: "Nombre (año) - [calidad]"
        let finalTitle = baseTitle;
        const suffixParts = [];
        if (year) suffixParts.push(`(${year})`);
        if (quality) suffixParts.push(`[${quality}]`);
        if (suffixParts.length) {
          finalTitle = `${baseTitle} ${suffixParts.join(' - ')}`;
        }

        // 3) Insertar en BD (upload_date = ahora, download_attempts = 0)
        const uploadDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const result = await db.run(
          'INSERT INTO movies (page_number, title, year, quality, peliculasgd_url, vip_url, url_poster, download_attempts, upload_date) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
          p,
          finalTitle,
          year || null,
          quality || null,
          data.url,
          data.vipLink || null,
          e.posterUrl || data.posterUrl || null,
          uploadDate,
        );
        const movieId = result.lastID;

        // Si no se obtuvieron enlaces, contar este intento fallido
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

        totalNuevas++;
        hadLinks = vipLinks.length > 0;
        const badge = data.vipLink ? (vipLinks.length ? ` OK (${vipLinks.length} links)` : ' OK (0 links)') : ' (sin VIP)';
        console.log(badge);
      } catch (err) {
        const msg = err?.code === 'ECONNABORTED' ? 'timeout' : (err?.message || String(err));
        console.log(` error (${msg}), se omite`);
      }

      if (i < entries.length - 1) {
        const delayMs = hadLinks ? 400 + Math.round(Math.random() * 400) : DELAY_ENTRE_PELICULAS_MS;
        await delay(delayMs);
      }
    }

    console.log('');
  }

  console.log(`Películas nuevas insertadas en BD: ${totalNuevas}`);
  console.log(`Películas omitidas por existir ya en BD: ${totalOmitidas}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
