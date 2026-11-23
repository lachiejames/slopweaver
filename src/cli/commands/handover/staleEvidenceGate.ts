/**
 * REFUSE a finding row whose own evidence paths have already moved upstream.
 *
 * ## The domino this stops
 *
 * `../../../cli/staleSeat.ts` carries the measurement: a seat 258 commits behind read three registers
 * through its own months-old code and reported three defects that had all been fixed days earlier. The
 * advisory that module prints is the visible half. This is the BLOCKING half, and it is placed at the one
 * door where a false diagnosis stopped being one session's mistake and became fleet work — three board rows,
 * a p0 relay to the pinned chair, a chair seat nearly spent, two repair acts on live state that needed no
 * repair, and a page published to the owner asserting all of it.
 *
 * A row whose own evidence is `bin/slopweaver`, `src/live/automation/definitionStore.ts` and
 * `state:ledgers/autonomy.jsonl` is the shape: if `definitionStore.ts` has moved upstream, this gate fires on that
 * row and the whole cascade stops at the first domino.
 *
 * ## Why the criterion is the EVIDENCE and not the seat's distance
 *
 * A seat may be far behind and still observe a true defect in a file nobody has touched. Distance is not the
 * question; whether *the thing being diagnosed* has been rewritten under the diagnostician is. So this gate
 * asks exactly that and nothing wider, which is also why it can be a refusal at all rather than the
 * advisory its sibling has to be.
 *
 * Non-code evidence is outside the criterion by CONSTRUCTION rather than by an exclusion list:
 * {@link codeEvidencePaths} keeps only what reads as a repo-relative source path, so a `state:` prefix, a
 * pull request reference and a permalink are all simply not paths and are never mentioned in the refusal.
 *
 * Pure: the changed paths a caller could only get by running git are passed in already-read.
 */
import { measureSeatDrift } from "../../../cli/staleSeatEffects.js";
import { pathsOverlap } from "../../../cmux/baseFreshness.js";
import { codeEvidencePaths } from "../../../handover/evidenceRefs.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";

/**
 * Which of a finding's evidence paths the upstream has already changed.
 *
 * @param evidence the row's raw `--evidence` items
 * @param changedPaths the paths the commits this seat lacks changed
 * @returns the superseded evidence paths, empty when the finding's subjects are all current here
 */
export function supersededEvidence({
  evidence,
  changedPaths,
}: {
  evidence: readonly string[];
  changedPaths: readonly string[];
}): readonly string[] {
  const paths = codeEvidencePaths({ evidence });
  return paths.filter((path) => changedPaths.some((changed) => pathsOverlap({ changed, docPath: path })));
}

/**
 * The one clause a refusal carries about this particular row — what moved, and how far behind the seat is.
 *
 * @param superseded the evidence paths the upstream already changed
 * @param behind commits the trunk carries that this seat does not
 * @param upstreamRef the trunk ref the seat was compared against
 * @returns the detail clause for `hatchRefusal`
 */
export function staleEvidenceDetail({
  superseded,
  behind,
  upstreamRef,
}: {
  superseded: readonly string[];
  behind: number;
  upstreamRef: string;
}): string {
  return (
    `this seat is ${String(behind)} commit(s) behind ${upstreamRef}, which changed ${superseded.join(", ")} — ` +
    `confirm the defect against ${upstreamRef} before registering it`
  );
}

/* The effectful shell. It lives beside the pure predicates above because it is what READS the hatch key,
   and `src/devLint/escapeHatch.ts` checks the register's `reader` against the module that does. */

/**
 * Whether `handover register --finding` must refuse this row, printing why.
 *
 * Fails OPEN on anything unmeasurable — no trunk, no git, an unreadable diff — because a gate that cannot
 * see its subject has nothing to say about it, and four lines claiming a rule caught something it never
 * read is the shape `.claude/rules/error-handling.md` calls a fact dressed as a refusal.
 *
 * @param evidence the row's raw `--evidence` items
 * @param env the environment to read the hatch key from
 * @param out where to print each refusal line
 * @returns `true` when the caller must refuse, `false` when it may write the row
 */
export function staleEvidenceGateRefused({
  evidence,
  env,
  out,
}: {
  evidence: readonly string[];
  env: NodeJS.ProcessEnv;
  out: (args: { line: string }) => void;
}): boolean {
  const hatch = hatchFor({ id: "stale-seat-finding" });
  const paths = codeEvidencePaths({ evidence });
  if (paths.length === 0) {
    return false;
  }
  const drift = measureSeatDrift({ pathspecs: paths });
  if (drift === undefined || drift.behind === 0) {
    return false;
  }
  const superseded = supersededEvidence({ changedPaths: drift.changedPaths, evidence });
  if (superseded.length === 0) {
    return false;
  }
  // Spelled as the LITERAL variable rather than through `hatchEnvVar`, because `src/devLint/escapeHatch.ts`
  // checks the register's `reader` by looking for this exact string in this exact file — a key assembled from
  // a suffix is invisible to it, and a row whose reader cannot be found is the shape that gate exists to catch.
  const open = env["SLOPWEAVER_ALLOW_STALE_SEAT_FINDING"];
  if (open !== undefined && open.length > 0) {
    out({
      line: `stale-seat-finding: override in force — registering a finding about ${superseded.join(", ")}, which ${drift.upstreamRef} has already changed`,
    });
    return false;
  }
  for (const line of hatchRefusalLines({
    detail: staleEvidenceDetail({ behind: drift.behind, superseded, upstreamRef: drift.upstreamRef }),
    hatch,
  })) {
    out({ line });
  }
  return true;
}
