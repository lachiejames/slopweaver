/**
 * The dispatch register, folded into the three numbers `machine capacity --json` publishes and
 * `../../supervisor/loadDispatchGate.ts` judges a tick against.
 *
 * Its own module rather than a helper inside the capacity verb because TWO shells need exactly this fold —
 * `machine capacity` publishes it, `machine watch` decides against it — and two copies of a fold over the
 * same register is how two readers of one file end up disagreeing about what it says.
 *
 * ## Two counts, because an open row is not an investigation
 *
 * `open` is the truth about the register and is what a reader settles. `covering` is the subset that
 * seated a visible session, and it is the only one the gate may treat as an answer — a backed-off or
 * failed seat leaves an alert standing, so counting it as coverage silenced the gate on exactly the
 * reading that most needed it (review pass r2 `gate-cannot-be-satisfied-by-assertion`).
 *
 * A register that cannot be read reports **zero open and no backoff**, and that is a deliberate direction
 * rather than an oversight: an unreadable register means the gate refuses the next tick (nothing is covering
 * the hold) and the watcher is free to seat an investigation. Both are the safe way to be wrong. The
 * opposite default — inventing an open row nobody can see — would silence the gate on exactly the reading
 * that most needs it.
 */
import { backoffFor } from "./backoff.js";
import { type DispatchBlock, type DispatchInvestigation, INVESTIGATIONS_SHOWN } from "./capacityRender.js";
import type { DispatchRow } from "./dispatchRow.js";
import { coveringDispatches, openDispatches, readDispatchRows, rowsForSignature } from "./dispatchStore.js";

/** What an unreadable or empty register reports. See this module's header for why the zeros lean this way. */
const NOTHING_OPEN: DispatchBlock = {
  backoffSeconds: 0,
  covering: 0,
  investigations: [],
  investigationsOmitted: 0,
  open: 0,
  subject: "",
};

/**
 * The covering rows as the capacity document carries them: newest first, bounded, each with its board row.
 *
 * @param covering the open rows that seated a visible session, newest first
 * @returns the shown rows and how many were left out
 */
function investigationsOf({ covering }: { covering: readonly DispatchRow[] }): {
  readonly investigations: readonly DispatchInvestigation[];
  readonly investigationsOmitted: number;
} {
  const investigations = covering.slice(0, INVESTIGATIONS_SHOWN).flatMap((row): DispatchInvestigation[] => {
    if (row.seated.kind !== "seated") {
      return [];
    }
    return [
      {
        id: row.id,
        observedIso: row.observedIso,
        slug: row.seated.slug,
        subject: { label: row.subject.label, why: row.subject.why },
        triggers: row.triggers,
      },
    ];
  });
  return { investigations, investigationsOmitted: Math.max(0, covering.length - INVESTIGATIONS_SHOWN) };
}

/**
 * Fold the register into the block a capacity document carries.
 *
 * @param home the Slopweaver home the register lives under
 * @param nowIso the instant the backoff window is measured against
 * @returns the open and covering counts, the newest open subject, and the seconds until that signature may
 *   be re-seated
 */
export function dispatchBlockFor({ home, nowIso }: { home: string; nowIso: string }): DispatchBlock {
  const rows = readDispatchRows({ home });
  if (rows.isErr()) {
    return NOTHING_OPEN;
  }
  const open = openDispatches({ rows: rows.value });
  const newest = open[0];
  if (newest === undefined) {
    return NOTHING_OPEN;
  }
  const backoff = backoffFor({ nowIso, rows: rowsForSignature({ rows: rows.value, signature: newest.signature }) });
  let backoffSeconds = 0;
  if (!backoff.maySeat && backoff.nextSeatIso !== undefined) {
    const remainingMs = Date.parse(backoff.nextSeatIso) - Date.parse(nowIso);
    if (Number.isFinite(remainingMs) && remainingMs > 0) {
      backoffSeconds = Math.round(remainingMs / 1000);
    }
  }
  const covering = coveringDispatches({ rows: rows.value });
  return {
    backoffSeconds,
    covering: covering.length,
    ...investigationsOf({ covering }),
    open: open.length,
    subject: newest.subject.label,
  };
}
