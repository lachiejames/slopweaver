/**
 * The two file reads `./refIdentity.ts`'s comparison needs, and the refusal it turns a renamed ref into.
 *
 * Split in two on purpose, because they sit on opposite sides of the executor's non-atomic window (see
 * `./actionExecutor.ts`'s header). {@link citedElements} reads the caller's filed look and runs BEFORE the
 * admission reads the page, so it costs the window nothing. {@link refuseARenamedRef} runs after that read and
 * before the dispatch; it reads a file only when the client filed the admission's snapshot instead of printing
 * it, and that file is the client's own, in the session's private workspace under `$SLOPWEAVER_HOME` — a local
 * read, never a caller-named mount like the `--download-dir` the ordering rule was measured on.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "#lib/result.js";
import { type BrowserActionError, BrowserActionErrors } from "./actionErrors.js";
import type { AimRequest } from "./aim.js";
import type { PageObservation } from "./interactionSession.js";
import { aimedRefs, describeRefElement, renamedRef } from "./refIdentity.js";
import type { TerminalReply } from "./terminalClient.js";

/**
 * Read back the snapshot the cited look filed.
 *
 * @param observation the look the action cites, when it cites one
 * @returns the snapshot text, `null` when nothing is cited, or the typed failure when a cited look's file is gone
 */
export function citedElements({
  observation,
}: {
  observation: PageObservation | undefined;
}): Result<string | null, BrowserActionError> {
  if (observation === undefined) {
    return ok(null);
  }
  try {
    return ok(readFileSync(observation.snapshotPath, "utf8"));
  } catch {
    // Skipping the comparison here would be a silent fallback: the one read that says what the ref named
    // when it was chosen is the read that is missing.
    return err(BrowserActionErrors.observationUnusable({ because: "elements-unreadable" }));
  }
}

/**
 * Refuse an interaction whose aimed ref names a different element on the page now than in the cited read.
 *
 * @param observedYaml the cited read's snapshot, or `null` when the action cites none — then there is nothing
 *   to compare and nothing is refused
 * @param admitted the admission's own page read, which the dispatch resolves the ref against
 * @param workspace the session's private directory, which a filed snapshot's path is relative to
 * @param request the aiming values
 * @returns nothing when every aimed ref still names what it named, or the typed refusal
 */
export function refuseARenamedRef({
  observedYaml,
  admitted,
  workspace,
  request,
}: {
  observedYaml: string | null;
  admitted: TerminalReply;
  workspace: string;
  request: AimRequest;
}): Result<null, BrowserActionError> {
  if (observedYaml === null) {
    return ok(null);
  }
  const admittedYaml = admittedElements({ admitted, workspace });
  if (admittedYaml.isErr()) {
    return err(admittedYaml.error);
  }
  if (admittedYaml.value === null) {
    return ok(null);
  }
  const renamed = renamedRef({ admittedYaml: admittedYaml.value, observedYaml, refs: aimedRefs({ request }) });
  if (renamed === null) {
    return ok(null);
  }
  return err(
    BrowserActionErrors.refNamesAnotherElement({
      admitted: describeRefElement({ element: renamed.admitted }),
      observed: describeRefElement({ element: renamed.observed }),
      ref: renamed.ref,
    }),
  );
}

/**
 * The admission read's snapshot text, printed or filed.
 *
 * A reply carrying neither is a page that rendered nothing aimable, answered as `null` rather than as a
 * failure because it is a real reading: no element carries any ref, so none can have been renamed, and the
 * client fails a ref on such a page closed by itself.
 *
 * @param admitted the admission's own page read
 * @param workspace the session's private directory
 * @returns the snapshot text, `null` when the page printed none, or the typed failure when a filed one cannot
 *   be read back
 */
function admittedElements({
  admitted,
  workspace,
}: {
  admitted: TerminalReply;
  workspace: string;
}): Result<string | null, BrowserActionError> {
  if (admitted.snapshotYaml !== null) {
    return ok(admitted.snapshotYaml);
  }
  if (admitted.snapshotPath === null) {
    return ok(null);
  }
  try {
    return ok(readFileSync(join(workspace, admitted.snapshotPath), "utf8"));
  } catch (error: unknown) {
    return err(
      BrowserActionErrors.clientFailed({
        detail: `the page's snapshot was filed at ${admitted.snapshotPath} and could not be read back: ${String(error)}`,
      }),
    );
  }
}
