import axios from 'axios';
import { extractVipSectionLinks } from './extract-links.js';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Hace una petición GET a la URL indicada con cabeceras User-Agent y Cookie y devuelve el body como texto.
 * Ahora mismo la URL y las cookies están pensadas para k5book.info.
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function fetchVipPage(url) {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    Cookie:
    'muser=17106; msession=71f6877bbae47590796d229ef3dcb456; cf_clearance=cYiH1PZXDU6mInNiw66HYmL5LZSnLXpT.aBKqtu1hY0-1773608970-1.2.1.1-95AthlDP6z_JGau6FyDTCGk.9Aj0SzGMuXJOdxA1bjQegR.059nydBuT6z5OHgQdv0hH9BO8Fgbz.BNHpJEj_nKEqCnGByaEdpZd8NEayKQybs6K2_.KjNzchRo02.D9ue1sHnO7biV1OpAX3MpbeSnrBJ5bki09nCyNRbeateRIPZ0rxRtbP70FaEEmBdMtav3748O.heRSIu91IWIalE0XONNYDZDMEMDby6yNLbs',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp',
    'Accept-Language': 'es-ES,es;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Sec-CH-UA': '"Chromium";v="122"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
  };

  const { data } = await axios.get(url, { headers, responseType: 'text', maxRedirects: 5 });
  return typeof data === 'string' ? data : String(data);
}

/**
 * Dado un enlace VIP (k5book.info/?v=...), descarga el HTML y devuelve
 * todos los enlaces dentro de la sección "Enlaces de Descargas",
 * filtrados solo a dominios de interés (Google Drive, 1fichier, Mega, MediaFire).
 * Para Google Drive incluye downloadUrl (uc?export=download).
 *
 * @param {string | null} vipUrl
 * @returns {Promise<{ url: string, downloadUrl?: string }[]>}
 */
export async function extractVipLinks(vipUrl) {
  if (!vipUrl) return [];
  try {
    const body = await fetchVipPage(vipUrl);
    const all = extractVipSectionLinks(body);
    const allowedDomains = ['drive.google.com', '1fichier.com', 'mega.nz', 'mediafire.com'];
    return all.filter((item) => {
      const lower = item.url.toLowerCase();
      return allowedDomains.some((d) => lower.includes(d));
    });
  } catch {
    return [];
  }
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Uso: node src/vip-browser.js <url_vip>');
    process.exit(1);
  }

  try {
    const links = await extractVipLinks(url);
    if (!links.length) {
      console.log('No se encontraron enlaces en la sección "Enlaces de Descargas".');
    } else {
      console.log('Enlaces encontrados:');
      links.forEach((l) => console.log(typeof l === 'string' ? l : l.url));
    }
  } catch (err) {
    console.error('Error al extraer enlaces VIP:', err?.message || err);
    process.exit(1);
  }
}

const isCLI = process.argv[1]?.endsWith('vip-browser.js');
if (isCLI) {
  main();
}
