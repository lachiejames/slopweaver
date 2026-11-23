/**
 * What one program's own words mean to `./wholeTreeCheck.ts`: `slopweaver dev lint`, and `node`/`tsx` running the
 * CLI, the compiler, vitest, prettier or knip from source; `tsc`, type-aware `oxlint`, `tsgolint`, `vitest`,
 * `prettier` and `knip` themselves are `./checkToolInvocation.ts`'s. Each is judged from its arguments
 * and the directory it runs in alone; walking a command line to reach them — segments, substitutions, wrappers,
 * `cd` — stays in `./wholeTreeCheck.ts`.
 */
import { checkToolLane, tscLane } from "./checkToolInvocation.js";
import { devLintScope } from "./devLintInvocation.js";
import { optionNamesModule, scriptHostStarts } from "./scriptHostInvocation.js";
import type { ShellWord } from "./shellLexing.js";
import { vitestRunLane } from "./vitestInvocation.js";

/** The CLI's own entry point, run from source by `node` or `tsx`. */
const CLI_SCRIPT = /(?:^|\/)cli\/index\.[jt]s$/u;

/** TypeScript's `tsc` launcher, or the compiler entrypoints it loads (`lib/tsc.js`, `lib/_tsc.js`), run by `node`. */
export const TSC_SCRIPT = /(?:^|\/)(?:(?:typescript\/bin|\.bin)\/tsc|typescript\/lib\/_?tsc\.js)$/u;

/** Vitest's launcher, as its package declares it (`vitest/vitest.mjs`) or as `.bin` links it, run by `node`. */
const VITEST_SCRIPT = /(?:^|\/)(?:vitest\/vitest\.mjs|\.bin\/vitest)$/u;

/** Prettier's and knip's launchers, as each package declares its `bin` or as `.bin` links it, run by `node`. */
const CHECK_TOOL_SCRIPTS: readonly { readonly pattern: RegExp; readonly program: string }[] = [
  { pattern: /(?:^|\/)(?:prettier\/bin\/prettier\.cjs|\.bin\/prettier)$/u, program: "prettier" },
  { pattern: /(?:^|\/)(?:knip\/bin\/knip\.js|\.bin\/knip)$/u, program: "knip" },
];

/**
 * What this gate made of one call.
 *
 * @internal — the classifier's own return shape; `./wholeTreeCheckGuardRunner.ts` is the public surface.
 */
export type WholeTreeCheck =
  { readonly kind: "not-whole-tree" } | { readonly kind: "whole-tree"; readonly what: string };

export const NOT_WHOLE_TREE: WholeTreeCheck = { kind: "not-whole-tree" };

/**
 * `slopweaver dev lint …`, by any path to the binary.
 *
 * @param args the words after the binary
 * @returns the whole-tree run they are, or `not-whole-tree`
 */
export function judgeSlopweaver({ args }: { args: readonly string[] }): WholeTreeCheck {
  if (args[0] === "dev" && args[1] === "lint") {
    return judgeDevLint({ args: args.slice(2), label: "slopweaver dev lint" });
  }
  return NOT_WHOLE_TREE;
}

/**
 * `node`/`tsx` running the CLI from source (`src/cli/index.ts dev lint`), TypeScript's own `tsc` script,
 * vitest's (`node node_modules/vitest/vitest.mjs run`), or prettier's or knip's.
 * The script is the first word that is no option, under either reading of the options `./scriptHostInvocation.ts`
 * gives, so a compiler path handed to `node -e` as data is never read as the script.
 *
 * @param args the words after `node` or `tsx`
 * @param cwd the directory it runs in, when known
 * @param host `node` or `tsx`, whose subcommands differ
 * @param fed whether an `xargs` in the same command list hands it operands
 * @returns the whole-tree run they are, or `not-whole-tree`
 */
export function judgeScriptHost({
  args,
  cwd,
  host,
  fed,
}: {
  args: readonly ShellWord[];
  cwd: string | undefined;
  host: string;
  fed: boolean;
}): WholeTreeCheck {
  const texts = args.map((word) => word.text);
  for (const at of scriptHostStarts({ args: texts, host })) {
    const rest = texts.slice(at + 1);
    const script = texts[at]!;
    const tool = CHECK_TOOL_SCRIPTS.find(({ pattern }) => pattern.test(script));
    let judged = NOT_WHOLE_TREE;
    if (CLI_SCRIPT.test(script)) {
      judged = judgeSlopweaver({ args: rest });
    } else if (TSC_SCRIPT.test(script)) {
      judged = lane({ what: tscLane({ args: rest }) });
    } else if (VITEST_SCRIPT.test(script)) {
      judged = lane({ what: vitestRunLane({ args: rest, cwd, fed }) });
    } else if (tool !== undefined) {
      judged = lane({ what: checkToolLane({ args: args.slice(at + 1), cwd, fed, program: tool.program }) });
    }
    if (judged.kind === "whole-tree") {
      return judged;
    }
  }
  // A preload of the compiler runs it over the project, whatever the line evaluates.
  return optionNamesModule({ args: texts, pattern: TSC_SCRIPT })
    ? lane({ what: tscLane({ args: [] }) })
    : NOT_WHOLE_TREE;
}

/**
 * The `dev lint` tail as a whole-tree run (`./devLintInvocation.ts`).
 *
 * @param args the words after `dev lint`
 * @param label how the refusal names the command that ran it
 * @returns the whole-tree run they are, or `not-whole-tree`
 */
export function judgeDevLint({ args, label }: { args: readonly string[]; label: string }): WholeTreeCheck {
  const what = devLintScope({ args, label });
  return what === undefined ? NOT_WHOLE_TREE : { kind: "whole-tree", what };
}

/**
 * A description as a whole-tree run, or `not-whole-tree` when there is none (`./checkToolInvocation.ts`).
 *
 * @param what the lane a tool's own judge named, or `undefined` when it named none
 * @returns the whole-tree run, or `not-whole-tree`
 */
export function lane({ what }: { what: string | undefined }): WholeTreeCheck {
  return what === undefined ? NOT_WHOLE_TREE : { kind: "whole-tree", what };
}

/**
 * Whether `xargs` is among the wrappers peeled to reach a program, and so hands it operands computed at run time
 * that no word shows. The word anywhere else feeds nothing: `vitest run -t xargs` is a whole lane.
 *
 * @param from the words resolution started from
 * @param program the program and its arguments, a suffix of `from`
 * @returns true when an unquoted `xargs` sits in the peeled prefix
 */
export function fedByXargs({ from, program }: { from: readonly ShellWord[]; program: readonly ShellWord[] }): boolean {
  const peeled = from.slice(0, from.length - program.length);
  return peeled.some((word) => !word.quoted && word.text.slice(word.text.lastIndexOf("/") + 1) === "xargs");
}
