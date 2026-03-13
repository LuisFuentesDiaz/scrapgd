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

