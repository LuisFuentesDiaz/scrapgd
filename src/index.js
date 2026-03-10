import 'dotenv/config';
import { scrapePeliculasGd, getMovieVipLink } from './scraper.js';
import { extractVipLinks } from './vip-browser.js';
import { writeCatalogo } from './catalogo.js';

const PELICULAS_GD_URL = 'https://www.peliculasgd.net/';
const PAGINAS_A_PROCESAR = 1; // Página 1 (portada) y página 2
const DELAY_ENTRE_PELICULAS_MS = 800;
/** Si es true, abre el primer enlace VIP en navegador (Playwright) para extraer enlaces tras la verificación de bot. */
const ABRIR_VIP_EN_NAVEGADOR = process.env.GET_VIP_PAGE_LINKS === '1';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('Scrapgd — PeliculasGD.net\n');

  const pages = [];

  for (let p = 1; p <= PAGINAS_A_PROCESAR; p++) {
    const url = p === 1 ? PELICULAS_GD_URL : `${PELICULAS_GD_URL}page/${p}/`;
    const { pageTitle, entries } = await scrapePeliculasGd(url);
    console.log(`Página ${p}: ${pageTitle} — ${entries.length} películas`);

    const movies = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      process.stdout.write(`  [${i + 1}/${entries.length}] ${e.title.slice(0, 50)}...`);
      const data = await getMovieVipLink(e.url);
      let vipLinks = [];
      if (data.vipLink) {
        vipLinks = await extractVipLinks(data.vipLink);
      }
      movies.push({ title: data.title, url: data.url, vipLink: data.vipLink, vipLinks });
      const badge = data.vipLink ? (vipLinks.length ? ` OK (${vipLinks.length} links)` : ' OK (0 links)') : ' (sin VIP)';
      console.log(badge);
      if (i < entries.length - 1) await delay(DELAY_ENTRE_PELICULAS_MS);
    }
    pages.push({ pageNumber: p, movies });
    console.log('');
  }

  const written = writeCatalogo(pages);
  console.log(`Catálogo: ${written} archivos Excel escritos en carpeta catalogo/ (pagina-1.xlsx, pagina-2.xlsx, ...)`);

  if (ABRIR_VIP_EN_NAVEGADOR && pages.length > 0) {
    const primeraConLinks = pages
      .flatMap((pg) => pg.movies)
      .find((m) => Array.isArray(m.vipLinks) && m.vipLinks.length > 0);
    if (primeraConLinks) {
      console.log('\n--- Enlaces VIP de la primera película con links ---');
      primeraConLinks.vipLinks.forEach((l) => console.log('  ', l));
    }
  }
}

main().catch(console.error);
