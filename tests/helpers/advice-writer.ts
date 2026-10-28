// Child process for the concurrent-writes test: stores one agent's advice N times.
import { SiteStore } from '../../src/store/store.js';
import { adviceMarkdown, adviceSummary } from './advice.js';

const [home, site, count, by] = process.argv.slice(2);
const store = new SiteStore(home);
const markdown = adviceMarkdown(by!);
for (let i = 0; i < Number(count); i++) await store.writeAdvice(site!, { by: by!, summary: adviceSummary(by!), markdown });
