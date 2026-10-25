import { createRequire } from 'node:module';

/** The version from package.json: one source for the CLI, the MCP server and /api/health. */
export const VERSION: string = (createRequire(import.meta.url)('../package.json') as { version: string }).version;
