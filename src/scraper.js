import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';
import { getScraperExtraHeaders } from './utils.js';
import { shouldIgnoreTitle } from './filters.js';

const BASE_URL = 'https://www.peliculasgd.net';
const insecure = process.env.SCRAPGD_INSECURE_SSL === '1';

/** Sufijo que el sitio añade al <title> de cada ficha. Se quita para dejar solo el nombre de la película. */
const TITLE_SUFFIX_REGEX = /\s*[-–|]\s*Peliculas\s+Google\s+Drive.*$/i;

function cleanPageTitle(rawTitle) {
  return rawTitle.replace(TITLE_SUFFIX_REGEX, '').trim();
}

function getAgent(url) {
  if (url.startsWith('https://')) {
    return new https.Agent({ rejectUnauthorized: !insecure });
  }
  return undefined;
}

const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  ...getScraperExtraHeaders(),
};

/**
 * Obtiene el HTML de una URL (uso genérico).
 * @param {string} url
 * @returns {Promise<{ title: string, links: string[] }>}
 */
export async function scrape(url) {
  const agent = getAgent(url);
  const { data: html } = await axios.get(url, {
    headers: defaultHeaders,
    timeout: 10000,
    httpsAgent: agent,
    httpAgent: agent,
  });

  const $ = cheerio.load(html);
  const title = $('title').text().trim();
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && href.startsWith('http')) links.push(href);
  });

  return { title, links };
}

/**
 * Scraper específico para peliculasgd.net.
 * Extrae el listado de entradas (películas/series). El filtrado de
 * títulos a ignorar (series, 4K, etc.) se hace en index.js mediante
 * IGNORE_TITLE_PATTERNS.
 *
 * @param {string} [url] - URL a scrapear (por defecto: página principal)
 * @returns {Promise<{ entries: Array<{ title: string, url: string, posterUrl: string | null }>, pageTitle: string }>}
 */
export async function scrapePeliculasGd(url = BASE_URL) {
  const targetUrl = url.startsWith('http') ? url : `${BASE_URL}/${url.replace(/^\//, '')}`;
  const agent = getAgent(targetUrl);

  const { data: html } = await axios.get(targetUrl, {
    headers: defaultHeaders,
    timeout: 15000,
    httpsAgent: agent,
    httpAgent: agent,
  });

  const $ = cheerio.load(html);
  const pageTitle = $('title').text().trim();
  const entries = [];

  $('div.pelicula').each((_, el) => {
    const $pel = $(el);
    const link = $pel.find('h2 a').attr('href') || $pel.find('.poster a').attr('href');
    const title = ($pel.find('h2 a').attr('title') || $pel.find('h2 a').text() || $pel.find('h3').text()).trim();
    if (!link || !title) return;
    if (shouldIgnoreTitle(title)) return;
    if (link.startsWith(BASE_URL) && link !== BASE_URL + '/' && !link.includes('/page/')) {
      const posterUrl =
        $pel.find('.poster img').attr('src') ||
        $pel.find('img').first().attr('src') ||
        null;
      entries.push({ title, url: link, posterUrl });
    }
  });

  // Deduplicar por URL; si hay repetidos, quedarnos con uno que tenga posterUrl
  const byUrl = new Map();
  for (const e of entries) {
    const existing = byUrl.get(e.url);
    if (!existing) {
      byUrl.set(e.url, e);
    } else if (!existing.posterUrl && e.posterUrl) {
      byUrl.set(e.url, { ...existing, posterUrl: e.posterUrl });
    }
  }

  return { pageTitle, entries: Array.from(byUrl.values()) };
}

const BITLY_EXCLUDE = 'bit.ly/2ZeFunO';
const VIP_DOMAIN = 'k5book.info';

function isExternalVipLink(href) {
  if (!href || href.includes(BITLY_EXCLUDE)) return false;
  try {
    const host = new URL(href).hostname.toLowerCase();
    if (host.includes('peliculasgd')) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Busca el enlace VIP en la página. Soporta dos formatos:
 * - Legend "SOLO MIEMBROS VIP" / "Enlaces de Descargas": h3 con img + <a href="k5book.info"> y "Enlaces VIP" en strong.
 * - h3 con "Ver Enlaces Vip" dentro del enlace.
 * @param {ReturnType<typeof cheerio.load>} $
 * @returns {string | null}
 */
function findVipLink($) {
  // 1) Enlace a k5book.info dentro de un fieldset cuya leyenda menciona VIP (ej. "SOLO MIEMBROS VIP", "Enlaces de Descargas")
  let fromFieldset = null;
  $('fieldset').each((_, fs) => {
    if (fromFieldset) return false;
    const $fs = $(fs);
    const legendText = $fs.find('legend').text().toLowerCase();
    if (!legendText.includes('vip') && !legendText.includes('miembros')) return;
    const firstK5 = $fs.find(`a[href*="${VIP_DOMAIN}"]`).first();
    const href = firstK5.attr('href');
    if (href) fromFieldset = href;
  });
  if (fromFieldset) return fromFieldset;

  // 2) h3 que contenga "ver enlaces vip" o "enlaces vip" (con o sin "Ver") → primer enlace externo
  const h3VipText = /ver\s+enlaces?\s+vip|enlaces?\s+vip/i;
  for (const el of $('h3').get()) {
    const $h3 = $(el);
    if (!h3VipText.test($h3.text().trim())) continue;
    const first = $h3.find('a[href]').toArray().find((a) => isExternalVipLink($(a).attr('href')));
    if (first) return $(first).attr('href') || null;
  }

  // 3) Cualquier enlace a k5book.info en la página (por si el contexto no tiene legend)
  const anyK5 = $(`a[href*="${VIP_DOMAIN}"]`).first().attr('href');
  if (anyK5) return anyK5;

  // 4) Fallback: enlace externo cuyo texto o contenedor mencione "vip"
  const vipText = /vip|ver\s+enlace[s]?\s+vip/i;
  let found = null;
  $('a[href]').each((_, el) => {
    if (found) return false;
    const $a = $(el);
    const href = $a.attr('href') || '';
    if (!isExternalVipLink(href)) return;
    const text = ($a.text() + ' ' + $a.parent().text()).trim();
    if (vipText.test(text)) found = href;
  });
  return found;
}

/**
 * Entra en la página de una película y extrae el enlace de "Ver Enlaces Vip".
 * @param {string} moviePageUrl - URL de la ficha de la película en peliculasgd.net
 * @returns {Promise<{ title: string, url: string, vipLink: string | null, posterUrl: string | null }>}
 */
export async function getMovieVipLink(moviePageUrl) {
  const targetUrl = moviePageUrl.startsWith('http') ? moviePageUrl : `${BASE_URL}/${moviePageUrl.replace(/^\//, '')}`;
  const agent = getAgent(targetUrl);

  const { data: html } = await axios.get(targetUrl, {
    headers: defaultHeaders,
    timeout: 15000,
    httpsAgent: agent,
    httpAgent: agent,
  });

  const $ = cheerio.load(html);
  const title = cleanPageTitle($('title').text().trim());
  const vipLink = findVipLink($);
  const posterUrl =
    $('img.aligncenter').first().attr('src') ||
    $('.poster img').first().attr('src') ||
    $('.marco-sinopsis img').first().attr('src') ||
    null;

  return { title, url: targetUrl, vipLink, posterUrl };
}
