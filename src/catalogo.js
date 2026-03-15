/**
 * Escribe el catálogo en la carpeta catalogo/: un archivo Excel (.xlsx) por página
 * con columnas: Título, Año, Calidad, Enlace VIP, Links VIP, URL ficha.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';

const CATALOGO_DIR = 'catalogo';

const HEADERS = ['Título', 'Año', 'Calidad', 'Enlace VIP', 'Links VIP', 'URL ficha'];

/** Año entre paréntesis: "(2020)" — tiene prioridad para no confundir con títulos como "2067" */
const YEAR_IN_PARENS_REGEX = /\((\d{4})\)/;
/** Año suelto: "2020" o "1999" (solo si no hay año entre paréntesis válido) */
const YEAR_BARE_REGEX = /\b((?:19|20)\d{2})\b/;
/** Calidad: 1080p, 4K, 720p, 480p o 1080 (se normaliza a 1080p), con o sin paréntesis/corchetes. */
const QUALITY_REGEX = /[\[\(]?(1080p|4k|720p|480p|1080)[\]\)]?/i;

function parseYear(title, maxYear) {
  const inParens = title.match(YEAR_IN_PARENS_REGEX);
  if (inParens) {
    const y = inParens[1];
    if (maxYear == null || parseInt(y, 10) <= maxYear) return y;
  }
  const bare = title.match(YEAR_BARE_REGEX);
  if (bare) {
    const y = bare[1];
    if (maxYear == null || parseInt(y, 10) <= maxYear) return y;
  }
  return null;
}

/**
 * Extrae año y calidad desde el título.
 * El año entre paréntesis "(2020)" tiene prioridad sobre un número suelto (ej. "2067" como título).
 * Si opts.maxYear está definido, ningún año mayor se considera válido.
 * @param {string} title
 * @param {{ maxYear?: number }} [opts] - maxYear: año máximo válido (ej. año actual)
 * @returns {{ year: string | null, quality: string | null }}
 */
export function parseTitleInfo(title, opts = {}) {
  const maxYear = opts.maxYear != null ? opts.maxYear : null;
  const qualityMatch = title.match(QUALITY_REGEX);
  let quality = qualityMatch ? qualityMatch[1].toLowerCase() : null;
  if (quality === '1080') quality = '1080p';
  const year = parseYear(title, maxYear);
  return { year, quality };
}

/**
 * Escribe un archivo Excel por página con todas las películas de esa página.
 * @param {Array<{ pageNumber: number, movies: Array<{ title: string, url: string, vipLink: string | null, vipLinks?: string[] }> }>} pages - Una entrada por página
 * @param {string} [baseDir] - Carpeta base (por defecto catalogo)
 * @returns {number} - Cantidad de archivos escritos
 */
export function writeCatalogo(pages, baseDir = CATALOGO_DIR) {
  mkdirSync(baseDir, { recursive: true });
  let written = 0;

  for (const { pageNumber, movies } of pages) {
    const rows = [HEADERS];
    for (const m of movies) {
      const { year, quality } = parseTitleInfo(m.title);
      const vipLinksText = Array.isArray(m.vipLinks) && m.vipLinks.length ? m.vipLinks.join('\r\n') : '';
      rows.push([
        m.title,
        year || '',
        quality || '',
        m.vipLink || '(enlace VIP no encontrado)',
        vipLinksText,
        m.url || '',
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Convertir la columna "Enlace VIP" en hipervínculo cuando haya URL válida
    // HEADERS: ['Título', 'Año', 'Calidad', 'Enlace VIP', 'URL ficha'];
    // Índice 3 (0-based) → columna D en Excel.
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const valor = rows[rowIndex][3];
      if (!valor || valor === '(enlace VIP no encontrado)') continue;

      const cellAddress = `D${rowIndex + 1}`; // Excel usa índices 1-based
      const cell = ws[cellAddress] || { t: 's', v: valor };
      cell.l = {
        Target: valor,
        Tooltip: 'Abrir enlace VIP',
      };
      ws[cellAddress] = cell;
    }

    // Activar wrapText en la columna "Links VIP" (columna E) para que los saltos de línea se vean en Excel
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const cellAddress = `E${rowIndex + 1}`;
      const cell = ws[cellAddress];
      if (!cell) continue;
      const prevStyle = cell.s || {};
      const prevAlign = prevStyle.alignment || {};
      cell.s = {
        ...prevStyle,
        alignment: {
          ...prevAlign,
          wrapText: true,
        },
      };
      ws[cellAddress] = cell;
    }

    // Ajustar ancho de columnas al contenido (aproximado por longitud de texto)
    const colCount = HEADERS.length;
    const colWidths = new Array(colCount).fill(0);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      for (let colIndex = 0; colIndex < colCount; colIndex++) {
        const cellValue = row[colIndex];
        const text = cellValue == null ? '' : String(cellValue);
        if (text.length > colWidths[colIndex]) {
          colWidths[colIndex] = text.length;
        }
      }
    }
    ws['!cols'] = colWidths.map((wch) => ({ wch: wch + 2 }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Página ${pageNumber}`);
    const filename = `pagina-${pageNumber}.xlsx`;
    const filePath = join(baseDir, filename);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
    writeFileSync(filePath, buf);
    written++;
  }

  return written;
}
