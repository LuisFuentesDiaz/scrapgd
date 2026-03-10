# Scrapgd

Aplicación de scraping para [PeliculasGD.net](https://www.peliculasgd.net/) — películas y series 1080p Latino en Google Drive. Hecha con Node.js (axios + cheerio).

## Requisitos

- Node.js 18+

## Instalación

```bash
npm install
```

## Uso

```bash
npm start
```

Obtiene el listado de películas (sin series), entra en la ficha de cada una y extrae el **enlace VIP** ("Ver Enlaces Vip"). Por defecto procesa las primeras 3 películas; en `src/index.js` puedes cambiar `PELICULAS_A_PROCESAR` y `DELAY_ENTRE_PELICULAS_MS`.

Para fallos de certificado SSL en redes corporativas, crea un `.env` con:

```
SCRAPGD_INSECURE_SSL=1
```

## Uso programático

```js
import { scrapePeliculasGd, getMovieVipLink } from './src/scraper.js';

// Listado de películas (excluye series)
const { pageTitle, entries } = await scrapePeliculasGd();
// entries = [{ title, url }, ...]

// Entrar en la ficha de una película y obtener el enlace VIP
const { title, url, vipLink } = await getMovieVipLink(entries[0].url);

// Abrir la página VIP en navegador (pasa verificación de bot) y extraer enlaces
import { getLinksFromVipPage } from './src/vip-browser.js';
const { downloadLinks, resolved } = await getLinksFromVipPage(vipLink);
```

## Estructura

```
/src
  index.js        — Flujo principal: listado PeliculasGD → enlaces VIP
  scraper.js      — scrapePeliculasGd(), getMovieVipLink()
  vip-browser.js  — Bot VIP: getLinksFromVipPage(url), CLI
  extract-links.js — Extracción y filtrado de enlaces en la página
  utils.js        — Constantes (dominios descarga), helpers, user-agent
package.json
README.md
```

- **Bot VIP** (páginas protegidas por Cloudflare, p. ej. k5book.info): `vip-browser.js` usa `extract-links.js` y `utils.js`.

## Dependencias

- **axios** — Peticiones HTTP
- **cheerio** — Parseo de HTML
- **dotenv** — Carga de `.env`
- **playwright** — Navegador real
- **playwright-extra** + **puppeteer-extra-plugin-stealth** — Stealth mode para bypass de Cloudflare / DataDome / PerimeterX

---

## Bot VIP (enlaces desde páginas Cloudflare)

El bot extrae enlaces de descarga desde URLs tipo `https://k5book.info/?v=XXXXX`, que suelen estar protegidas por **Cloudflare**.

### Requisitos técnicos

- **Node.js** + **Playwright** (navegador real).
- **Stealth**: `playwright-extra` + `puppeteer-extra-plugin-stealth` (simula navegador real, reduce detección).
- **User-Agent** Chrome real, sin `navigator.webdriver`.
- Espera al challenge de Cloudflare y al contenido dinámico antes de extraer enlaces.
- **Cookies**: se guardan en `.vip-browser-state.json` y se reutilizan en la siguiente ejecución (incl. cookies de Cloudflare).
- Modo **headless** (por defecto) o **visible** (`HEADLESS=0`).

### Dominios de descarga filtrados

Se consideran enlaces de descarga los que contienen: `drive.google.com`, `gdurl.com`, `goo.gl`, `link-to.net`, `shink.in`, `ouo.io`.

### API

```js
import { getLinksFromVipPage } from './src/vip-browser.js';

const result = await getLinksFromVipPage('https://k5book.info/?v=XXXXX');
// result = { downloadLinks: string[], allLinks: string[], resolved: boolean }
```

### CLI

```bash
# Instalar Chromium (una vez)
npx playwright install chromium

# Ejecutar bot (una URL)
node src/vip-browser.js https://k5book.info/?v=XXXXX
```

Salida esperada:

```
Download links found:
https://drive.google.com/...
https://gdurl.com/...
```

### Opciones

| Variable / opción   | Descripción |
|--------------------|-------------|
| `HEADLESS=0`       | Navegador visible (Chromium de Playwright) para resolver captcha manualmente. |
| `CHROME_DEBUG_PORT` | **Abrir el captcha en tu Chrome real:** cierra Chrome, ábrelo con `chrome.exe --remote-debugging-port=9222`, luego ejecuta `CHROME_DEBUG_PORT=9222 node src/vip-browser.js <url>`. Se abrirá una pestaña en tu navegador; resuelves el captcha ahí y el script extrae los enlaces. |
| `VIP_WAIT_MS`      | Milisegundos de espera para que cargue la página (default: 20000 headless, 60000 visible). |
| `VIP_STATE_FILE`   | Ruta del archivo de estado/cookies (default: `.vip-browser-state.json`). |
| `VIP_USER` / `VIP_PASSWORD` | Login opcional si la página muestra formulario. |

Para **varias URLs** en un solo navegador: `getLinksFromVipPages([url1, url2], opts)`.
