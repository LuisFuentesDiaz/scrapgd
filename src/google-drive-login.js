/**
 * Abre un navegador, te lleva a Google para que inicies sesión,
 * y guarda la sesión (cookies/storage) en .google-drive-state.json
 * para que getGDriveFileSizeFromDownloadPage pueda obtener el peso de los archivos.
 *
 * Uso: node src/google-drive-login.js
 *   o: npm run gdrive-login
 *
 * Cuando veas "Inicia sesión en Google..." se abrirá una ventana.
 * Inicia sesión con tu cuenta de Google. Al terminar, vuelve a la consola y pulsa Enter.
 */

import { createInterface } from 'readline';
import { chromium } from 'playwright';
import { getGDriveStateFilePath } from './utils.js';

function askEnter(message) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  const statePath = getGDriveStateFilePath();
  console.log('Scrapgd — Login Google Drive\n');
  console.log('Se abrirá un navegador. Inicia sesión con tu cuenta de Google.');
  console.log('Cuando hayas terminado (y veas Drive o "Mi unidad"), vuelve aquí y pulsa Enter.\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();
  await page.goto('https://accounts.google.com/ServiceLogin?continue=https://drive.google.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  await askEnter('Cuando hayas iniciado sesión en Google Drive, pulsa Enter aquí para guardar la sesión... ');

  await context.storageState({ path: statePath });
  console.log(`\nSesión guardada en: ${statePath}`);
  console.log('A partir de ahora el scraper podrá obtener el peso de los archivos de Google Drive.\n');
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
