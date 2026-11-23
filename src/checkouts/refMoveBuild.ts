/**
 * Whether a ref move means this checkout's BUILT CLI no longer describes its source — the pure half of the
 * second `post-merge` / `post-checkout` command, beside `./refMoveInstall.ts`'s own.
 *
 * The trigger is the ref move's own CONTENT diff and never a freshness verdict, for the reason
 * `./refMoveInstall.ts` measured on the install half: a ref move rewrites every mtime in the tree, so an
 * mtime-keyed hook would rebuild on every checkout forever. The staleness guard
 * (`../builtCli/guard.ts`) is mtime-keyed precisely because it runs at a moment nothing is moving refs.
 *
 * Rebuilding here is what keeps that guard's refusal RARE: without the hook a pull leaves every built
 * checkout stale, and a guard that fires on every invocation is one an operator turns off.
 */
import type { RefMoveHook } from "./refMoveInstall.js";

/** Whether a ref move requires a rebuild, and the sentence that says why either way. */
export interface RefMoveBuildDecision {
  readonly build: boolean;
  readonly why: string;
}

/** The source tree the emit reads — a move touching nothing here cannot have staled the build. */
const SOURCE_PREFIX = "src/";

/** The test lane, which the emit excludes, so a move touching only tests leaves the built tree correct. */
const TEST_PREFIX = "src/__tests__/";

/** The two files that change what the emit RESOLVES rather than what it reads. */
const BUILD_SHAPING_FILES: ReadonlySet<string> = new Set(["package.json", "yarn.lock"]);

/**
 * Whether one path the move brought in can have staled a built CLI.
 *
 * `package.json` earns its place beside the source: the emitted tree carries a re-rooted copy of the
 * subpath-import map, so a new `#`-import changes the built output without any `.ts` file moving.
 *
 * @param path one repo-relative path from the move's own diff
 * @returns whether the built tree has to be re-emitted because of it
 */
export function stalesBuild({ path }: { path: string }): boolean {
  if (BUILD_SHAPING_FILES.has(path)) {
    return true;
  }
  return path.startsWith(SOURCE_PREFIX) && path.endsWith(".ts") && !path.startsWith(TEST_PREFIX);
}

/**
 * Decide whether the paths a ref move changed mean the built CLI has to be re-emitted.
 *
 * @param changedPaths the repo-relative paths the move brought in
 * @returns whether to rebuild, and why
 */
export function refMoveBuildDecision({ changedPaths }: { changedPaths: readonly string[] }): RefMoveBuildDecision {
  const staling = changedPaths.filter((path) => stalesBuild({ path }));
  const first = staling[0];
  if (first === undefined) {
    return {
      build: false,
      why: `the move changed ${String(changedPaths.length)} file(s), none of them built`,
    };
  }
  return { build: true, why: `the move changed ${first} and ${String(staling.length - 1)} other built file(s)` };
}

/** What one rebuild attempt ended up doing, ready to render as its single line. */
export type RefMoveBuildOutcome =
  /** Nothing to look at: not a ref move, nothing built here, or nothing this hook owns. */
  | { readonly did: "skipped"; readonly why: string }
  /** Looked, and the built tree already matches: no rebuild was needed. */
  | { readonly did: "current"; readonly why: string }
  /** Rebuilt, and the built tree is now correct. */
  | { readonly did: "rebuilt"; readonly why: string; readonly detail: string }
  /** Tried and failed — the built tree is NOT correct, and the guard will refuse until it is. */
  | { readonly did: "failed"; readonly why: string; readonly detail: string };

/** Every run of whitespace containing a line break, which is the only thing that can split one line in two. */
const LINE_BREAK_RUN = /\s*[\r\n]+\s*/gu;

/** The command an operator runs by hand when this hook could not. */
export const BUILD_FIX_COMMAND = "slopweaver dev build";

/**
 * Render one rebuild attempt as the ONE line it always prints.
 *
 * Both kinds of doing nothing are rendered differently, for the reason `renderRefMoveOutcome` gives: "I did
 * not look" and "I looked and it was fine" are not the same claim.
 *
 * @param hook which git hook is reporting
 * @param outcome what it did
 * @returns the line to print, guaranteed to carry no line break
 */
export function renderRefMoveBuildOutcome({ hook, outcome }: { hook: string; outcome: RefMoveBuildOutcome }): string {
  const text = ((): string => {
    if (outcome.did === "skipped") {
      return `${hook}: built CLI not checked — ${outcome.why}`;
    }
    if (outcome.did === "current") {
      return `${hook}: built CLI current — ${outcome.why}`;
    }
    if (outcome.did === "rebuilt") {
      return `${hook}: ran \`${BUILD_FIX_COMMAND}\` — ${outcome.why}; ${outcome.detail}`;
    }
    return `${hook}: \`${BUILD_FIX_COMMAND}\` FAILED — ${outcome.why}; ${outcome.detail}`;
  })();
  return text.trim().replace(LINE_BREAK_RUN, " · ");
}

/**
 * Which hook this was invoked as, or undefined when it was called with something else.
 *
 * Here rather than in `./refMoveBuildCli.ts` because that file is a top-level invocation — it runs on
 * import, so nothing can unit-test it, and a decode living there is a decode nothing checks.
 *
 * @param name the first argument `lefthook` passed, which is the hook's own name
 * @returns the hook, or undefined when the name is not one
 */
export function refMoveBuildHookFrom({ name }: { name: string | undefined }): RefMoveHook | undefined {
  if (name === "post-checkout" || name === "post-merge") {
    return name;
  }
  return undefined;
}
