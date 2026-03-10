/**
 * Utilidades compartidas para el bot VIP.
 * Constantes, helpers y funciones de espera.
 */

import { readFileSync, existsSync } from 'fs';

/** Dominios considerados enlaces de descarga (k5book.info, etc.). */
export const DOWNLOAD_DOMAINS = [
  'drive.google.com',
  'gdurl.com',
  'goo.gl',
  'link-to.net',
  'shink.in',
  'ouo.io',
];

/** User-Agent de Chrome real para simular navegador y reducir detección. */
export const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Viewport por defecto (resolución común). */
export const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

/**
 * Indica si una URL corresponde a un enlace de descarga según los dominios configurados.
 * @param {string} href - URL a comprobar
 * @param {string[]} [domains] - Lista de dominios (por defecto DOWNLOAD_DOMAINS)
 * @returns {boolean}
 */
export function isDownloadLink(href, domains = DOWNLOAD_DOMAINS) {
  if (!href || typeof href !== 'string' || !href.startsWith('http')) return false;
  const lower = href.toLowerCase();
  return domains.some((d) => lower.includes(d));
}

/**
 * Pausa la ejecución durante N milisegundos.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Obtiene la ruta del archivo de estado (cookies/storage) para reutilizar sesión.
 * Por defecto .vip-browser-state.json en el directorio de trabajo.
 * @param {string} [filename]
 * @returns {string}
 */
export function getStateFilePath(filename = '.vip-browser-state.json') {
  return filename;
}

/**
 * Lee un objeto/array desde variable de entorno (JSON) o desde archivo.
 * @param {string} envVar - Nombre de la variable (ej. VIP_HEADERS_JSON)
 * @param {string} fileEnvVar - Nombre de la variable con ruta al archivo (ej. VIP_HEADERS_FILE)
 * @returns {object | array | null} - Objeto o array parseado, o null si no hay config o es inválido
 */
export function getConfigJson(envVar, fileEnvVar) {
  const raw = process.env[envVar];
  if (raw && typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const filePath = process.env[fileEnvVar];
  if (filePath && existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Headers HTTP extra para el navegador VIP (Playwright).
 * Desde VIP_HEADERS_JSON (string JSON) o VIP_HEADERS_FILE (ruta a .json).
 * Ejemplo: {"Accept-Language":"es-ES,es;q=0.9","X-Custom":"value"}
 * @returns {Record<string, string>}
 */
export function getVipExtraHeaders() {
  const obj = getConfigJson('VIP_HEADERS_JSON', 'VIP_HEADERS_FILE');
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Cookies extra para el navegador VIP (Playwright).
 * Desde VIP_COOKIES_JSON o VIP_COOKIES_FILE. Array de { name, value, domain, path? }.
 * path por defecto "/". Ejemplo: [{"name":"cf_clearance","value":"xxx","domain":".k5book.info"}]
 * @returns {Array<{ name: string, value: string, domain: string, path?: string }>}
 */
export function getVipExtraCookies() {
  const arr = getConfigJson('VIP_COOKIES_JSON', 'VIP_COOKIES_FILE');
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((c) => c && typeof c.name === 'string' && typeof c.value === 'string' && typeof c.domain === 'string')
    .map((c) => ({ path: '/', ...c }));
}

/**
 * Headers HTTP extra para el scraper (axios).
 * Desde SCRAPGD_HEADERS_JSON o SCRAPGD_HEADERS_FILE. Se mezclan con los headers por defecto.
 * @returns {Record<string, string>}
 */
export function getScraperExtraHeaders() {
  const obj = getConfigJson('SCRAPGD_HEADERS_JSON', 'SCRAPGD_HEADERS_FILE');
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}
