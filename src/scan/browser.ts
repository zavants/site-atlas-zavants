import { chromium, type Browser, type Page } from 'playwright';

export type { Browser, Page as PwPage } from 'playwright';

export function openBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

const MAX_SCROLL_STEPS = 20;
const MAX_SCROLL_MS = 15_000;

/** Abre la URL lista para extraer: sin animaciones, con el contenido diferido cargado. */
export async function preparePage(browser: Browser, url: string): Promise<{ page: Page; status: number }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('close', () => void context.close().catch(() => undefined));
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 20_000 });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    await page.evaluate(
      async ({ steps, ms }) => {
        const until = Date.now() + ms;
        for (let i = 0; i < steps && Date.now() < until; i++) {
          const before = window.scrollY;
          window.scrollBy(0, window.innerHeight);
          await new Promise((r) => setTimeout(r, 100));
          if (window.scrollY === before) break;
        }
        window.scrollTo(0, 0);
      },
      { steps: MAX_SCROLL_STEPS, ms: MAX_SCROLL_MS },
    );
    await page.waitForTimeout(300);
    return { page, status: response?.status() ?? 0 };
  } catch (err) {
    await page.close();
    throw err;
  }
}
