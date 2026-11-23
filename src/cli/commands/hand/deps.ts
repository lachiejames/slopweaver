/**
 * The seams every `hand` verb runs through, declared once so six modules cannot drift on what "now" or
 * "the launcher" means.
 *
 * `run` is synchronous on purpose and by rule: `no-headless` bans every asynchronous `node:child_process`
 * member outright, and nothing here needs one — a launch returns in 0.19s and a notification in 0.26s, both
 * measured. Reproduce either with `time slopweaver hand show <id>` and `time slopweaver hand push`
 * against an install carrying one open step.
 */
import { execFileSync } from "node:child_process";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { recordedProfilePort } from "../../../browser/recordedProfile.js";
import { unlandedBranchesDeclaring } from "../../../devLint/secretsRegistryGit.js";
import { CONSOLE_URL_ENV, consoleBaseFrom } from "../../../hand/consoleLink.js";
import type { NoteCommand } from "../../../hand/note/raise.js";
import type { ReconcileOutcome } from "../../../hand/reconcile.js";
import type { RowPullRequests } from "../../../hand/rowPullRequest.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { installedTreeRoot } from "../../../lib/pluginRoot.js";

import { type HandPageLook, lookAtHandUrl } from "./pageLookRun.js";

/** How long either macOS call may block. Both are sub-second; this is a bound, not an expectation. */
const HAND_COMMAND_TIMEOUT_MS = 5_000;

/** Everything a `hand` verb touches outside itself. */
export interface HandDeps {
  readonly now: () => string;
  /** The console origin a minted queue link points at — `SLOPWEAVER_CONSOLE_URL`, else the `yarn console` port. */
  readonly consoleBase: () => string;
  /** `process.platform`, so a test drives the not-macOS arm without pretending to be another machine. */
  readonly platform: string;
  /** Runs one macOS command, throwing on failure. */
  readonly run: (command: NoteCommand) => void;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /**
   * The refs whose secrets registry declares a name this build's lacks — what `hand post` names beside a step refused
   * for one (`../../../hand/secretName.ts`). Every git fault answers none.
   */
  readonly branchesDeclaring: (options: { name: string }) => readonly string[];
  /**
   * Open a step's web `--url` in the owner's Chrome and judge what it shows (`./pageLookRun.ts`) — what `hand post` does
   * before the note goes up, so a note never opens a page nobody has seen show the thing.
   */
  readonly lookAt: (options: { url: string; home: string }) => HandPageLook | Promise<HandPageLook>;
  /**
   * The pull requests of the board row a `--check-in` names (`../../../hand/rowPullRequest.ts`). Read from GitHub
   * BEFORE the synchronous verb runs (`./post.ts`'s command wrapper), so this seam only hands the answer over.
   */
  readonly rowPullRequests: (options: { row: string }) => RowPullRequests;
}

/**
 * The real seams: the machine clock, this platform, `execFileSync`, and the two output channels.
 *
 * @returns the production dependencies for every `hand` verb
 */
export function productionHandDeps(): HandDeps {
  return {
    // This BUILD's tree, never cwd: the registry that refused the name is the one compiled into the running code. A
    // plugin mirror has no `.git`, so the lookup's git fault answers none there. A build in no plugin tree at all gets
    // `installedTreeRoot`'s cwd fallback — another checkout's refs, even when that is a plugin checkout — so a root not
    // holding this very module answers none too.
    branchesDeclaring: ({ name }) => {
      const root = installedTreeRoot({ importMetaUrl: import.meta.url });
      const ownTree = fileURLToPath(import.meta.url).startsWith(`${root}${sep}`);
      return ownTree ? unlandedBranchesDeclaring({ name, root }) : [];
    },
    consoleBase: () => consoleBaseFrom({ configured: process.env[CONSOLE_URL_ENV] }),
    lookAt: ({ url, home }) => lookAtHandUrl({ home, profiles: recordedProfilePort(), url }),
    now: () => new Date().toISOString(),
    platform: process.platform,
    run: (command) => {
      execFileSync(command.file, [...command.args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: HAND_COMMAND_TIMEOUT_MS,
      });
    },
    // Only `hand post` reads a row's pull requests, and its wrapper replaces this with the answer it read first; every
    // other verb asks nothing.
    rowPullRequests: () => ({ kind: "not-asked" }),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * Say what the reconcile did that no hand did: each step evidence retracted, each named row it could not read,
 * each note that would not close, each Done press that would not record. Diagnostics only — stdout stays the verb's own contract — and the row
 * problems ALSO ride on the step in `hand list --json` (`rowProblem`), because the console discards a
 * successful verb's stderr and the owner's queue is where a card that will not leave has to say why.
 *
 * @param verb the verb reporting, as it prefixes its lines
 * @param outcome what the reconcile returned
 * @param deps the output channels
 */
export function reportReconciled({
  verb,
  outcome,
  deps,
}: {
  verb: string;
  outcome: ReconcileOutcome;
  deps: HandDeps;
}): void {
  outcome.evidenceSettled.forEach((id) => {
    deps.writeDiagnostic(`${verb}: ${id} left the owner's queue — the board row it named is finished`);
  });
  outcome.evidenceProblems.forEach((problem) => {
    deps.writeDiagnostic(`${verb}: ${problem.message}, so every step naming it stays open`);
  });
  outcome.unclosedNotes.forEach((problem) => {
    deps.writeDiagnostic(`${verb}: a retracted step's note could not be told to close — ${problem.message}`);
  });
  outcome.unremovedMarkers.forEach((problem) => {
    deps.writeDiagnostic(
      `${verb}: a marker it consumed could not be removed — ${problem.message}. Its settling stands`,
    );
  });
  outcome.unsettledMarkers.forEach(({ id, problem }) => {
    deps.writeDiagnostic(
      `${verb}: the Done pressed on ${id} was not recorded — ${problem.message}. Its marker is kept`,
    );
  });
  outcome.unrecordedLaters.forEach((problem) => {
    deps.writeDiagnostic(`${verb}: the Later ledger did not update — ${problem.message}`);
  });
  outcome.unrecordedSnoozes.forEach((problem) => {
    deps.writeDiagnostic(`${verb}: a snooze did not record — ${problem.message}`);
  });
}

/**
 * Print every line of the register this read could not make a row of.
 *
 * **Every verb that reads the register calls this**, which is the whole of the lenient-read change: one bad
 * line no longer refuses the read (`../../../hand/store.ts`), and the cost of that is a step that could
 * silently stop being mentioned. A skipped POSTED line is something waiting on the owner that no surface names,
 * so the report goes to the DIAGNOSTIC channel on every run — including `--json`, where stdout is a
 * machine's and stderr is the only place a human is looking.
 *
 * It names the repair rather than only the damage: the register is append-only, so the fix is never an
 * edit in place.
 *
 * @param verb the verb's own name, so the line reads like the rest of its output
 * @param unparsed what the read could not parse, in file order
 * @param deps the output channels
 */
export function reportUnparsed({
  verb,
  unparsed,
  deps,
}: {
  verb: string;
  unparsed: readonly { readonly message: string }[];
  deps: HandDeps;
}): void {
  if (unparsed.length === 0) {
    return;
  }
  unparsed.forEach((problem) => {
    deps.writeDiagnostic(`${verb}: skipped — ${problem.message}`);
  });
  deps.writeDiagnostic(
    `${verb}: ${String(unparsed.length)} line(s) of the hand-step register were skipped, so anything they ` +
      "recorded is NOT in what follows. The register is append-only: settle or re-post the affected step " +
      "rather than editing the file.",
  );
}

/**
 * A flag's value, or undefined when it was not supplied.
 *
 * @param values the parsed flag map
 * @param name the flag to read
 * @returns the string, or `undefined`
 */
export function flag({
  values,
  name,
}: {
  values: Readonly<Record<string, unknown>>;
  name: string;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * The state home this invocation reads and writes: `--home` when one was passed, else this install's own.
 *
 * Spelled as an `if` rather than either short form, because the two gates disagree about those:
 * `no-silent-fallback` bans the `??`, and oxlint's `prefer-nullish-coalescing` rewrites the ternary straight
 * back into one. Naming the absent case satisfies both, and it is what the house rule asks for anyway.
 *
 * @param values the parsed flag map
 * @returns the directory every `hand`, `monitor` and `incident` read and write lands under
 */
export function resolvedHomeOf({ values }: { values: Readonly<Record<string, unknown>> }): string {
  const home = flag({ name: "home", values });
  if (home === undefined) {
    return slopweaverHome();
  }
  return home;
}

/**
 * The session recording this act, defaulting to a name that says it was not supplied rather than to one
 * that looks like a real session.
 *
 * @param values the parsed flag map
 * @returns what goes in `bySession`
 */
export function bySession({ values }: { values: Readonly<Record<string, unknown>> }): string {
  const named = flag({ name: "by-session", values });
  if (named === undefined) {
    return "unnamed-session";
  }
  return named;
}
