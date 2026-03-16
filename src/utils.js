/**
 * Utilidades compartidas para el bot VIP.
 * Constantes, helpers y funciones de espera.
 */

import { readFileSync, existsSync } from 'fs';
import axios from 'axios';
import * as cheerio from 'cheerio';

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

/** Mapa dominio → nombre de fuente para vip_links.source */
const VIP_FUENTE_MAP = [
  [ 'drive.google.com', 'Google Drive' ],
  [ 'mega.nz', 'Mega' ],
  [ 'mediafire.com', 'Mediafire' ],
  [ '1fichier.com', '1fichier' ],
];

/**
 * Obtiene la fuente (Google Drive, Mega, etc.) a partir de la URL de un enlace VIP.
 * @param {string} url
 * @returns {string | null}
 */
export function getFuenteFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const lower = url.toLowerCase();
  for (const [domain, name] of VIP_FUENTE_MAP) {
    if (lower.includes(domain)) return name;
  }
  return null;
}

/**
 * Para enlaces de Google Drive: devuelve la URL de previsualización (reemplaza /view?... por /preview).
 * La URL original no se modifica; este valor es solo para guardar en vip_links.preview.
 * @param {string} url
 * @returns {string | null}
 */
export function getPreviewFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  if (!url.toLowerCase().includes('drive.google.com')) return null;
  return url.replace(/\/view(\?.*)?$/i, '/preview');
}

/**
 * Extrae el ID del archivo de una URL de Google Drive (view o open).
 * Ej: https://drive.google.com/file/d/1eI5US4sfBGMtSYfSGcNyGIwM_kj50ca_/view → 1eI5US4sfBGMtSYfSGcNyGIwM_kj50ca_
 * @param {string} url
 * @returns {string | null}
 */
export function getGDriveFileId(url) {
  if (!url || typeof url !== 'string') return null;
  if (!url.toLowerCase().includes('drive.google.com')) return null;
  const match = url.match(/\/file\/d\/([^/?#]+)/i) || url.match(/[?&]id=([^&]+)/i);
  return match ? match[1] : null;
}

/**
 * Convierte una URL de vista de Google Drive a URL de descarga directa.
 * Entrada: https://drive.google.com/file/d/ID/view
 * Salida:  https://drive.google.com/uc?export=download&id=ID
 * @param {string} url
 * @returns {string | null}
 */
export function getGDriveDownloadUrl(url) {
  const id = getGDriveFileId(url);
  return id ? `https://drive.google.com/uc?export=download&id=${id}` : null;
}

/** Palabras en la URL de Google Drive que excluyen el enlace en el proceso normal (ej. carpetas). */
const GDRIVE_EXCLUDED_URL_KEYWORDS = ['folder'];

/**
 * Indica si un enlace de Google Drive debe excluirse en el proceso normal (p. ej. URLs de carpeta).
 * @param {string} url - URL del enlace
 * @returns {boolean} - true si es GDrive y la URL contiene alguna palabra excluida
 */
export function isGDriveLinkExcluded(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  if (!lower.includes('drive.google.com')) return false;
  return GDRIVE_EXCLUDED_URL_KEYWORDS.some((keyword) => lower.includes(keyword.toLowerCase()));
}

/** Regex para el peso en .uc-name-size: (2,2G) o (2.2 G). Requiere decimal (coma o punto) para evitar capturar otros números de la página. */
const GDRIVE_SIZE_WITH_DECIMAL = /\((\d+[,.]\d+)\s*([KMG])\)/i;
/** Por si el tamaño es entero: (700M) o (1G) */
const GDRIVE_SIZE_INTEGER = /\((\d+)\s*([KMG])\)/i;

/**
 * Parsea el HTML de la página de descarga de Drive y extrae el peso (2,2G, etc.).
 * @param {string} html
 * @returns {string | null}
 */
function parseGDriveSizeFromHtml(html) {
  const $ = cheerio.load(html || '');
  const sizeText = $('span.uc-name-size').first().text() || $('.uc-name-size').first().text() || '';
  if (!sizeText.trim()) return null;
  const matchWithDecimal = sizeText.match(GDRIVE_SIZE_WITH_DECIMAL);
  const matchInteger = sizeText.match(GDRIVE_SIZE_INTEGER);
  const match = matchWithDecimal || matchInteger;
  return match ? `${match[1]}${match[2].toUpperCase()}` : null;
}

/**
 * Hace una petición a la página de descarga de Google Drive y extrae el peso del archivo.
 * Si existe sesión guardada (.google-drive-state.json), usa Playwright para cargar la página logueado.
 * Si no, usa axios (suele devolver la página de login y no se obtiene el peso).
 *
 * @param {string} downloadUrl - URL tipo https://drive.google.com/uc?export=download&id=ID
 * @returns {Promise<string | null>} - Ej. "2,2G" o "2.2G", o null si no se encuentra
 */
export async function getGDriveFileSizeFromDownloadPage(downloadUrl) {
  if (!downloadUrl || !downloadUrl.includes('drive.google.com')) return null;
  const statePath = getGDriveStateFilePath();
  if (existsSync(statePath)) {
    try {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        storageState: statePath,
        userAgent: CHROME_USER_AGENT,
        viewport: DEFAULT_VIEWPORT,
      });
      const page = await context.newPage();
      await page.goto(downloadUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const html = await page.content();
      await browser.close();
      return parseGDriveSizeFromHtml(html);
    } catch {
      return null;
    }
  }
  try {
    const { data } = await axios.get(downloadUrl, {
      headers: {
        'User-Agent': CHROME_USER_AGENT,
        'Accept-Language': 'es-ES,es;q=0.9',
      },
      responseType: 'text',
      timeout: 15000,
      maxRedirects: 5,
    });
    const html = typeof data === 'string' ? data : String(data);
    return parseGDriveSizeFromHtml(html);
  } catch {
    return null;
  }
}

/**
 * Obtiene el peso del archivo desde la página de descarga de Drive usando una página
 * de Playwright ya creada (para reutilizar un mismo navegador en varios requests).
 * Usado por normalize-movies para abrir un solo navegador y N páginas.
 *
 * @param {import('playwright').Page} page - Página de Playwright (mismo context/browser)
 * @param {string} downloadUrl - URL tipo https://drive.google.com/uc?export=download&id=ID
 * @returns {Promise<string | null>} - Ej. "2,2G" o null
 */
export async function getGDriveFileSizeWithPage(page, downloadUrl) {
  if (!downloadUrl || !downloadUrl.includes('drive.google.com')) return null;
  try {
    await page.goto(downloadUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const html = await page.content();
    return parseGDriveSizeFromHtml(html);
  } catch {
    return null;
  }
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
 * Ruta del archivo de estado de sesión de Google (para obtener peso en Drive).
 * Variable de entorno: GDRIVE_STATE_FILE. Por defecto: .google-drive-state.json
 * @returns {string}
 */
export function getGDriveStateFilePath() {
  return process.env.GDRIVE_STATE_FILE || '.google-drive-state.json';
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
