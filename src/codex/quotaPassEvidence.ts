/**
 * What Slopweaver's OWN newest pass record says about the transport — the third source `codex quota show` reads.
 *
 * The other two cannot see the case that motivated this. `quotaCache.ts` is written only by `cmux spawn`'s
 * post-boot banner check, and `quotaLog.ts` reads Codex's rollout log, which a pass refused before its session
 * started never writes. Measured: passes failing before their session started left no rollout file (reproduce:
 * `ls "${CODEX_HOME:-$HOME/.codex}/sessions/$(date +%Y/%m/%d)" | head -1` on the day of such a failure names a
 * rollout started after it), so the one record of the spend
 * cap on this machine was the pass record — which then said only `the Codex transport failed`.
 *
 * REPORTED, NOT DECIDED. `codex quota show`'s `decision` is documented as the one `cmux spawn` would make, and
 * spawn does not read pass records, so this never feeds it: a pass record cannot be removed by
 * `codex quota clear`, and a refusal whose own recovery hint does not clear it is a wedge. A newer pass that
 * answered supersedes an older exhaustion here only in the sense that it becomes the newest pass — it does not
 * prove the quota recovered, and the line says which pass it read so a reader can judge that.
 *
 * Pure: records in, a report out.
 */

import type { CodexQuotaKind } from "./quotaTypes.js";
import { formatTransportCause, transportFaultQuota } from "./transportCause.js";
import type { CodexArtifactRecord, CodexPassId } from "./types.js";

/** The newest pass that reached the transport, and what it said. */
export interface NewestPassReport {
  readonly artifactId: string;
  readonly pass: CodexPassId;
  readonly createdAtIso: string;
  /** `answered`, `no-verdict` or `fatal` — the outcome kind, so a reader sees whether the model was reached. */
  readonly outcome: CodexArtifactRecord["outcome"]["kind"];
  /** The exhaustion a fatal's recorded cause names, or null — including for every non-fatal pass. */
  readonly quota: CodexQuotaKind | null;
  /** A fatal's cause as one bounded line, or null for a pass that did not fail outright. */
  readonly cause: string | null;
}

/**
 * The newest pass that actually made a transport attempt.
 *
 * A record with no attempts never reached the transport — the scratch workspace could not be created — so it
 * says nothing about quota and is skipped. Ties on the creation instant break on artifact id, so the answer does
 * not depend on the order a directory scan happened to yield.
 *
 * @param records every pass record the scan could parse, in any order
 * @returns the report, or undefined when no record made a transport attempt
 */
export function newestPassReport({
  records,
}: {
  records: readonly CodexArtifactRecord[];
}): NewestPassReport | undefined {
  const attempted = records.filter((record) => Array.isArray(record.attempts) && record.attempts.length > 0);
  const [newest] = attempted.toSorted(
    (a, b) => b.createdAtIso.localeCompare(a.createdAtIso) || b.artifactId.localeCompare(a.artifactId),
  );
  if (newest === undefined) {
    return undefined;
  }
  const { outcome } = newest;
  if (outcome.kind !== "fatal") {
    return { ...identity({ record: newest }), cause: null, outcome: outcome.kind, quota: null };
  }
  return {
    ...identity({ record: newest }),
    cause: formatTransportCause({ cause: outcome.cause }),
    outcome: outcome.kind,
    quota: transportFaultQuota({ cause: outcome.cause }),
  };
}

/** Which pass a report is about. */
function identity({
  record,
}: {
  record: CodexArtifactRecord;
}): Pick<NewestPassReport, "artifactId" | "createdAtIso" | "pass"> {
  return { artifactId: record.artifactId, createdAtIso: record.createdAtIso, pass: record.scope.pass };
}
