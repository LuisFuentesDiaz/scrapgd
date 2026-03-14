/** Textos que, si aparecen en el título, hacen que se ignore la película. */
export const IGNORE_TITLE_PATTERNS = [
  'temporada',
  '4k',
  'remux',
  'collection',
  'coleccion',
  'colección'
  // Agrega aquí más patrones si lo necesitas, por ejemplo:
  // 'camrip',
  // 'subtitulado',
];

/**
 * Devuelve true si el título debe ser ignorado según IGNORE_TITLE_PATTERNS.
 * @param {string} title
 * @returns {boolean}
 */
export function shouldIgnoreTitle(title) {
  const lowerTitle = (title || '').toLowerCase();
  return IGNORE_TITLE_PATTERNS.some((pat) => lowerTitle.includes(pat.toLowerCase()));
}

/** Textos/etiquetas de ruido que queremos limpiar del título final. */
export const TITLE_NOISE_PATTERNS = [
  'hd',
  'web-dl',
  'web dl',
  'webrip',
  'brrip',
  'bdrip',
  'amzn',
  'latino',
  'dual',
  'castellano',
  'subtitulado',
  'sub español',
  'sub esp',
  'googledrive',
  'google drive',
  'rijohd',
  'sxgo',
];

/**
 * Limpia el título de una película eliminando año, calidad y textos de ruido.
 *
 * - Si se conoce el año/calidad, corta a partir de la primera aparición
 *   de cualquiera de ellos (incluido), dejando solo el nombre "puro".
 * - Luego elimina palabras de ruido definidas en TITLE_NOISE_PATTERNS
 *   y limpia espacios y separadores sobrantes.
 *
 * @param {string} rawTitle - Título original
 * @param {{ year?: string | null, quality?: string | null }} info
 * @returns {string}
 */
export function cleanMovieTitle(rawTitle, info = {}) {
  let title = (rawTitle || '').trim();
  if (!title) return title;

  const { year, quality } = info;
  const cutIndexes = [];

  if (year) {
    const yearStr = String(year);
    const paren = title.indexOf(`(${yearStr})`);
    if (paren >= 0) cutIndexes.push(paren);
    const plain = title.indexOf(yearStr);
    if (plain >= 0) cutIndexes.push(plain);
  }

  if (quality) {
    const q = String(quality);
    const qualityRegex = new RegExp(`\\[?${q}\\]?`, 'i');
    const m = title.match(qualityRegex);
    if (m && typeof m.index === 'number') {
      cutIndexes.push(m.index);
    }
  }

  if (cutIndexes.length) {
    const cutAt = Math.min(...cutIndexes);
    if (cutAt > 0) {
      title = title.slice(0, cutAt).trim();
    }
  }

  // Eliminar textos de ruido (palabras sueltas tipo "latino", "HD", etc.)
  let lower = title.toLowerCase();
  TITLE_NOISE_PATTERNS.forEach((pat) => {
    const re = new RegExp(`\\b${pat.replace(/\s+/g, '\\s+')}\\b`, 'ig');
    title = title.replace(re, ' ');
  });

  // Limpiar separadores y espacios sobrantes
  title = title
    .replace(/[\[\]\(\)\-–—]+$/g, '') // separadores al final
    .replace(/\s+/g, ' ') // espacios múltiples
    .trim();

  return title;
}

