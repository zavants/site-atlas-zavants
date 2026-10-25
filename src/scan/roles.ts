import type { Components, SectionRole, Signals } from '../schema/scan.js';

/** What the classifier reads about one section. Pure data: no DOM, no scan, no overlay. */
export interface RoleInput {
  tag: string;
  landmark: boolean;
  isFirstSection: boolean;
  pageHasH1Here: boolean;
  heading: string | null;
  kicker: string | null;
  anchor: string | null;
  components: Components;
  signals: Signals | undefined;
}

export interface Detection {
  role: SectionRole;
  secondary: SectionRole[];
  cta: boolean;
  reasons: string[];
}

/**
 * Precedence: the first rule that matches gives the primary role, the next two give the
 * secondary ones. Landmarks are certain; a hero wins over anything it also looks like;
 * conversion sections beat descriptive ones; steps is checked before audience and solutions
 * because all three use cards; products before features because a catalog looks like a grid;
 * banner before features and feature because it is short.
 */
export const ROLE_ORDER: SectionRole[] = [
  'navigation',
  'footer',
  'hero',
  'contact',
  'form',
  'pricing',
  'faq',
  'testimonials',
  'logos',
  'stats',
  'steps',
  'audience',
  'solutions',
  'products',
  'team',
  'about',
  'gallery',
  'banner',
  'features',
  'feature',
  'content',
  'default',
];

/**
 * Words that name a section, in Spanish, English and Portuguese. They are written without
 * accents because both sides of a comparison are accent-stripped: "sobre nos" also matches
 * "Sobre nós". Adding a language is adding entries, not code. Matched against the kicker,
 * the heading and the anchor only, never the body text.
 */
export const ROLE_KEYWORDS: Record<SectionRole, string[]> = {
  navigation: [],
  footer: [],
  hero: [],
  form: [],
  contact: [
    'contacto',
    'contactenos',
    'cotizacion',
    'presupuesto',
    'hablemos',
    'contact',
    'get in touch',
    'request a quote',
    'contato',
    'orcamento',
  ],
  pricing: ['precios', 'tarifas', 'planes y precios', 'pricing', 'prices', 'plans & pricing', 'precos'],
  faq: ['preguntas frecuentes', 'faq', 'dudas', 'frequently asked', 'questions', 'perguntas frequentes'],
  testimonials: [
    'testimonios',
    'opiniones',
    'clientes dicen',
    'testimonials',
    'reviews',
    'what our customers say',
    'depoimentos',
  ],
  logos: ['integraciones', 'partners', 'clientes', 'confian', 'integrations', 'trusted by', 'integracoes', 'parceiros'],
  stats: ['cifras', 'numeros', 'en numeros', 'stats', 'by the numbers'],
  steps: [
    'como trabajamos',
    'como funciona',
    'proceso',
    'pasos',
    'metodologia',
    'how it works',
    'process',
    'steps',
    'how we work',
    'como trabalhamos',
    'processo',
    'etapas',
  ],
  audience: ['para quien', 'para quienes', 'who is it for', 'for whom', 'built for', 'made for', 'para quem'],
  solutions: [
    'soluciones',
    'por industria',
    'sectores',
    'casos de uso',
    'solutions',
    'industries',
    'use cases',
    'solucoes',
    'setores',
  ],
  products: [
    'productos',
    'modulos',
    'plataforma',
    'catalogo',
    'planes',
    'products',
    'modules',
    'plans',
    'catalog',
    'produtos',
    'planos',
  ],
  team: ['equipo', 'nuestro equipo', 'team', 'our team', 'equipe', 'nossa equipe'],
  about: [
    'nosotros',
    'quienes somos',
    'sobre nosotros',
    'about',
    'about us',
    'who we are',
    'our story',
    'sobre nos',
    'quem somos',
  ],
  gallery: [],
  banner: [],
  features: [],
  feature: [],
  content: [],
  default: [],
};

/** Lower case, accents stripped, anything that is not a letter or a digit turned into a space. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True when one of the role's words or phrases appears whole in one of the texts. */
export function matchesKeyword(role: SectionRole, texts: (string | null)[]): boolean {
  const keywords = ROLE_KEYWORDS[role];
  if (keywords.length === 0) return false;
  for (const text of texts) {
    if (text === null) continue;
    const haystack = ` ${fold(text)} `;
    for (const keyword of keywords) {
      const needle = fold(keyword);
      if (needle !== '' && haystack.includes(` ${needle} `)) return true;
    }
  }
  return false;
}

const NO_SIGNALS: Signals = {
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

function countWords(text: string | null): number {
  if (text === null) return 0;
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

interface Context {
  input: RoleInput;
  s: Signals;
  /** Headings of the section; the heading field counts when the components carry none. */
  headings: number;
  form: boolean;
  cta: boolean;
  kw: (role: SectionRole) => boolean;
}

/** Each rule answers with the reasons it fired, or null. */
type Rule = (c: Context) => string[] | null;

const when = (condition: boolean, ...reasons: string[]): string[] | null => (condition ? reasons : null);

const RULES: Record<SectionRole, Rule> = {
  navigation: (c) =>
    when((c.input.landmark && (c.input.tag === 'header' || c.input.tag === 'nav')) || c.input.tag === 'nav', 'nav tag'),
  footer: (c) => when(c.input.landmark && c.input.tag === 'footer', 'footer landmark'),
  hero: (c) =>
    c.input.pageHasH1Here
      ? ['h1 here']
      : when(c.input.isFirstSection && c.input.heading !== null && c.cta, 'first section with a cta'),
  contact: (c) =>
    when(
      (c.form || c.s.contactHints >= 1) && (c.s.contactHints >= 1 || c.kw('contact')),
      c.s.contactHints >= 1 ? 'contactHints>=1' : 'kw:contact',
    ),
  form: (c) => when(c.form, 'form with fields'),
  pricing: (c) =>
    c.s.prices >= 2 ? ['prices>=2'] : when(c.kw('pricing') && c.s.cards >= 2, 'kw:pricing', 'cards>=2'),
  faq: (c) => (c.s.questions >= 3 ? ['questions>=3'] : when(c.s.accordions >= 3 && c.kw('faq'), 'accordions>=3', 'kw:faq')),
  testimonials: (c) =>
    c.s.quotes >= 2 ? ['quotes>=2'] : when(c.kw('testimonials') && c.s.cards >= 2, 'kw:testimonials', 'cards>=2'),
  logos: (c) =>
    c.s.smallImages >= 6 && c.s.words / Math.max(1, c.s.smallImages) <= 6
      ? ['smallImages>=6', 'few words per image']
      : when(c.kw('logos') && c.s.smallImages >= 4, 'kw:logos', 'smallImages>=4'),
  stats: (c) => when(c.s.bigNumbers >= 3, 'bigNumbers>=3'),
  /*
   * Cards alone are not a process: a feature grid under "About our process" is features.
   * The cards arm asks for the numbering that a process shows.
   */
  steps: (c) =>
    c.kw('steps') && (c.s.numbered >= 3 || c.s.orderedItems >= 3 || (c.s.cards >= 3 && c.s.numbered >= 2))
      ? ['kw:steps', 'numbered items']
      : when(c.s.orderedItems >= 3 && c.s.cards === 0, 'orderedItems>=3'),
  audience: (c) => when(c.kw('audience') && (c.s.cards >= 2 || c.s.numbered >= 2), 'kw:audience', 'cards>=2'),
  solutions: (c) => when(c.kw('solutions') && c.s.cards >= 2, 'kw:solutions', 'cards>=2'),
  products: (c) => {
    if (c.kw('products') && (c.s.cards >= 3 || c.s.listItems >= 5)) return ['kw:products', 'cards or list'];
    if (c.s.listItems >= 5 && c.s.largeImages >= 1 && c.s.words <= 200) return ['listItems>=5', 'largeImages>=1'];
    return when(c.s.tabs >= 3, 'tabs>=3');
  },
  team: (c) => {
    const portraits = c.s.smallImages + c.s.largeImages;
    const named =
      c.s.cards >= 3 &&
      portraits >= c.s.cards &&
      c.s.cardHeadingLevel !== null &&
      c.s.cardHeadingLevel >= 3 &&
      c.s.words / Math.max(1, c.s.cards) <= 25;
    return named ? ['cards with a portrait and a short name'] : when(c.kw('team'), 'kw:team');
  },
  about: (c) => when(c.kw('about') && c.s.cards === 0, 'kw:about', 'cards==0'),
  gallery: (c) => when(c.s.largeImages >= 4 && c.s.words <= 60, 'largeImages>=4', 'words<=60'),
  banner: (c) =>
    when(
      c.headings <= 2 &&
        c.s.words <= 40 &&
        (c.s.imageRatio >= 0.3 || c.s.largeImages >= 1) &&
        !c.input.pageHasH1Here,
      'short with one image',
    ),
  features: (c) => when(c.s.cards >= 3 && c.s.cardHeadingLevel !== null, 'cards>=3', 'cards have headings'),
  feature: (c) =>
    when(c.headings >= 1 && c.s.largeImages >= 1 && c.s.words <= 120 && c.s.cards === 0, 'one heading, one image'),
  content: (c) => when(c.s.words >= 150 && c.s.cards === 0 && c.s.largeImages === 0, 'words>=150', 'no cards'),
  default: () => ['no rule matched'],
};

/**
 * The role of one section: the first rule of `ROLE_ORDER` that matches, the next two as
 * secondary roles, and the call-to-action flag. Pure and deterministic: the same signals
 * always give the same role. A section scanned before roles existed has no signals; it is
 * read with every count at zero, which leaves navigation, footer, hero, form and default.
 */
export function classify(input: RoleInput): Detection {
  const signals: Signals = input.signals ?? { ...NO_SIGNALS, words: countWords(input.heading) };
  const form = input.components.forms.some((f) => f.fields >= 1);
  const texts = [input.kicker, input.heading, input.anchor];
  const context: Context = {
    input,
    s: signals,
    headings: Math.max(input.components.headings.length, input.heading === null ? 0 : 1),
    form,
    cta: input.components.links.some((l) => l.cta === true) || (!form && input.components.buttons.length > 0),
    kw: (role) => matchesKeyword(role, texts),
  };

  const matches: { role: SectionRole; reasons: string[] }[] = [];
  for (const role of ROLE_ORDER) {
    const reasons = RULES[role](context);
    if (reasons !== null) matches.push({ role, reasons });
  }
  const primary = matches[0]!;
  return {
    role: primary.role,
    secondary: matches
      .slice(1)
      .filter((m) => m.role !== 'default')
      .slice(0, 2)
      .map((m) => m.role),
    cta: context.cta,
    reasons: primary.reasons,
  };
}
