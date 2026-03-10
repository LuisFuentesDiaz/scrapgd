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

/**
 * Extrae todos los enlaces dentro de la sección "Enlaces de Descargas"
 * de una página VIP (HTML completo).
 *
 * Busca un texto que contenga "Enlaces de Descargas" y toma todos los
 * <a href> dentro del contenedor de pestañas asociado (tab_content).
 *
 * @param {string} html - Código HTML de la página VIP
 * @returns {string[]} - Lista de URLs encontradas en la sección de descargas
 */
export function extractVipSectionLinks(html) {
  const $ = cheerio.load(html || '');
  const links = [];

  // 1) Intentar localizar el bloque específico: tabs → "Enlaces de Descargas" → tab_container/tab_content
  const marker = $('*:contains("Enlaces de Descargas")').filter(function () {
    return $(this).text().includes('Enlaces de Descargas');
  }).first();

  let container = null;
  if (marker.length) {
    // Ejemplo de estructura:
    // <ul class="tabs"><li><div href="#tab1"><b>Enlaces de Descargas</b></div></li></ul>
    // <div class="tab_container"><div id="tab1" class="tab_content"> ... </div></div>
    const tabs = marker.closest('.tabs');
    if (tabs.length) {
      const tabContainer = tabs.nextAll('.tab_container').first();
      if (tabContainer.length) {
        container = tabContainer.find('.tab_content').first();
      }
    }
  }

  // 2) Fallback: si no se encontró con la estructura anterior, usar el primer .tab_content
  if (!container || !container.length) {
    container = $('.tab_content').first();
  }

  // 3) Extraer todos los enlaces http(s) dentro del contenedor elegido
  if (container && container.length) {
    container.find('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && href.startsWith('http')) {
        links.push(href);
      }
    });
  }

  return links;
}

