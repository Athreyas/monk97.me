/* resume-pdf.mjs — print /resume to sites/root/athreyas-yelishetti-resume.pdf.
 *
 * The PDF is the page itself under its print stylesheet ("/resume on paper"
 * in site.css), not a second copy of the content: edit resume.html, rerun
 * this, commit both. A visitor's own Cmd+P gives the same pages.
 *
 * The page is loaded as https://monk97.me/resume with every monk97.me
 * request answered from sites/root, so relative links inside the PDF point
 * at the live site rather than at localhost. Fonts come from Google Fonts,
 * so this needs network.
 *
 * Needs Playwright and its Chromium, which this repo deliberately does not
 * depend on. Install them anywhere and point at that directory:
 *
 *   npm i --prefix ~/.cache/monk97-pdf playwright
 *   npx --prefix ~/.cache/monk97-pdf playwright install chromium
 *   PLAYWRIGHT_DIR=~/.cache/monk97-pdf node scripts/resume-pdf.mjs
 *
 * Fails, and writes nothing, if the result is more than two pages. */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'sites', 'root');
const OUT = path.join(ROOT, 'athreyas-yelishetti-resume.pdf');
const MAX_PAGES = 2;

const from = process.env.PLAYWRIGHT_DIR ? path.resolve(process.env.PLAYWRIGHT_DIR) : process.cwd();
let chromium;
try {
  ({ chromium } = createRequire(path.join(from, 'noop.js'))('playwright'));
} catch {
  console.error(`playwright not found from ${from} — see the header of this script.`);
  process.exit(1);
}

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
                '.svg': 'image/svg+xml', '.txt': 'text/plain' };

// mirror Pages: /resume -> resume.html, /work/ -> work/index.html
function local(pathname) {
  let p = path.join(ROOT, decodeURIComponent(pathname));
  if (!p.startsWith(ROOT)) return null;
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  else if (!path.extname(p)) p += '.html';
  return fs.existsSync(p) ? p : null;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route('https://monk97.me/**', route => {
    const f = local(new URL(route.request().url()).pathname);
    if (!f) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, body: fs.readFileSync(f),
                    contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
  });
  await page.emulateMedia({ media: 'print', colorScheme: 'light' });
  await page.goto('https://monk97.me/resume', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;
  if (pages > MAX_PAGES) {
    console.error(`résumé prints to ${pages} pages (limit ${MAX_PAGES}) — nothing written. Tighten the print rules or the copy.`);
    process.exit(1);
  }
  fs.writeFileSync(OUT, pdf);
  console.log(`wrote ${path.relative(process.cwd(), OUT)} — ${pages} page${pages === 1 ? '' : 's'}, ${Math.round(pdf.length / 1024)} KB`);
} finally {
  await browser.close();
}
