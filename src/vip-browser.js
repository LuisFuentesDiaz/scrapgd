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
    'muser=17106; msession=71f6877bbae47590796d229ef3dcb456; cf_clearance=PW1kJM.HldeMGl.crNoqQuwE5sYCpbqQU8IktarzKlM-1773115943-1.2.1.1-IDBo992saWjTwKcYK4WYlu1KzWb5bhERZB..L38xsmN80c7zcxrZFsaeyIrR4Fct2IkpY7eGrsIwytEh1Pk8v7qfYvlE_BrHkrXeuo1X81HdzQ5JpR52WGLBXTtRnwxG.KWnZiKwK41GoaHZ6az8OroC_N4ChkYcQRTA9l8Vuii1mtQ_cMHvkto0N09EjyFX4YDYPdLJQh5AoOtqkBUZrPredoWvxtu7xd3D9Y30TLI',
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
 *
 * @param {string | null} vipUrl
 * @returns {Promise<string[]>}
 */
export async function extractVipLinks(vipUrl) {
  if (!vipUrl) return [];
  try {
    const body = await fetchVipPage(vipUrl);
    const all = extractVipSectionLinks(body);
    const allowedDomains = ['drive.google.com', '1fichier.com', 'mega.nz', 'mediafire.com'];
    return all.filter((href) => {
      const lower = href.toLowerCase();
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
      links.forEach((l) => console.log(l));
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
