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
  /* An element with no box of its own area is not rendered: display:none, inside a display:none
     subtree, or collapsed to nothing. Cheaper than getComputedStyle per node, and it is what the
     signals need, because a responsive page that ships a hidden copy of a block would double
     every count. A visibility:hidden copy still measures as rendered: seeing it would cost a
     style read per node, which the signals cannot afford. */
  const rendered = (el) => {
    const rects = el.getClientRects();
    for (let i = 0; i < rects.length; i++) if (rects[i].width > 0 && rects[i].height > 0) return true;
    return false;
  };
  const countRendered = (el, selector) => {
    let n = 0;
    for (const m of el.querySelectorAll(selector)) if (rendered(m)) n++;
    return n;
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
     separators alone are not a phone: "1.234.567" and "2019 2020 2021" are numbers.
     A dot or a comma groups thousands, so it is not a phone separator either: that keeps
     the marketing figure "+1.000.000" out while "+598 99 123 456" stays in. */
  const PHONE = /\+\d[\d ()-]{6,}\d|\(\d{2,4}\)\s?\d[\d ()-]{3,}\d/g;
  const QUOTED = /[“"][^”"]{20,}[”"]/g;
  const MAX_NODES = 5000;
  /* The block, its children and their children carry the backdrops worth reading. */
  const MAX_BACKDROPS = 40;
  const BG_PX = /^-?[\d.]+px$/;
  const BG_PERCENT = /^-?[\d.]+%$/;

  /* The share of an element's own box that one painting of its background image covers.
     "cover" and "contain" are sized to the box, and an explicit size is measured against it.
     "auto" cannot be measured without the intrinsic size of the image, and a background that
     repeats is a texture rather than one image, so neither of those counts as an image. */
  const backgroundFill = (cs, w, h) => {
    if (cs.backgroundImage.indexOf('url(') === -1) return 0;
    const size = cs.backgroundSize.split(',')[0].trim();
    if (size === 'cover' || size === 'contain') return 1;
    if (cs.backgroundRepeat.split(',')[0].trim() !== 'no-repeat') return 0;
    const parts = size.split(' ');
    const axis = (v, full) => (BG_PX.test(v) ? parseFloat(v) : BG_PERCENT.test(v) ? (parseFloat(v) * full) / 100 : -1);
    const bw = axis(parts[0] || '', w);
    const bh = parts.length > 1 ? axis(parts[1], h) : -1;
    if (bw < 0 || bh < 0) return 0;
    return Math.min(1, (Math.min(bw, w) * Math.min(bh, h)) / Math.max(1, w * h));
  };

  /* Largest run of >= 2 consecutive rendered children of one tag, each holding a heading or an image. */
  const cardsOf = (block) => {
    let best = [];
    const walk = (container, depth) => {
      const kids = [...container.children].filter((c) => !SKIP_TAG.test(c.tagName));
      /* Only a rendered child can be a card, but every child is walked into: an element with
         display:contents has no box of its own and still lays out its children on the page. */
      const shown = kids.filter(rendered);
      let i = 0;
      while (i < shown.length) {
        if (!shown[i].querySelector(CARDISH)) {
          i++;
          continue;
        }
        let j = i + 1;
        while (j < shown.length && shown[j].tagName === shown[i].tagName && shown[j].querySelector(CARDISH)) j++;
        if (j - i >= 2 && j - i > best.length) best = shown.slice(i, j);
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
        if (!rendered(h)) continue;
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
      const isNumbered = t.length <= 3 && NUMBERED.test(t);
      const isBig = BIG_NUMBER.test(t);
      /* The rect check comes last: only a handful of nodes per block get this far. */
      if ((!isNumbered && !isBig) || !rendered(node)) continue;
      if (isNumbered) numbered++;
      if (isBig && parseFloat(getComputedStyle(node).fontSize) >= 32) bigNumbers++;
    }
    let smallImages = 0;
    let largeImages = 0;
    let imageRatio = 0;
    for (const m of el.querySelectorAll('img, svg, picture, video, canvas')) {
      const tag = m.tagName.toUpperCase();
      if (tag === 'PICTURE' && m.querySelector('img')) continue;
      const r = m.getBoundingClientRect();
      /* An empty box is also how a media element inside a display:none subtree measures. */
      if (r.width <= 0 || r.height <= 0) continue;
      if (r.width <= 160 && tag !== 'VIDEO' && tag !== 'CANVAS') smallImages++;
      if (tag === 'SVG') continue;
      const w = Math.max(0, Math.min(r.right, rect.right) - Math.max(r.left, rect.left));
      const h = Math.max(0, Math.min(r.bottom, rect.bottom) - Math.max(r.top, rect.top));
      const share = (w * h) / area;
      if (share >= 0.2) largeImages++;
      imageRatio = Math.max(imageRatio, share);
    }
    /* A band often carries its image as a CSS background instead of an element. The block, its
       children and their children are read, up to a cap, so this stays a handful of
       getComputedStyle calls per block and never one per node. A backdrop says how visual the
       band is, which is imageRatio; it is not one of the images the block shows, so it never
       adds to largeImages, and how much of the box it covers is measured, not assumed. */
    const backdrops = [el, ...el.children];
    for (const c of el.children) {
      for (const g of c.children) {
        if (backdrops.length >= MAX_BACKDROPS) break;
        backdrops.push(g);
      }
    }
    for (let i = 0; i < backdrops.length && i < MAX_BACKDROPS; i++) {
      const b = backdrops[i];
      const r = b.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const fill = backgroundFill(getComputedStyle(b), r.width, r.height);
      if (fill <= 0) continue;
      const w = Math.max(0, Math.min(r.right, rect.right) - Math.max(r.left, rect.left));
      const h = Math.max(0, Math.min(r.bottom, rect.bottom) - Math.max(r.top, rect.top));
      imageRatio = Math.max(imageRatio, (fill * w * h) / area);
    }
    let questions = 0;
    for (const h of el.querySelectorAll('h2, h3, h4, summary')) if (text(h).endsWith('?') && rendered(h)) questions++;
    return {
      words: full ? full.split(' ').length : 0,
      cards: cards.length,
      cardHeadingLevel,
      listItems: countRendered(el, 'li'),
      orderedItems: countRendered(el, 'ol li'),
      numbered,
      accordions: countRendered(el, 'details, [aria-expanded], [role=tab]'),
      quotes: Math.max(countRendered(el, 'blockquote, q'), (full.match(QUOTED) || []).length),
      prices: (full.match(PRICE) || []).length,
      bigNumbers,
      questions,
      smallImages,
      largeImages,
      imageRatio: Math.round(imageRatio * 1000) / 1000,
      tabs: countRendered(el, '[role=tab]'),
      contactHints:
        countRendered(el, 'a[href^="tel:"], a[href^="mailto:"], address') + (full.match(PHONE) || []).length,
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
