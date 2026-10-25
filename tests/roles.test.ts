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

  it('needs process words for numbered cards to be steps; audience words make them audience', () => {
    expect(classify(input({ kicker: 'Cómo trabajamos', signals: { cards: 4, numbered: 4, cardHeadingLevel: 3 } })).role).toBe('steps');
    expect(classify(input({ kicker: 'Para quién', signals: { cards: 3, numbered: 3, cardHeadingLevel: 3 } })).role).toBe('audience');
    expect(classify(input({ heading: 'Our platform', signals: { cards: 3, numbered: 3, cardHeadingLevel: 3 } })).role).toBe('features');
  });

  it('matches keywords only in kicker, heading and anchor, accent-insensitively', () => {
    expect(matchesKeyword('about', ['NOSOTROS'])).toBe(true);
    expect(matchesKeyword('about', ['Sobre nos'])).toBe(true);
    expect(matchesKeyword('steps', ['Processing payments'])).toBe(false); // whole word
    expect(classify(input({ heading: 'About our process', signals: { cards: 3, cardHeadingLevel: 3 } })).role).toBe('features');
  });

  it('recognizes logos, stats, testimonials, pricing, faq, team, gallery, banner, feature, content, default', () => {
    expect(classify(input({ signals: { smallImages: 8, words: 20 } })).role).toBe('logos');
    expect(classify(input({ signals: { bigNumbers: 3, words: 30 } })).role).toBe('stats');
    expect(classify(input({ signals: { quotes: 2, cards: 2 } })).role).toBe('testimonials');
    expect(classify(input({ signals: { prices: 3, cards: 3, cardHeadingLevel: 3 } })).role).toBe('pricing');
    expect(classify(input({ signals: { questions: 4, accordions: 4 } })).role).toBe('faq');
    expect(classify(input({ signals: { cards: 4, cardHeadingLevel: 3, smallImages: 4, words: 60 } })).role).toBe('team');
    expect(classify(input({ signals: { largeImages: 5, words: 10 } })).role).toBe('gallery');
    expect(classify(input({ heading: 'Control absoluto', signals: { largeImages: 1, imageRatio: 0.8, words: 12 } })).role).toBe('banner');
    expect(classify(input({ heading: 'Una sola infraestructura', signals: { largeImages: 1, words: 80 } })).role).toBe('feature');
    expect(classify(input({ signals: { words: 300 } })).role).toBe('content');
    expect(classify(input({ signals: { words: 30 } })).role).toBe('default');
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

  it('classifies an old block without signals like today', () => {
    expect(classify(input({ tag: 'header', landmark: true, signals: undefined })).role).toBe('navigation');
    expect(classify(input({ signals: undefined })).role).toBe('default');
  });
});
