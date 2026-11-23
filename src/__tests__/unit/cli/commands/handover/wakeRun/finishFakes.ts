/*
 * The finish half of `./harness.ts`'s `fakes`: the merge proof, the probe tree, the boots in flight, and a `handover
 * finish` child that answers off per-case tables — the finish pass's ask, and the question pass's readiness ask.
 */
import { err, ok, unwrap } from "#lib/result.js";

import type { MergeProof } from "../../../../../../cli/commands/handover/wakeMergeProof.js";
import type { HandoverWakeDeps } from "../../../../../../cli/commands/handover/wakeRows.js";
import type { BoundedChildWithStderr } from "../../../../../../cli/commands/supervisor/scratchChild.js";
import type { ProbeCheckout } from "../../../../../../handover/probeCheckout.js";
import { appendRunEvent } from "../../../../../../handover/runStore.js";
import type { ChildOutcome } from "../../../../../../supervisor/scratch/childOutcome.js";
import { AFTER, type Recorded } from "./fixtures.js";

/**
 * A finish child that exited `code`, having printed `stderr` — nothing, unless a case names a refusal.
 *
 * @param stderrBytes the bytes the child wrote in all, when a case keeps only a prefix of them
 * @returns the child as `HandoverWakeDeps.finish` answers it
 */
export function childExit({
  code,
  stderr = "",
  stderrBytes = Buffer.byteLength(stderr, "utf8"),
}: {
  code: number;
  stderr?: string;
  stderrBytes?: number;
}): BoundedChildWithStderr {
  const kept = Buffer.byteLength(stderr, "utf8");
  const outcome: ChildOutcome = { durationMs: 10, exitCode: code, kind: "exited" };
  return { outcome, stderr, stderrBytes, stderrKeptBytes: kept, stderrTruncated: kept < stderrBytes };
}

/**
 * A `handover finish` that exits as `finishes` says per slug — exit 1, a gate refusing, for any slug the table does
 * not name — and on a real exit 0 journals the `finished` the verb would. The question pass's `--dry-run
 * --beside-question` readiness ask answers off `readies` instead — exit 0, nothing else left, for any slug it does
 * not name — and is recorded only in `recorded.readied`.
 *
 * @param runsDir the case's run-journal directory, where a real exit 0 journals its `finished`
 * @returns the four finish seams
 */
export function finishFakes({
  bootsInFlight,
  finishes,
  mergeHeld,
  probeTree,
  readies,
  recorded,
  runsDir,
}: {
  bootsInFlight: number;
  finishes: Readonly<Record<string, number>>;
  mergeHeld: MergeProof | "unreadable";
  probeTree: ProbeCheckout["kind"];
  readies: Readonly<Record<string, number>>;
  recorded: Recorded;
  runsDir: string;
}): Pick<HandoverWakeDeps, "bootsInFlight" | "finish" | "mergeProof" | "probeTreeOf"> {
  return {
    bootsInFlight: () => bootsInFlight,
    probeTreeOf: () => probeTree,
    mergeProof: ({ dir, oid }) => {
      recorded.mergeChecks.push(`${dir}@${oid}`);
      return mergeHeld === "unreadable" ? err({ message: "fatal: not a git repository" }) : ok(mergeHeld);
    },
    finish: async ({
      allowNoLessons,
      besideQuestion,
      cwd,
      dryRun,
      parkIndex,
      parkedAtIso,
      probedRepo,
      probedTree,
      slug,
    }) => {
      if (besideQuestion) {
        recorded.readied.push(`${slug}${dryRun ? " --dry-run" : ""} ${String(allowNoLessons)}`);
        const ready = readies[slug];
        if (ready === undefined) {
          return childExit({ code: 0 });
        }
        return childExit({ code: ready, stderr: "a probe unmet" });
      }
      recorded.finishLessons.push(`${slug} ${String(allowNoLessons)}`);
      recorded.finishRepos.push(`${probedRepo} ${probedTree}`);
      recorded.finished.push(dryRun ? `${slug} --dry-run` : slug);
      recorded.finishCwds.push(cwd);
      recorded.finishParks.push(`${String(parkIndex)}@${parkedAtIso}`);
      let code = 1;
      const listed = finishes[slug];
      if (listed !== undefined) {
        code = listed;
      }
      if (code === 0 && !dryRun) {
        unwrap(appendRunEvent({ event: { atIso: AFTER, kind: "finished", residue: [] }, runsDir, slug }));
      }
      return childExit({ code });
    },
  };
}
