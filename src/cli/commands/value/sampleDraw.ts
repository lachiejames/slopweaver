/**
 * The week's value sample, read back when it was kept or drawn and kept now: the half of `value sample` that decides
 * WHAT the owner is asked about, apart from the page and card that ask it (`./sample.ts`).
 *
 * A first draw reads the board's rows, draws from the asks that ended, joins each one's cost through the seat that
 * ran it and reads each pull request's state, then keeps the result with {@link createSample}'s exclusive create.
 * An overlapping run that kept the week's sample first wins, and its sample, answers and all, is the one returned.
 *
 * Effectful edge over injected seams; the draw and the cost join are pure, under `../../../value/sample.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";
import { parsePullRequestUrl } from "../../../goldDebt/pull.js";
import type { FetchPrClosure } from "../../../live/github/prClosure.js";
import { type Measured, unmeasurable } from "../../../measurement/status.js";
import type { TranscriptSpend } from "../../../sessions/spendFold.js";
import { ValueErrors } from "../../../value/errors.js";
import {
  type AskSpend,
  askCostOf,
  type BoardAskRow,
  drawSample,
  type PrOutcome,
  type SeatSpawn,
  type SettledAsk,
  settledAsksOf,
} from "../../../value/sample.js";
import { createSample, readSample, type ValueSample } from "../../../value/store.js";

/** How far back the transcript walk reaches: two windows, so a seat that began before its ask's week still counts. */
const TRANSCRIPT_LOOKBACK_DAYS = 14;

/** Milliseconds in a day. */
const DAY_MS = 86_400_000;

/** What a first draw reads outside itself, injected so a test drives it over a throwaway home. */
export interface SampleDrawDeps {
  readonly readRows: (args: { home: string }) => Result<readonly BoardAskRow[]>;
  readonly readSpawns: (args: { home: string }) => Result<readonly SeatSpawn[]>;
  readonly readTranscripts: (args: { home: string; sinceMs: number }) => Result<readonly TranscriptSpend[]>;
  readonly fetchPr: FetchPrClosure;
}

/** The week's sample and whether an earlier run kept it. */
interface WeekSample {
  readonly sample: ValueSample;
  readonly kept: boolean;
}

/** One pull request's outcome, read through the closure seam; a URL that is not a pull request is unread. */
async function prOutcomeOf({ fetchPr, url }: { fetchPr: FetchPrClosure; url: string }): Promise<PrOutcome> {
  const ref = parsePullRequestUrl({ url });
  if (ref === undefined) {
    return { state: "UNREAD", url };
  }
  const read = await fetchPr(ref);
  if (read.isErr()) {
    return { state: "UNREAD", url };
  }
  return { state: read.value.state, url };
}

/** Each drawn ask's cost, or the one reason none could be measured when the transcripts would not read. */
function costsOf({
  asks,
  spawns,
  transcripts,
}: {
  asks: readonly SettledAsk[];
  spawns: Result<readonly SeatSpawn[]>;
  transcripts: Result<readonly TranscriptSpend[]>;
}): readonly Measured<AskSpend>[] {
  if (spawns.isErr()) {
    const why = `the session ledger would not read: ${spawns.error.join("; ")}`;
    return asks.map(() => unmeasurable({ why }));
  }
  if (transcripts.isErr()) {
    const why = `the transcripts would not read: ${transcripts.error.join("; ")}`;
    return asks.map(() => unmeasurable({ why }));
  }
  return asks.map((ask) => askCostOf({ ask, spawns: spawns.value, transcripts: transcripts.value }));
}

/** Draw a fresh sample for the week, or `undefined` when no ask ended in the window. */
async function drawFresh({
  deps,
  home,
  nowIso,
  week,
}: {
  deps: SampleDrawDeps;
  home: string;
  nowIso: string;
  week: string;
}): Promise<Result<ValueSample | undefined>> {
  const rows = deps.readRows({ home });
  if (rows.isErr()) {
    return err(rows.error);
  }
  const eligible = settledAsksOf({ nowIso, rows: rows.value });
  if (eligible.length === 0) {
    return ok(undefined);
  }
  const drawn = drawSample({ asks: eligible, week });
  const costs = costsOf({
    asks: drawn,
    spawns: deps.readSpawns({ home }),
    transcripts: deps.readTranscripts({ home, sinceMs: Date.parse(nowIso) - TRANSCRIPT_LOOKBACK_DAYS * DAY_MS }),
  });
  const asks = await Promise.all(
    drawn.map(async (ask, index) => ({
      ...ask,
      cost: costs[index]!,
      prs: await Promise.all(ask.prUrls.map((url) => prOutcomeOf({ fetchPr: deps.fetchPr, url }))),
    })),
  );
  return ok({ answers: {}, asks, drawnIso: nowIso, eligible: eligible.length, schemaVersion: 1, week });
}

/**
 * The week's kept sample, or a fresh one written down, or `undefined` when there is nothing to sample.
 *
 * @param deps the board, ledger, transcript and pull-request reads a first draw makes
 * @param home the state home the sample is kept under
 * @param nowIso the instant the seven-day window ends at
 * @param week the ISO week, `YYYY-Www`, the sample is kept and seeded by
 * @returns the sample and whether an earlier run kept it, `undefined` when no ask ended, or why it would not read
 */
export async function weekSample({
  deps,
  home,
  nowIso,
  week,
}: {
  deps: SampleDrawDeps;
  home: string;
  nowIso: string;
  week: string;
}): Promise<Result<WeekSample | undefined>> {
  const kept = readSample({ home, week });
  if (kept.isErr()) {
    return err([kept.error.message]);
  }
  if (kept.value !== undefined) {
    return ok({ kept: true, sample: kept.value });
  }
  const fresh = await drawFresh({ deps, home, nowIso, week });
  if (fresh.isErr()) {
    return err(fresh.error);
  }
  if (fresh.value === undefined) {
    return ok(undefined);
  }
  const created = createSample({ home, sample: fresh.value });
  if (created.isErr()) {
    return err([created.error.message]);
  }
  if (created.value === "created") {
    return ok({ kept: false, sample: fresh.value });
  }
  // An overlapping run kept the week's sample first, perhaps with answers already on it: show that one.
  const raced = readSample({ home, week });
  if (raced.isErr()) {
    return err([raced.error.message]);
  }
  if (raced.value === undefined) {
    return err([ValueErrors.noSample({ week }).message]);
  }
  return ok({ kept: true, sample: raced.value });
}
