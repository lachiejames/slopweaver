/**
 * What `plans add --provider codex` does around the register write: make sure the new Codex home exists before
 * the row is written, then install Slopweaver into it once the row has committed.
 *
 * Moved out of `./run.ts` unchanged, so that verb module stays one a reader can hold; `runChange` there is the
 * one caller of every export here.
 */
import type { Result } from "#lib/result.js";

import { renderSyncOutcome, type SyncOutcome, syncFailed } from "../../../codexPlugin/plan.js";
import type { PlanRegisterError } from "../../../plans/errors.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

import type { PlansInvocation } from "./core.js";

/** The seams these steps touch — a subset of `PlansDeps`, which satisfies it structurally. */
interface CodexAddDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  readonly ensureStoreDir: (input: { readonly storeDir: string }) => Result<"created" | "existed", string>;
  readonly syncCodexPluginHome: (input: {
    readonly codexHome: string;
    readonly home: string | undefined;
  }) => SyncOutcome;
}

/**
 * The Codex home a request registers: the store directory of a Codex `add`, and nothing for any other verb or
 * provider.
 *
 * @param request the parsed verb and its arguments
 * @returns the home to create and install into, or `undefined` when the request registers none
 */
export function addedCodexHome({ request }: { request: PlansInvocation["request"] }): string | undefined {
  if (request.verb === "add" && request.row.provider === "codex") {
    return request.row.storeDir;
  }
  return undefined;
}

/**
 * The lines `add` prints about the Codex home it just registered, after making sure the directory exists.
 *
 * Registering a directory that is not there handed the owner a sign-in line that failed on its first run
 * (`src/plans/login.ts` carries the measurement). It runs BEFORE the row is written, so a home that cannot
 * be created — a path under a regular file, a directory they cannot write — refuses the add instead of
 * registering a destination whose sign-in line would fail at its own `mkdir -p`; a Codex review found that
 * shape. The one residue is the reverse order's: a row the register then refuses leaves an empty directory.
 *
 * @param deps the injected seams
 * @param storeDir the Codex home about to be registered, created here when it is absent
 * @returns whether it was created or already there, or the refusal line
 */
export function ensureCodexHome({
  deps,
  storeDir,
}: {
  deps: CodexAddDeps;
  storeDir: string;
}): Result<"created" | "found", string> {
  return deps
    .ensureStoreDir({ storeDir })
    .map((ensured) => (ensured === "created" ? ("created" as const) : ("found" as const)))
    .mapErr(
      (cause) =>
        `plans: ${storeDir} could not be created (${cause}), so no row was added — a Codex home nobody can sign into takes no work. Fix the path, then add again`,
    );
}

/**
 * Install Slopweaver into the Codex home `add` just published, and print what happened on its own line.
 *
 * The row is already published and STAYS on a failure: registering the account and installing into it are two
 * acts, and a later `codex plugin-sync` repairs the second without losing the first. So a failure prints and
 * exits non-zero, and nothing is rolled back. Under `--json`, or once the verb has already failed, every sync
 * line goes to the diagnostic channel, so stdout stays the one snapshot document.
 *
 * @param deps the injected seams
 * @param codexHome the home the published row names
 * @param home the `--home` the register lives under, whose profile declares the main checkouts
 * @param diagnosticsOnly send even a success line to diagnostics: stdout is a JSON document, or carries nothing
 * @returns `EXIT_ERROR` when the install failed, else `EXIT_OK` — a `skipped` checkout included
 */
export function syncAddedCodexHome({
  codexHome,
  deps,
  diagnosticsOnly,
  home,
}: {
  codexHome: string;
  deps: CodexAddDeps;
  diagnosticsOnly: boolean;
  home: string | undefined;
}): number {
  const outcome = deps.syncCodexPluginHome({ codexHome, home });
  const failed = syncFailed({ outcome });
  const lines = renderSyncOutcome({ outcome });
  if (failed || diagnosticsOnly) {
    lines.forEach((line) => {
      deps.writeDiagnostic(line);
    });
  } else {
    lines.forEach((line) => {
      deps.writeOut(line);
    });
  }
  if (failed) {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/**
 * After a register write that failed, install into the Codex home only when the row committed anyway.
 *
 * A failed projection write is reported AFTER the row committed, so the Codex row is registered and its home
 * still gets the install; the verb exits non-zero for the projection either way, so the sync's own exit is
 * not returned. Every other failure wrote no row, and nothing is installed.
 *
 * @param deps the injected seams
 * @param codexHome the home the request registers, `undefined` for a request that registers none
 * @param error why the register write failed
 * @param home the `--home` the register lives under
 */
export function syncIfRowCommitted({
  codexHome,
  deps,
  error,
  home,
}: {
  codexHome: string | undefined;
  deps: CodexAddDeps;
  error: PlanRegisterError;
  home: string | undefined;
}): void {
  if (codexHome !== undefined && error.code === "PROJECTION_WRITE_FAILED") {
    syncAddedCodexHome({ codexHome, deps, diagnosticsOnly: true, home });
  }
}
