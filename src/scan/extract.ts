import type { ElementHandle, Page } from 'playwright';
import type { RawBlock } from './blocks.js';

export interface PageInfo {
  title: string;
  h1Count: number;
  ids: string[];
  duplicateIds: string[];
}

/*
 * Corre dentro de la página. Va como texto para que el transpilador no inyecte
 * ayudantes (como `__name`) que no existen en el navegador.
 */
const IN_PAGE = String.raw`(() => {
  const visible = (el) => {
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
  };
  const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const isHeading = (el) => /^H[1-6]$/.test(el.tagName);
  const contains = (a, b) => a !== b && a.contains(b);

  let blocks;
  const marked = [...document.querySelectorAll('[data-atlas-block]')].filter(visible);
  if (marked.length) {
    blocks = marked;
  } else {
    const landmarks = [...document.querySelectorAll('header, [role=banner], footer, [role=contentinfo]')]
      .filter((el) => !el.parentElement?.closest('section, article, aside'));
    const sections = [...document.querySelectorAll('section')].filter((el) => !el.parentElement?.closest('section'));
    let a = [...landmarks, ...sections].filter(visible);
    a = a.filter((el) => !a.some((other) => contains(other, el)));
    const root = document.querySelector('main') ?? document.body;
    const b = [...root.children].filter((el) => {
      if (!visible(el) || /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName)) return false;
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') return false;
      if (el.getBoundingClientRect().height < 80) return false;
      return !a.some((x) => x === el || contains(el, x) || contains(x, el));
    });
    blocks = [...a, ...b].sort((x, y) => (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  }

  const findKicker = (heading, block) => {
    for (const start of [heading, heading.parentElement !== block ? heading.parentElement : null]) {
      for (let s = start?.previousElementSibling; s; s = s.previousElementSibling) {
        if (isHeading(s)) break;
        const t = text(s);
        if (t.length >= 1 && t.length <= 40) return t;
      }
    }
    return null;
  };

  const linkKind = (a) => {
    const raw = a.getAttribute('href') ?? '';
    if (raw.startsWith('#')) return 'anchor';
    try {
      return new URL(a.href).origin === location.origin ? 'internal' : 'external';
    } catch {
      return 'external';
    }
  };

  const SKIP_TAG = /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/;
  const CARDISH = 'h1,h2,h3,h4,h5,h6,img,picture,svg,video';
  const HEADINGS = 'h1,h2,h3,h4,h5,h6';
  const NUMBERED = /^\d{1,2}[.)]?$/;
  const BIG_NUMBER = /^\D{0,2}\d[\d.,]*\s?(%|\+|k|M|x|[A-Za-zÀ-ÿ]{1,12}( [A-Za-zÀ-ÿ]{1,12})?)?$/;
  /* One match per price: an amount swallows its own period suffix, so "$49/mes" counts once. */
  const PRICE = /(?:(?:R\$|US\$|[$€£])\s?\d[\d.,]*|\d[\d.,]*\s?(?:USD|EUR|BRL)\b)(?:\s?\/\s?(?:mes|mês|month|mo)\b)?|\/\s?(?:mes|mês|month|mo)\b/gi;
  /* Phone-shaped text only: a leading "+" or a parenthesized area code. Digits with
     separators alone are not a phone: "1.234.567" and "2019 2020 2021" are numbers. */
  const PHONE = /\+\d[\d ().-]{6,}\d|\(\d{2,4}\)\s?\d[\d ().-]{3,}\d/g;
  const QUOTED = /[“"][^”"]{20,}[”"]/g;
  const MAX_NODES = 5000;

  /* Largest run of >= 2 consecutive children of one tag, each holding a heading or an image. */
  const cardsOf = (block) => {
    let best = [];
    const walk = (container, depth) => {
      const kids = [...container.children].filter((c) => !SKIP_TAG.test(c.tagName));
      let i = 0;
      while (i < kids.length) {
        if (!kids[i].querySelector(CARDISH)) {
          i++;
          continue;
        }
        let j = i + 1;
        while (j < kids.length && kids[j].tagName === kids[i].tagName && kids[j].querySelector(CARDISH)) j++;
        if (j - i >= 2 && j - i > best.length) best = kids.slice(i, j);
        i = j;
      }
      if (depth < 3) for (const k of kids) walk(k, depth + 1);
    };
    walk(block, 0);
    return best;
  };

  const signalsOf = (el, rect, area, full) => {
    const cards = cardsOf(el);
    let cardHeadingLevel = null;
    for (const c of cards) {
      for (const h of c.querySelectorAll(HEADINGS)) {
        const level = Number(h.tagName[1]);
        if (cardHeadingLevel === null || level < cardHeadingLevel) cardHeadingLevel = level;
      }
    }
    let numbered = 0;
    let bigNumbers = 0;
    const nodes = el.querySelectorAll('*');
    for (let i = 0; i < nodes.length && i < MAX_NODES; i++) {
      const node = nodes[i];
      if (node.childElementCount > 0) continue;
      const t = text(node);
      if (t.length === 0 || t.length > 24) continue;
      if (t.length <= 3 && NUMBERED.test(t)) numbered++;
      if (BIG_NUMBER.test(t) && parseFloat(getComputedStyle(node).fontSize) >= 32) bigNumbers++;
    }
    let smallImages = 0;
    let largeImages = 0;
    let imageRatio = 0;
    for (const m of el.querySelectorAll('img, svg, picture, video, canvas')) {
      const tag = m.tagName.toUpperCase();
      if (tag === 'PICTURE' && m.querySelector('img')) continue;
      const r = m.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (r.width <= 160 && tag !== 'VIDEO' && tag !== 'CANVAS') smallImages++;
      if (tag === 'SVG') continue;
      const w = Math.max(0, Math.min(r.right, rect.right) - Math.max(r.left, rect.left));
      const h = Math.max(0, Math.min(r.bottom, rect.bottom) - Math.max(r.top, rect.top));
      const share = (w * h) / area;
      if (share >= 0.2) largeImages++;
      imageRatio = Math.max(imageRatio, share);
    }
    let questions = 0;
    for (const h of el.querySelectorAll('h2, h3, h4, summary')) if (text(h).endsWith('?')) questions++;
    return {
      words: full ? full.split(' ').length : 0,
      cards: cards.length,
      cardHeadingLevel,
      listItems: el.querySelectorAll('li').length,
      orderedItems: el.querySelectorAll('ol li').length,
      numbered,
      accordions: el.querySelectorAll('details, [aria-expanded], [role=tab]').length,
      quotes: Math.max(el.querySelectorAll('blockquote, q').length, (full.match(QUOTED) || []).length),
      prices: (full.match(PRICE) || []).length,
      bigNumbers,
      questions,
      smallImages,
      largeImages,
      imageRatio: Math.round(imageRatio * 1000) / 1000,
      tabs: el.querySelectorAll('[role=tab]').length,
      contactHints:
        el.querySelectorAll('a[href^="tel:"], a[href^="mailto:"], address').length + (full.match(PHONE) || []).length,
    };
  };

  const raws = blocks.map((el, i) => {
    el.setAttribute('data-atlas-i', String(i));
    const rect = el.getBoundingClientRect();
    const area = Math.max(1, rect.width * rect.height);
    let visualRatio = 0;
    for (const m of el.querySelectorAll('canvas, video')) {
      const r = m.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, rect.right) - Math.max(r.left, rect.left));
      const h = Math.max(0, Math.min(r.bottom, rect.bottom) - Math.max(r.top, rect.top));
      visualRatio = Math.max(visualRatio, (w * h) / area);
    }
    const heading = el.querySelector('h1, h2');
    const parent = el.parentElement;
    const parentWraps = parent && parent !== document.body && parent.tagName !== 'MAIN' &&
      [...parent.children].filter((c) => !/^(SCRIPT|STYLE)$/.test(c.tagName)).length === 1;
    const forms = [...el.querySelectorAll('form')];
    const full = (el.innerText || text(el)).replace(/\s+/g, ' ').trim();
    return {
      tag: el.tagName.toLowerCase(),
      landmark: el.matches('header, [role=banner], footer, [role=contentinfo]') && !el.parentElement?.closest('section, article, aside'),
      atlasName: el.getAttribute('data-atlas-block') || null,
      ariaLabel: el.getAttribute('aria-label') || null,
      kicker: heading ? findKicker(heading, el) : null,
      heading: heading ? text(heading) || null : null,
      anchor: el.id || (parentWraps && parent.id) || null,
      height: Math.round(rect.height),
      text: full.slice(0, 2000),
      childTags: [...el.children].map((c) => c.tagName.toLowerCase()),
      hasForm: forms.length > 0,
      visualRatio: Math.round(visualRatio * 1000) / 1000,
      signals: signalsOf(el, rect, area, full),
      components: {
        headings: [...el.querySelectorAll('h1,h2,h3,h4,h5,h6')].slice(0, 20)
          .map((h) => ({ level: Number(h.tagName[1]), text: text(h) })),
        links: [...el.querySelectorAll('a[href]')].slice(0, 100).map((a) => ({
          text: text(a),
          href: linkKind(a) === 'anchor' ? a.getAttribute('href') : a.href,
          kind: linkKind(a),
          cta: a.matches('[role=button], .btn, .button, .cta, [class*="btn-"], [class*="btn_"], [class*="button-"], [class*="cta-"]'),
        })),
        // Interface controls (tabs, toggles, menus) are not calls to action.
        buttons: [...el.querySelectorAll('button, [role=button], input[type=submit]')]
          .filter((b) => !b.matches('[role=tab], [aria-controls], [aria-expanded], [aria-pressed], [role=tablist] *')).slice(0, 50)
          .map((b) => text(b) || b.getAttribute('value') || b.getAttribute('aria-label') || ''),
        forms: forms.map((f) => ({
          fields: f.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea').length,
          action: f.getAttribute('action') || null,
          method: (f.getAttribute('method') || 'get').toLowerCase(),
        })),
        media: [
          ...[...el.querySelectorAll('img')].map((m) => ({ type: 'img', src: m.currentSrc || m.src, alt: m.getAttribute('alt') ?? '' })),
          ...[...el.querySelectorAll('video')].map((m) => ({ type: 'video', src: m.currentSrc || m.src })),
          ...[...el.querySelectorAll('canvas')].map(() => ({ type: 'canvas' })),
        ].slice(0, 50),
      },
    };
  });

  const ids = [...document.querySelectorAll('[id]')].map((e) => e.id).filter(Boolean);
  const seen = new Set();
  const dup = new Set();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return {
    raws,
    pageInfo: {
      title: document.title,
      h1Count: document.querySelectorAll('h1').length,
      ids: [...seen],
      duplicateIds: [...dup],
    },
  };
})()`;

export async function extractBlocks(
  page: Page,
): Promise<{ raws: RawBlock[]; handles: (ElementHandle | null)[]; pageInfo: PageInfo }> {
  const result = (await page.evaluate(IN_PAGE)) as { raws: RawBlock[]; pageInfo: PageInfo };
  const handles = await Promise.all(result.raws.map((_, i) => page.$(`[data-atlas-i="${i}"]`)));
  return { ...result, handles };
}
