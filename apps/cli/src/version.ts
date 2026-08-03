/**
 * The published package version, replaced at build time by tsup's `define` from
 * package.json. The fallback only applies when the source is executed directly
 * (vitest, `tsx src/index.ts`), where no bundler substitution happened.
 */
declare const __CLI_VERSION__: string | undefined;

export const CLI_VERSION: string =
  typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : "0.0.0-dev";
