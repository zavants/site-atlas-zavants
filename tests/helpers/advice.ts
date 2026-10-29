/** The advice one writer stores: big enough that two writers overlap while they publish it. */
export const adviceMarkdown = (by: string) => `# Advice by ${by}\n\n${by.repeat(60_000)}`;

export const adviceSummary = (by: string) => `Summary by ${by}`;

/** True when the summary and the markdown on disk were both written by the agent that signed them. */
export function wholeAdvice(advice: { by: string; summary: string; markdown: string } | null): boolean {
  return !!advice && advice.summary === adviceSummary(advice.by) && advice.markdown === adviceMarkdown(advice.by);
}
