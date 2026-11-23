/**
 * The freshness section: every atlas and every corpus source, with its last generation, its cadence and
 * whether it is late — projected into the briefing's fold.
 *
 * It sits beside the schedule itself, for this reason: a card must never ask the owner whether a source needs
 * a resync, because the page already says. A schedule that runs and a page that says whether it is keeping up are
 * two halves of one thing — with only the first, the failure this ends (36 of 36 atlases behind and nothing
 * saying so) is invisible again the moment a target starts failing quietly.
 *
 * ## Four states that look alike and are not
 *
 * Keeping them apart is what stops the section reassuring the owner falsely. A target can be:
 *
 * - **late** — behind its own declared window, whatever else is true;
 * - **failing** — its last attempt ran and did not work, which the run stamp alone cannot show;
 * - **blocked** — it cannot succeed unattended until a human does something, and the steps are recorded;
 * - **unscheduled** — this build derives a policy for it and no ENABLED row is registered, so nothing will
 *   ever run it;
 * - **paused** — a row exists and somebody disabled it, which is deliberate rather than an oversight.
 *
 * The fourth is the one this page is really for. An atlas can be perfectly fresh today and have no row
 * at all, and a page reporting only staleness would call it healthy right up to the moment it went stale
 * for good.
 *
 * ## A corpus source's clock is the STORE's newest row for it, and that is a limit worth stating
 *
 * Its LATENESS comes from when the resync last succeeded, never from the clock: the clock is `max(occurred_at)`
 * over that source's rows in the Supabase store (`store/newest.ts`, read once for every source per render),
 * so a quiet source reads as ancient however well its last fetch went (`live/resync/outcome.ts`). The clock
 * is still shown beside it, because it is the only view a reader gets of how far behind the DATA a query
 * can reach actually is. It used to be the bronze WATERMARK, and that read "fresh" about a store nobody had
 * touched: measured, `resync-corpus-linear` recorded a fresh success off the watermark while the store's
 * newest linear row stayed about ten hours older. The resync step now carries `--store`, so a zero exit means the window
 * file reached the store.
 *
 * **What these inputs cannot separate: a quiet source from a frozen one.** Measured, and found by a dogfood
 * turn rather than by any sweep — Slack's cursor sat about 46 hours behind a record in bronze written that
 * same afternoon, so ingest was landing records and not advancing the cursor. A refresh over that source would still exit 0, so this page would call it
 * current. Both readings look identical from here: no new records, or new records not banked. The
 * `--store` line a refresh prints (`--store: <source>: N row(s) stored`) is the receipt that separates them
 * for one run, and it lives in that run's output rather than in any input this page reads; no threshold on
 * clock age can tell the two apart from here — measured on the same store, the six fetchable cursors ranged from
 * ten hours to five years behind, so any bound that caught Slack would have condemned four healthy sources.
 *
 * Pure: values in, one section out. No clock, no filesystem.
 */
import { absentAsNull } from "#lib/absent.js";
import { renderAge } from "../lib/duration.js";
import type { ResyncState, ResyncStateReadError } from "../live/resync/outcome.js";
import type { ResyncPolicy } from "../live/resync/policy.js";
import { type ResyncTarget, resyncTargetLabel } from "../live/resync/target.js";
import type { BriefingBlock, BriefingNote, BriefingSection } from "../outbound/briefing/types.js";

/**
 * The freshness section's own id, so an anchor can send a card to it.
 *
 * @internal — the value is declared for real in `../outbound/briefing/types.ts` as `FRESHNESS_SECTION_ID`,
 * which is what the schema and the renderer read; this is the projection's own name for the same string.
 */
export const FRESHNESS_ID = "freshness";

/** What one target's row says, before it becomes prose. */
export interface FreshnessRow {
  readonly recipeId: string;
  /** What the row is about, so a second presentation (`./sourceFreshness.ts`) never re-parses the id. */
  readonly target: ResyncTarget;
  readonly label: string;
  readonly cadence: string;
  /** The target's own declared window, the one `late` was judged against. */
  readonly windowMs: number;
  /** The last recorded attempt, whatever it was — `null` when none is recorded. */
  readonly lastAttempt: {
    readonly finishedAtIso: string;
    readonly outcome: "succeeded" | "failed";
    readonly problems: readonly string[];
  } | null;
  /** The target's own clock — an atlas generation, or a corpus source's newest STORED row. `null` when it has never published. */
  readonly clock: string | null;
  /** When this target last actually WORKED, rather than last fired. */
  readonly lastSuccessAtIso: string | null;
  /** True when the clock is older than the target's own declared window. */
  readonly late: boolean;
  /** True when this build derives a policy for the target and no ENABLED row is registered for it. */
  readonly unscheduled: boolean;
  /** True when a row exists and somebody disabled it, so nothing will run it until they undo that. */
  readonly paused: boolean;
  /** True when the last recorded attempt failed. */
  readonly failing: boolean;
  /**
   * Why this target's stored record cannot be trusted, when it is there but corrupt. Such a row claims no
   * success and no failure: read as absent, a target working for months read as never having succeeded.
   */
  readonly recordUnreadable: string | null;
  /**
   * The cadence the STORED row carries, when one is stored and differs from what this build derives.
   *
   * A page printing the derived cadence beside a row that carries another one reports the schedule this
   * build WANTS as though it were the schedule in force — seen on a row
   * whose stored cadence was unschedulable while the page showed a working four-hourly one.
   */
  readonly storedCadence: string | null;
  /**
   * True when this row's own clock is older than its declared window while nothing else marks it — the
   * state in which "current" rests on the resync's exit code alone and cannot be checked from here.
   */
  readonly unverified: boolean;
  /** What a human must do before this can ever succeed unattended, when something must. */
  readonly blocker: { readonly reason: string; readonly steps: readonly string[] } | null;
}

/** Everything one projection decided. */
export interface FreshnessProjection {
  readonly rows: readonly FreshnessRow[];
  readonly section: BriefingSection;
}

/** What one target contributes that only a caller reading a home can know. */
export interface FreshnessObservation {
  readonly recipeId: string;
  readonly clock: string | null;
  /** Whether the target is past its own window, as its own judge decided. */
  readonly late: boolean;
  /**
   * Whether this target's CLOCK lags its own window, which for a corpus source is not the same question as
   * lateness — see this module's header on why a quiet source and a frozen one look alike from here.
   */
  readonly clockLagsWindow?: boolean;
  /** The cadence the stored row carries, when it differs from the derived one. */
  readonly storedCadence?: string;
}

/**
 * Build the section.
 *
 * @param policies every target this build schedules
 * @param registered the recipe ids the definition store holds ENABLED — a disabled row is not one
 * @param paused the recipe ids the store holds DISABLED, which nothing will run until somebody re-enables
 * @param observations each target's clock and lateness, from its own judge
 * @param states what each target's last attempt recorded
 * @param unreadable every stored record, or the directory holding them, that is there but cannot be read
 * @param nowIso the instant ages are measured against
 * @returns the rows and the collapsed section they render as
 */
export function projectFreshness({
  policies,
  registered,
  paused,
  observations,
  states,
  unreadable,
  nowIso,
}: {
  readonly policies: readonly ResyncPolicy[];
  readonly registered: readonly string[];
  readonly paused: readonly string[];
  readonly observations: readonly FreshnessObservation[];
  readonly states: ReadonlyMap<string, ResyncState>;
  readonly unreadable: readonly ResyncStateReadError[];
  readonly nowIso: string;
}): FreshnessProjection {
  const seen = new Map(observations.map((observation) => [observation.recipeId, observation]));
  const rows = policies.map((policy): FreshnessRow => {
    const observation = seen.get(policy.recipeId);
    const state = states.get(policy.recipeId);
    return {
      blocker: state?.blocker == null ? null : { reason: state.blocker.reason, steps: state.blocker.steps },
      cadence: policy.cadence,
      lastAttempt: attemptOf({ state }),
      clock: absentAsNull({ value: observation?.clock }),
      failing: state?.lastAttempt?.outcome === "failed",
      label: resyncTargetLabel({ target: policy.target }),
      lastSuccessAtIso: state === undefined ? null : state.lastSuccessAtIso,
      late: observation?.late !== false,
      paused: paused.includes(policy.recipeId),
      recipeId: policy.recipeId,
      recordUnreadable: unreadableRecord({ recipeId: policy.recipeId, unreadable }),
      storedCadence: absentAsNull({ value: observation?.storedCadence }),
      target: policy.target,
      unverified: observation?.clockLagsWindow === true,
      unscheduled: !registered.includes(policy.recipeId) && !paused.includes(policy.recipeId),
      windowMs: policy.windowMs,
    };
  });
  return { rows, section: freshnessSection({ nowIso, rows }) };
}

/** The last recorded attempt as a row carries it, or `null` when the target has none on record. */
function attemptOf({ state }: { readonly state: ResyncState | undefined }): FreshnessRow["lastAttempt"] {
  const attempt = state?.lastAttempt;
  if (attempt == null) {
    return null;
  }
  return { finishedAtIso: attempt.finishedAtIso, outcome: attempt.outcome, problems: attempt.problems };
}

/** Why one target's stored record cannot be read, or `null` when nothing says so. */
function unreadableRecord({
  recipeId,
  unreadable,
}: {
  readonly recipeId: string;
  readonly unreadable: readonly ResyncStateReadError[];
}): string | null {
  const hit = unreadable.find((error) => error.code === "RESYNC_STATE_DIR_UNREADABLE" || error.recipeId === recipeId);
  return hit === undefined ? null : hit.message;
}

/** The counts the summary line carries, so the one sentence above the fold is derived and never authored. */
function tally({ rows }: { readonly rows: readonly FreshnessRow[] }): {
  readonly late: number;
  readonly blocked: number;
  readonly failing: number;
  readonly unscheduled: number;
  readonly paused: number;
  readonly unverified: number;
  readonly unreadable: number;
} {
  return {
    blocked: rows.filter((row) => row.blocker !== null).length,
    failing: rows.filter((row) => row.failing).length,
    late: rows.filter((row) => row.late).length,
    paused: rows.filter((row) => row.paused).length,
    unreadable: rows.filter((row) => row.recordUnreadable !== null).length,
    unscheduled: rows.filter((row) => row.unscheduled).length,
    unverified: rows.filter((row) => unverifiedCurrent({ row })).length,
  };
}

/**
 * Whether a row reads current on nothing better than its resync's exit code.
 *
 * Only a row with NO other mark qualifies: one already reading late, failing, blocked, paused or
 * unscheduled is telling the reader something, and stacking "unverified" on it adds noise rather than
 * doubt. This is the reassuring row whose reassurance is not checkable.
 */
function unverifiedCurrent({ row }: { readonly row: FreshnessRow }): boolean {
  const marked =
    row.late || row.failing || row.paused || row.unscheduled || row.blocker !== null || row.recordUnreadable !== null;
  return row.unverified && !marked;
}

/**
 * The one sentence a reader sees before opening anything.
 *
 * Derived from the rows rather than written, because a summary a composer could type is a summary free to
 * disagree with the table under it — and this section exists precisely because a number nobody was checking
 * went wrong.
 *
 * @param rows every target's row
 * @returns the summary line
 */
export function freshnessSummary({ rows }: { readonly rows: readonly FreshnessRow[] }): string {
  const counts = tally({ rows });
  // TARGETS, never "scheduled". A Codex pass caught the first cut calling `rows.length` the scheduled
  // count, so a roster of one paused target read "1 scheduled · 1 paused" — a sentence contradicting
  // itself, on the one line whose whole job is being true at a glance. This is what the build DERIVES; the
  // marks after it say how many of those are actually running.
  const parts = [
    `${String(rows.length)} targets`,
    `${String(counts.late)} late`,
    ...(counts.failing > 0 ? [`${String(counts.failing)} failing`] : []),
    ...(counts.unreadable > 0 ? [`${String(counts.unreadable)} RECORD UNREADABLE`] : []),
    ...(counts.blocked > 0 ? [`${String(counts.blocked)} blocked on you`] : []),
    ...(counts.paused > 0 ? [`${String(counts.paused)} paused`] : []),
    ...(counts.unverified > 0 ? [`${String(counts.unverified)} unverified`] : []),
    ...(counts.unscheduled > 0 ? [`${String(counts.unscheduled)} UNSCHEDULED`] : []),
  ];
  return `Atlas and corpus freshness — ${parts.join(" · ")}`;
}

/**
 * How long ago one instant was, in the page's own vocabulary.
 *
 * An instant that will not parse reads as unknown rather than as a number: a section whose whole job is
 * saying how stale things are must never invent an age from a clock it could not read.
 */
function ageSince({ fromIso, nowIso }: { readonly fromIso: string; readonly nowIso: string }): string {
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(from) || Number.isNaN(now)) {
    return "an unreadable time";
  }
  return renderAge({ ms: Math.max(0, now - from) });
}

/** When a row last worked, in the page's words — never "no recorded success" for a record nobody could read. */
function successText({ row, nowIso }: { readonly row: FreshnessRow; readonly nowIso: string }): string {
  if (row.recordUnreadable !== null) {
    return `last success unknown: ${row.recordUnreadable}`;
  }
  if (row.lastSuccessAtIso === null) {
    return "no recorded success";
  }
  return `last worked ${ageSince({ fromIso: row.lastSuccessAtIso, nowIso })} ago`;
}

/** One target's line inside the fold. */
function rowLine({ row, nowIso }: { readonly row: FreshnessRow; readonly nowIso: string }): string {
  // "newest record" for a corpus source, "generated" for an atlas — the two clocks are different animals
  // and one word for both is how a reader mistakes a stalled cursor for a stale generation.
  const clockWord = row.recipeId.startsWith("resync-corpus-") ? "newest record" : "generated";
  const age =
    row.clock === null ? `${clockWord}: none` : `${clockWord} ${ageSince({ fromIso: row.clock, nowIso })} old`;
  const success = successText({ nowIso, row });
  const marks = [
    ...(row.unscheduled ? ["UNSCHEDULED"] : []),
    ...(row.paused ? ["paused"] : []),
    ...(row.blocker === null ? [] : ["BLOCKED"]),
    ...(row.recordUnreadable === null ? [] : ["RECORD UNREADABLE"]),
    ...(row.failing ? ["failing"] : []),
    ...(row.late ? ["late"] : []),
  ];
  // "current, unverified" rather than a bare "current": the row's own clock lags its window, so the only
  // thing saying it is fine is the resync's exit code. Naming that on the LINE rather than in this file's
  // header is the whole point: a caveat that lives only in source is one the person reading the
  // page never sees.
  const state = marks.length === 0 ? currentState({ row }) : marks.join(", ");
  // The STORED cadence wins wherever the two differ: what is in force is what a reader needs, and printing
  // the derived one beside a drifted row reports an intention as a fact.
  const cadence =
    row.storedCadence === null || row.storedCadence === row.cadence
      ? row.cadence
      : `${row.storedCadence} — STORED, where the roster derives ${row.cadence}`;
  return `${row.label} — ${state}; ${age}; ${success}; cadence ${cadence}`;
}

/** How an otherwise-unmarked row describes itself. */
function currentState({ row }: { readonly row: FreshnessRow }): string {
  return unverifiedCurrent({ row }) ? "current, unverified" : "current";
}

/** The blocked rows, each with the exact steps that clear it, as their own nested list. */
function blockerBlocks({ rows }: { readonly rows: readonly FreshnessRow[] }): readonly BriefingBlock[] {
  const blocked = rows.filter((row) => row.blocker !== null);
  if (blocked.length === 0) {
    return [];
  }
  return blocked.map((row): BriefingBlock => {
    // Safe: the filter above kept only rows carrying a blocker.
    const blocker = row.blocker!;
    return {
      items: blocker.steps.map((step) => [{ kind: "text" as const, text: step }]),
      kind: "list" as const,
      ordered: true,
    };
  });
}

/**
 * The note explaining why a row can read `current` and still be unverified, when any row is.
 *
 * On the PAGE rather than in this file's header, because a frozen source reads a plain "current" to the only
 * person who matters — the one reading the page, who never opens the source.
 *
 * @param rows every target's row
 * @returns the note, or nothing when no row rests on its exit code alone
 */
function unverifiedNote({ rows }: { readonly rows: readonly FreshnessRow[] }): readonly BriefingNote[] {
  const count = tally({ rows }).unverified;
  if (count === 0) {
    return [];
  }
  const lines = [
    "A corpus source's clock is the newest row the store holds for it, so a source with nothing new to fetch " +
      "and one whose ingest has stalled look identical from here.",
    "Measured: Slack's cursor sat about 46 hours behind a record in bronze written that afternoon, and a " +
      "refresh over it still exited 0.",
    "No clock-age threshold separates them: the six fetchable cursors ranged from ten hours to five years " +
      "behind, so any bound catching Slack condemns four healthy sources. The `--store: <source>: N row(s) " +
      "stored` line in the resync's own output is the receipt that does, for that run.",
  ];
  return [
    {
      detail: {
        blocks: [
          {
            items: lines.map((text) => [{ kind: "text" as const, text }]),
            kind: "list" as const,
            ordered: false,
          },
        ],
        summary: "Why a row can read current and still be unverified",
      },
      headline: [
        { kind: "text" as const, text: `${String(count)} row(s) read current on their resync's exit code alone` },
      ],
    },
  ];
}

/** The section itself: one summary a reader sees, everything else behind it. */
function freshnessSection({
  rows,
  nowIso,
}: {
  readonly rows: readonly FreshnessRow[];
  readonly nowIso: string;
}): BriefingSection {
  const blocked = rows.filter((row) => row.blocker !== null);
  return {
    id: FRESHNESS_ID,
    notes: [
      {
        detail: {
          blocks: [
            {
              items: rows.map((row) => [{ kind: "text" as const, text: rowLine({ nowIso, row }) }]),
              kind: "list" as const,
              ordered: false,
            },
          ],
          summary: `Every atlas and corpus source, with its cadence — ${String(rows.length)} target(s)`,
        },
        // The note's headline is NOT the section's summary. A `<details>` already renders its summary, so
        // repeating it inside prints the same sentence twice to a reader who opened the section.
        headline: [
          {
            kind: "text" as const,
            text: `Every target this build derives, with its cadence — ${String(rows.length)} in all`,
          },
        ],
      },
      ...unverifiedNote({ rows }),
      ...(blocked.length === 0
        ? []
        : [
            {
              detail: {
                blocks: blockerBlocks({ rows }),
                summary: `${String(blocked.length)} target(s) cannot resync unattended — the exact steps`,
              },
              headline: [
                {
                  kind: "text" as const,
                  text: `${String(blocked.length)} target(s) need something only you can do`,
                },
              ],
            },
          ]),
    ],
    summary: freshnessSummary({ rows }),
  };
}
