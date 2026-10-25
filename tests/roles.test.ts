import { describe, expect, it } from 'vitest';
import { classify, matchesKeyword, type RoleInput } from '../src/scan/roles.js';
import type { Components, Signals } from '../src/schema/scan.js';

const ZERO: Signals = {
  words: 0,
  cards: 0,
  cardHeadingLevel: null,
  listItems: 0,
  orderedItems: 0,
  numbered: 0,
  accordions: 0,
  quotes: 0,
  prices: 0,
  bigNumbers: 0,
  questions: 0,
  smallImages: 0,
  largeImages: 0,
  imageRatio: 0,
  tabs: 0,
  contactHints: 0,
};

const noComponents = (): Components => ({ headings: [], links: [], buttons: [], forms: [], media: [] });

const withForm = (fields: number): Components => ({
  ...noComponents(),
  forms: [{ fields, action: null, method: 'post' }],
});

type Over = Omit<Partial<RoleInput>, 'signals'> & { signals?: Partial<Signals> };

function input(over: Over = {}): RoleInput {
  const { signals, ...rest } = over;
  return {
    tag: 'section',
    landmark: false,
    isFirstSection: false,
    pageHasH1Here: false,
    heading: null,
    kicker: null,
    anchor: null,
    components: noComponents(),
    ...rest,
    signals: 'signals' in over && signals === undefined ? undefined : { ...ZERO, ...signals },
  };
}

describe('classify', () => {
  it('follows the precedence: a hero with cards is a hero, a form with contact hints is contact', () => {
    expect(classify(input({ pageHasH1Here: true, signals: { cards: 3 } })).role).toBe('hero');
    expect(classify(input({ components: withForm(2), signals: { contactHints: 1 } })).role).toBe('contact');
    expect(classify(input({ components: withForm(2) }))).toMatchObject({ role: 'form', secondary: [] });
  });

  it('needs process words for cards to be steps; audience words make them audience', () => {
    expect(classify(input({ kicker: 'Cómo trabajamos', signals: { cards: 4, numbered: 4, cardHeadingLevel: 3 } })).role).toBe('steps');
    // Spec 5.3: three cards and process words are steps, whether or not the cards show a number.
    expect(classify(input({ kicker: 'Cómo trabajamos', signals: { cards: 4, cardHeadingLevel: 3 } })).role).toBe('steps');
    expect(classify(input({ kicker: 'Para quién', signals: { cards: 3, numbered: 3, cardHeadingLevel: 3 } })).role).toBe('audience');
    expect(classify(input({ heading: 'Our platform', signals: { cards: 3, numbered: 3, cardHeadingLevel: 3 } })).role).toBe('features');
    // Without process words, numbered cards alone are still a feature grid.
    expect(classify(input({ heading: 'Our platform', signals: { cards: 3, cardHeadingLevel: 3 } })).role).toBe('features');
  });

  it('names in the reasons the arm of the rule that fired', () => {
    expect(classify(input({ kicker: 'Cómo trabajamos', signals: { cards: 4, cardHeadingLevel: 3 } })).reasons).toEqual([
      'kw:steps',
      'cards>=3',
    ]);
    expect(classify(input({ heading: 'How it works', signals: { orderedItems: 4, cards: 2 } })).reasons).toEqual([
      'kw:steps',
      'orderedItems>=3',
    ]);
    expect(classify(input({ kicker: 'Para quién', signals: { numbered: 2 } })).reasons).toEqual([
      'kw:audience',
      'numbered>=2',
    ]);
  });

  it('matches keywords only in kicker, heading and anchor, accent-insensitively', () => {
    expect(matchesKeyword('about', ['NOSOTROS'])).toBe(true);
    expect(matchesKeyword('about', ['Sobre nos'])).toBe(true);
    expect(matchesKeyword('steps', ['Processing payments'])).toBe(false); // whole word
    // 'about' asks for no cards, so a grid under "About us" stays a feature grid,
    expect(classify(input({ heading: 'About us', signals: { cards: 3, cardHeadingLevel: 3 } })).role).toBe('features');
    // while 'process' is a steps keyword and three cards are enough for steps (spec 5.3).
    expect(classify(input({ heading: 'About our process', signals: { cards: 3, cardHeadingLevel: 3 } })).role).toBe('steps');
  });

  it('recognizes logos, stats, testimonials, pricing, faq, team, gallery, banner, feature, content, default', () => {
    expect(classify(input({ signals: { smallImages: 8, words: 20 } })).role).toBe('logos');
    expect(classify(input({ signals: { bigNumbers: 3, words: 30 } })).role).toBe('stats');
    expect(classify(input({ signals: { quotes: 2, cards: 2 } })).role).toBe('testimonials');
    expect(classify(input({ signals: { prices: 3, cards: 3, cardHeadingLevel: 3 } })).role).toBe('pricing');
    expect(classify(input({ signals: { questions: 4, accordions: 4 } })).role).toBe('faq');
    expect(classify(input({ heading: 'Our team', signals: { cards: 4, cardHeadingLevel: 3, smallImages: 4, words: 60 } })).role).toBe('team');
    expect(classify(input({ signals: { largeImages: 5, words: 10 } })).role).toBe('gallery');
    expect(classify(input({ heading: 'Control absoluto', signals: { largeImages: 1, imageRatio: 0.8, words: 12 } })).role).toBe('banner');
    expect(classify(input({ heading: 'Una sola infraestructura', signals: { largeImages: 1, words: 80 } })).role).toBe('feature');
    expect(classify(input({ signals: { words: 300 } })).role).toBe('content');
    expect(classify(input({ signals: { words: 30 } })).role).toBe('default');
  });

  it('needs team words for cards with an image each: an icon grid is features', () => {
    // A card icon is a small image, so the card shape alone cannot tell a six-card
    // feature grid (SCAP Tech's "Tecnología") from a team of six.
    const grid = { cards: 6, cardHeadingLevel: 4, smallImages: 6, words: 120 };
    expect(classify(input({ heading: 'Tecnología', signals: grid })).role).toBe('features');
    expect(classify(input({ heading: 'Our team', signals: grid })).role).toBe('team');
    expect(classify(input({ heading: 'Our team', signals: grid })).reasons).toEqual([
      'kw:team',
      'cards with a portrait and a short name',
    ]);
  });

  it('a grid of captioned icons is a feature grid, not a wall of logos', () => {
    // One icon and one word per card (SCAP Tech's "Gestión tecnológica") is few words per
    // image, which read as a logo wall. A logo carries no heading of its own; a card does.
    const grid = { cards: 6, cardHeadingLevel: 3, smallImages: 6, words: 8 };
    expect(classify(input({ heading: 'Gestión tecnológica', signals: grid })).role).toBe('features');
    expect(classify(input({ signals: { smallImages: 8, words: 20, cards: 8 } })).role).toBe('logos');
    // The keyword arm names a wall of partner logos however it is built.
    expect(classify(input({ heading: 'Integraciones', signals: { ...grid, smallImages: 4 } })).role).toBe('logos');
  });

  it('products: keyword with a list, or a list next to a large image, or tabs', () => {
    expect(classify(input({ kicker: 'Productos', signals: { listItems: 6, words: 120 } })).role).toBe('products');
    expect(classify(input({ signals: { listItems: 6, largeImages: 1, words: 120 } })).role).toBe('products');
    expect(classify(input({ signals: { tabs: 3 } })).role).toBe('products');
  });

  it('secondary roles list the next matches, never default; cta is an attribute', () => {
    const d = classify(
      input({
        components: { ...withForm(2), links: [{ text: 'Go', href: '/x', kind: 'internal', cta: true }] },
        signals: { contactHints: 1 },
      }),
    );
    expect(d).toMatchObject({ role: 'contact', secondary: ['form'], cta: true });
  });

  it('keeps at most two secondary roles, and a form that holds the only buttons is not a cta', () => {
    // prices, questions, quotes and cards match four rules; only the two after the primary are kept.
    const crowded = classify(input({ signals: { prices: 3, questions: 4, quotes: 2, cards: 3, cardHeadingLevel: 3 } }));
    expect(crowded.role).toBe('pricing');
    expect(crowded.secondary).toEqual(['faq', 'testimonials']);
    expect(classify(input({ components: { ...withForm(2), buttons: ['Send'] } })).cta).toBe(false);
  });

  it('classifies an old block without signals like today', () => {
    expect(classify(input({ tag: 'header', landmark: true, signals: undefined })).role).toBe('navigation');
    expect(classify(input({ signals: undefined })).role).toBe('default');
  });
});
