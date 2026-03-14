import 'dotenv/config';
import { scrapePeliculasGd, getMovieVipLink } from './scraper.js';
import { extractVipLinks } from './vip-browser.js';
import { parseTitleInfo } from './catalogo.js';
import { getDb } from './db.js';
import { cleanMovieTitle } from './filters.js';
import { getFuenteFromUrl, getPreviewFromUrl } from './utils.js';

const PELICULAS_GD_URL = 'https://www.peliculasgd.net/';
const PAGINAS_A_PROCESAR = 200; // Página 1 (portada) y página 2
const DELAY_ENTRE_PELICULAS_MS = 800;
const DELAY_PELICULA_EXISTE_MS = 501;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('Scrapgd — PeliculasGD.net\n');

  const db = await getDb();
  let totalNuevas = 0;
  let totalOmitidas = 0;

  for (let p = 1; p <= PAGINAS_A_PROCESAR; p++) {
    const url = p === 1 ? PELICULAS_GD_URL : `${PELICULAS_GD_URL}page/${p}/`;
    const { pageTitle, entries } = await scrapePeliculasGd(url);
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
      const data = await getMovieVipLink(e.url);
      let vipLinks = [];
      if (data.vipLink) {
        vipLinks = await extractVipLinks(data.vipLink);
      }

      const { year, quality } = parseTitleInfo(data.title);
      const baseTitle = cleanMovieTitle(data.title, { year, quality });

      // Reconstruir título mostrando año y calidad normalizados: "Nombre (año) - [calidad]"
      let finalTitle = baseTitle;
      const suffixParts = [];
      if (year) suffixParts.push(`(${year})`);
      if (quality) suffixParts.push(`[${quality}]`);
      if (suffixParts.length) {
        finalTitle = `${baseTitle} ${suffixParts.join(' - ')}`;
      }

      // 3) Insertar en BD
      const result = await db.run(
        'INSERT INTO movies (page_number, title, year, quality, peliculasgd_url, vip_url, poster_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
        p,
        finalTitle,
        year || null,
        quality || null,
        data.url,
        data.vipLink || null,
        e.posterUrl || data.posterUrl || null,
      );
      const movieId = result.lastID;

      for (const link of vipLinks) {
        const fuente = getFuenteFromUrl(link);
        const preview = getPreviewFromUrl(link);
        await db.run(
          'INSERT OR IGNORE INTO vip_links (movie_id, url, fuente, preview) VALUES (?, ?, ?, ?)',
          movieId,
          link,
          fuente,
          preview,
        );
      }

      totalNuevas++;
      const badge = data.vipLink ? (vipLinks.length ? ` OK (${vipLinks.length} links)` : ' OK (0 links)') : ' (sin VIP)';
      console.log(badge);

      if (i < entries.length - 1) {
        const delayMs = vipLinks.length > 0 ? 400 + Math.round(Math.random() * 400) : DELAY_ENTRE_PELICULAS_MS;
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
