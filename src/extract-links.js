/**
 * Extracción de enlaces desde una página cargada en Playwright o desde HTML raw.
 * Obtiene todos los <a href> del DOM y filtra los de descarga.
 */

import * as cheerio from 'cheerio';
import { isDownloadLink, DOWNLOAD_DOMAINS } from './utils.js';

/**
 * Extrae todos los enlaces <a href> del documento actual (ejecutado en el contexto del navegador).
 * @returns {string[]}
 */
function collectHrefsInPage() {
  const hrefs = new Set();
  document.querySelectorAll('a[href]').forEach((a) => {
    try {
      const h = a.href;
      if (h && h.startsWith('http')) hrefs.add(h);
    } catch (_) {}
  });
  return [...hrefs];
}

/**
 * Obtiene todos los enlaces de la página y filtra los de descarga.
 * Debe llamarse cuando el DOM y el contenido dinámico ya estén cargados.
 *
 * @param {import('playwright').Page} page - Página de Playwright ya cargada
 * @param {{ domains?: string[] }} [opts] - Dominios para filtrar (por defecto DOWNLOAD_DOMAINS)
 * @returns {Promise<{ allLinks: string[], downloadLinks: string[], resolved: boolean }>}
 */
export async function extractLinksFromPage(page, opts = {}) {
  const domains = opts.domains ?? DOWNLOAD_DOMAINS;

  const allLinks = await page.evaluate(collectHrefsInPage);

  const downloadLinks = allLinks.filter((href) => isDownloadLink(href, domains));
  const resolved = downloadLinks.length > 0;

  return { allLinks, downloadLinks, resolved };
}

/**
 * Extrae enlaces de descarga desde HTML en formato string.
 *
 * @param {string} html - Código HTML de la página
 * @param {{ domains?: string[] }} [opts]
 * @returns {{ allLinks: string[], downloadLinks: string[], resolved: boolean }}
 */
export function extractLinksFromHtml(html, opts = {}) {
  const domains = opts.domains ?? DOWNLOAD_DOMAINS;
  const $ = cheerio.load(html || '');
  const allLinks = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && href.startsWith('http')) allLinks.push(href);
  });
  const downloadLinks = allLinks.filter((href) => isDownloadLink(href, domains));
  return { allLinks, downloadLinks, resolved: downloadLinks.length > 0 };
}

/** Dominios que identifican enlaces de descarga (para elegir el bloque correcto) */
const DOWNLOAD_DOMAIN_MARKERS = ['drive.google.com', '1fichier.com', 'mega.nz', 'mediafire.com'];

/**
 * Localiza el .tab_content que contiene los enlaces de descarga.
 * No depende del texto de la pestaña ni de nextAll: elige el bloque que más enlaces
 * de descarga (drive, mega, 1fichier, mediafire) contenga.
 * @param {ReturnType<typeof cheerio.load>} $
 * @returns {cheerio.Cheerio}
 */
function findDownloadTabContent($) {
  const $all = $('.tab_content');
  if (!$all.length) return $();

  let best = $all.first();
  let bestCount = 0;

  $all.each((_, el) => {
    const $box = $(el);
    let count = 0;
    $box.find('a[href^="http"]').each((__, a) => {
      const href = $(a).attr('href') || '';
      const lower = href.toLowerCase();
      if (DOWNLOAD_DOMAIN_MARKERS.some((d) => lower.includes(d))) count++;
    });
    if (count > bestCount) {
      bestCount = count;
      best = $box;
    }
  });

  return best;
}

/**
 * Extrae todos los enlaces dentro de la sección de descargas de una página VIP (HTML completo).
 * Soporta pestañas "Enlaces de Descargas", "vip", "descargas", etc.
 *
 * @param {string} html - Código HTML de la página VIP
 * @returns {string[]} - Lista de URLs encontradas en la sección de descargas
 */
export function extractVipSectionLinks(html) {
  const $ = cheerio.load(html || '');
  const links = [];
  const container = findDownloadTabContent($);

  // Extraer enlaces: primero desde el contenedor de pestañas
  const seen = new Set();
  function addLink(href) {
    if (!href || !href.startsWith('http')) return;
    const norm = href.replace(/&amp;/g, '&').trim();
    if (norm.length < 500 && !seen.has(norm)) {
      seen.add(norm);
      links.push(norm);
    }
  }

  if (container && container.length) {
    container.find('a[href]').each((_, el) => addLink($(el).attr('href')));
    const containerHtml = container.html() || '';
    const urlRegex = /https?:\/\/[^\s<>"')\]\]]+/g;
    let m;
    while ((m = urlRegex.exec(containerHtml)) !== null) {
      addLink(m[0].replace(/[.,;:!?)]+$/, '').trim());
    }
  }

  // Fallback: si no se encontró nada, buscar en toda la página (estructura distinta o sin .tab_content)
  if (links.length === 0) {
    $('a[href]').each((_, el) => addLink($(el).attr('href')));
    const fullHtml = $('body').html() || $.html() || '';
    const urlRegex = /https?:\/\/[^\s<>"')\]\]]+/g;
    let m;
    while ((m = urlRegex.exec(fullHtml)) !== null) {
      addLink(m[0].replace(/[.,;:!?)]+$/, '').trim());
    }
  }

  return links;
}

