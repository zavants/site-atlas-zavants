import { en } from '../i18n/en.js';
import type { Scan } from '../schema/scan.js';
import type { Change, ChangeStatus } from './changes.js';

/** Site text on a single line that can never start a Markdown heading. */
export function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/^#+\s*/, '');
}

/** Inline code span that holds `s` on one line, with a fence longer than any backtick run inside it. */
function code(s: string): string {
  const text = oneLine(s);
  if (!text) return en.plan.empty;
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return en.plan.none;
  if (typeof v === 'string') return code(v);
  return String(v);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every value as a nested bullet list; every string is wrapped in a code span. */
function bullets(obj: Record<string, unknown>, indent = ''): string[] {
  return Object.entries(obj).flatMap(([key, v]) => {
    if (isObject(v)) return [`${indent}- ${key}:`, ...bullets(v, `${indent}  `)];
    if (Array.isArray(v)) {
      if (!v.length) return [`${indent}- ${key}: ${en.plan.none}`];
      if (!v.some(isObject)) return [`${indent}- ${key}: ${v.map(scalar).join(', ')}`];
      return [`${indent}- ${key}:`, ...v.flatMap((item, i) => [`${indent}  - ${i + 1}:`, ...(isObject(item) ? bullets(item, `${indent}    `) : [`${indent}    - ${scalar(item)}`])])];
    }
    return [`${indent}- ${key}: ${scalar(v)}`];
  });
}

/**
 * The plan as Markdown for any AI: header, fixed instructions, then each change. Site text is always inline code.
 * Pass every change: with `status` only those are listed, but the summary line still counts all of them.
 */
export function describePlan(scan: Scan, all: Change[], status?: ChangeStatus): string {
  const { origin, basePath } = scan.environment;
  const count = (s: ChangeStatus) => all.filter((c) => c.status === s).length;
  const changes = status ? all.filter((c) => c.status === status) : all;
  const lines = [
    en.plan.title(oneLine(scan.site)),
    '',
    en.plan.scanLine(scan.scanId, origin + basePath, count('pending'), count('applied'), status),
    '',
    en.plan.instructions,
    '',
    en.plan.siteText,
  ];
  if (!changes.length) lines.push('', status ? en.plan.noneWithStatus(status) : en.plan.inSync);
  for (const c of changes) {
    const meta: Record<string, unknown> = { by: c.by, observed: c.observed };
    if (c.confirmation) meta.confirmation = c.confirmation;
    lines.push('', `## ${c.status} · ${c.id}`, '', code(c.summary), '', ...bullets({ ...c.details, ...meta }), '', `${en.plan.doneWhen} ${code(c.doneWhen)}`);
  }
  return lines.join('\n') + '\n';
}
