/**
 * Escribe el catálogo en la carpeta catalogo/: un archivo Excel (.xlsx) por página
 * con columnas: Título, Año, Calidad, Enlace VIP, Links VIP, URL ficha.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';

const CATALOGO_DIR = 'catalogo';

const HEADERS = ['Título', 'Año', 'Calidad', 'Enlace VIP', 'Links VIP', 'URL ficha'];

/** Año: "(2025)" */
const YEAR_REGEX = /\((\d{4})\)/;
/** Calidad: "1080p" o "[1080p]", "720p" o "[720p]". Se ignora 4K. */
const QUALITY_REGEX = /\[?(1080p|720p)\]?/i;

/**
 * Extrae año y calidad desde el título.
 * @param {string} title
 * @returns {{ year: string | null, quality: string | null }}
 */
export function parseTitleInfo(title) {
  const yearMatch = title.match(YEAR_REGEX);
  const qualityMatch = title.match(QUALITY_REGEX);
  return {
    year: yearMatch ? yearMatch[1] : null,
    quality: qualityMatch ? qualityMatch[1].toLowerCase() : null,
  };
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
