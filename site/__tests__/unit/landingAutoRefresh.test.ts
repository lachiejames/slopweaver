/*
 * The decisions the console's one landing-refresh runner acts on. The SHELL owns the Pull requests count's freshness
 * on every page: it asks on a reading event — the supervisor tick's recorded reading never holds a draft (`--press`
 * refuses `--include-drafts`) — and `due` at the cadence deadline, both only while the console is in view; the badge sat on
 * a warning all day on the Queue when only the Pull requests page asked `due`. Every ask is judged
 * against one record, so nothing runs twice over one reading inside the backoff (`syncFreshness.ts`).
 */
import { describe, expect, it } from "vitest";

import type { SyncState } from "../../components/live/LandingSync";
import type { LandingReading } from "../../components/live/readLanding";
import {
  type LandingAutoAsk,
  landingNotRecordedWhyOf,
  landingRefreshPlanOf,
  landingShellAskOf,
  landingShellWakeAtOf,
  syncShownOf,
} from "../../lib/landingAutoRefresh";
import type { LiveState } from "../../lib/liveState";
import { liveVerbFor } from "../../lib/liveVerbs";
import { closedReason } from "../../lib/spawnVerb";
import { AUTO_RETRY_MINUTES, NO_READING_ID, SYNC_NOW_BY } from "../../lib/syncFreshness";
import { ACME_PLACER } from "../organisationFixture";
import {
  acmeCensus,
  acmeRow,
  FRESH_ISO,
  landingReading,
  NOW_MS,
  openPr,
  uncensusedRow,
  WITH_DRAFTS,
  WITHOUT_DRAFTS,
} from "./landingReadingFixture";

const shown = ({ reading }: { reading: LandingReading }): LiveState<LandingReading> => ({
  fixture: undefined,
  observedAtIso: reading.observedAtIso,
  phase: "ready",
  stampedByRoute: true,
  value: reading,
});

/** A fresh tick reading: the owner's one ready pull request, their one draft left out by `--press`. */
const TICK_READING = landingReading({
  census: acmeCensus({ prs: [openPr({ number: 1 }), openPr({ draft: true, number: 2 })] }),
  rows: [acmeRow({ number: 1 })],
  selection: WITHOUT_DRAFTS,
});

/** The console's own reading that followed it: both rows, drafts in. */
const OWN_READING = landingReading({
  by: SYNC_NOW_BY,
  census: acmeCensus({ prs: [openPr({ number: 1 }), openPr({ draft: true, number: 2 })] }),
  rows: [acmeRow({ number: 1 }), acmeRow({ action: "draft", number: 2 })],
  selection: WITH_DRAFTS,
});

/** Ten minutes before {@link NOW_MS}, then every minute out to two hours past it. */
const EVERY_INSTANT = Array.from({ length: 131 }, (_, minute) => NOW_MS + (minute - 10) * 60_000);

/** The minute the page's clock reaches the due deadline over a reading taken at {@link FRESH_ISO}: 25 minutes on. */
const DUE_AT = Date.parse(FRESH_ISO) + 25 * 60_000 + 1;

const shellAskOf = ({
  state,
  taking = false,
  asked = {},
  nowMs = NOW_MS,
  visible = true,
}: {
  state: LiveState<LandingReading>;
  taking?: boolean;
  asked?: Readonly<Partial<Record<string, number>>>;
  nowMs?: number;
  visible?: boolean;
}): LandingAutoAsk | undefined =>
  landingShellAskOf({ asked, context: "work", nowMs, placer: ACME_PLACER, state, taking, visible });

describe("landingShellAskOf", () => {
  it("asks for a reading with drafts over a fresh tick reading that left them out, from whichever page is open", () => {
    expect(shellAskOf({ state: shown({ reading: TICK_READING }) })).toStrictEqual({
      readingId: `${FRESH_ISO}-github-landing`,
      reason: "drafts-excluded",
    });
  });

  it("asks nothing over its own complete reading with drafts, so the badge counts and nothing loops", () => {
    expect(shellAskOf({ state: shown({ reading: OWN_READING }) })).toBe(undefined);
  });

  it("asks rows-short over a 31-minute-old reading whose census lists a pull request no row carries", () => {
    const old = "2026-11-03T20:29:00.000Z";
    const reading = landingReading({
      census: acmeCensus({ prs: [openPr({ number: 1 }), openPr({ number: 2 })], startedAtIso: old }),
      observedAtIso: old,
      rows: [acmeRow({ number: 1 })],
      selection: WITH_DRAFTS,
    });
    expect(NOW_MS - Date.parse(old)).toBe(31 * 60_000);
    expect(shellAskOf({ state: shown({ reading }) })).toStrictEqual({
      readingId: `${old}-github-landing`,
      reason: "rows-short",
    });
  });

  it("asks census-unread over a reading whose census has no entry for a repository it was taken over", () => {
    const reading = landingReading({ census: [], rows: [acmeRow({ number: 1 })], selection: WITH_DRAFTS });
    expect(shellAskOf({ state: shown({ reading }) })).toStrictEqual({
      readingId: reading.readingId,
      reason: "census-unread",
    });
  });

  it("asks rows-short over a reading with a row in a repository its census holds no entry for", () => {
    const reading = landingReading({
      census: acmeCensus({ prs: [openPr({ number: 1 })] }),
      rows: [acmeRow({ number: 1 }), uncensusedRow({ number: 7 })],
      selection: WITH_DRAFTS,
    });
    expect(shellAskOf({ state: shown({ reading }) })).toStrictEqual({
      readingId: reading.readingId,
      reason: "rows-short",
    });
  });

  it("asks rows-short over a reading that draws one pull request as two rows", () => {
    const reading = landingReading({
      census: acmeCensus({ prs: [openPr({ number: 1 })] }),
      rows: [acmeRow({ number: 1 }), acmeRow({ number: 1 })],
      selection: WITH_DRAFTS,
    });
    expect(shellAskOf({ state: shown({ reading }) })).toStrictEqual({
      readingId: reading.readingId,
      reason: "rows-short",
    });
  });

  it("asks once per reading inside the backoff, and again past it", () => {
    const readingId = TICK_READING.readingId;
    const askedAt = NOW_MS - 60_000;
    expect(shellAskOf({ asked: { [readingId]: askedAt }, state: shown({ reading: TICK_READING }) })).toBe(undefined);
    const pastBackoff = askedAt + (AUTO_RETRY_MINUTES + 1) * 60_000;
    expect(
      shellAskOf({ asked: { [readingId]: askedAt }, nowMs: pastBackoff, state: shown({ reading: TICK_READING }) }),
    ).toStrictEqual({ readingId, reason: "drafts-excluded" });
  });

  it("asks nothing while a run is in flight", () => {
    expect(shellAskOf({ state: shown({ reading: TICK_READING }), taking: true })).toBe(undefined);
  });

  it("establishes a reading when there is none it can show, and asks nothing while one is still loading", () => {
    expect(shellAskOf({ state: { phase: "not-measured", why: "no reading recorded" } })).toStrictEqual({
      readingId: NO_READING_ID,
      reason: "no-reading",
    });
    expect(shellAskOf({ state: { phase: "loading" } })).toBe(undefined);
  });
});

describe("landingShellAskOf, the cadence", () => {
  it("asks `due` over the reading shown at the deadline while in view, and nothing a millisecond before it", () => {
    const state = shown({ reading: OWN_READING });
    expect([shellAskOf({ nowMs: DUE_AT - 1, state }), shellAskOf({ nowMs: DUE_AT, state })]).toStrictEqual([
      undefined,
      { readingId: OWN_READING.readingId, reason: "due" },
    ]);
  });

  it("never asks `due` while the console is out of view, however old the reading: a hidden console takes nothing by age", () => {
    expect(EVERY_INSTANT.length).toBeGreaterThan(0);
    expect(
      EVERY_INSTANT.map((nowMs) => shellAskOf({ nowMs, state: shown({ reading: OWN_READING }), visible: false })),
    ).toEqual(EVERY_INSTANT.map(() => undefined));
  });

  it("asks a reading event over `due` when both hold", () => {
    expect(shellAskOf({ nowMs: DUE_AT, state: shown({ reading: TICK_READING }) })).toStrictEqual({
      readingId: TICK_READING.readingId,
      reason: "drafts-excluded",
    });
  });

  it("asks nothing out of view, a reading event or no reading included, so 'when this window is next in view' holds", () => {
    expect([
      shellAskOf({ state: shown({ reading: TICK_READING }), visible: false }),
      shellAskOf({ state: { phase: "not-measured", why: "no reading recorded" }, visible: false }),
    ]).toStrictEqual([undefined, undefined]);
  });

  it("does not ask `due` over a reading asked over inside the backoff, nor while a run is in flight, and asks again past it", () => {
    const state = shown({ reading: OWN_READING });
    const asked = { [OWN_READING.readingId]: DUE_AT };
    const retryAt = DUE_AT + (AUTO_RETRY_MINUTES + 1) * 60_000;
    expect([
      shellAskOf({ asked, nowMs: DUE_AT, state }),
      shellAskOf({ nowMs: DUE_AT, state, taking: true }),
      shellAskOf({ asked, nowMs: retryAt, state }),
    ]).toStrictEqual([undefined, undefined, { readingId: OWN_READING.readingId, reason: "due" }]);
  });
});

const wakeOf = ({
  state,
  asked,
  nowMs,
}: {
  state: LiveState<LandingReading>;
  asked: Readonly<Partial<Record<string, number>>>;
  nowMs: number;
}): number | undefined => landingShellWakeAtOf({ asked, context: "work", nowMs, placer: ACME_PLACER, state });

describe("landingShellWakeAtOf", () => {
  /** The console's own reading whose census has no entry for a repository it was taken over: an event once it is old enough. */
  const OWN_UNREAD = landingReading({
    by: SYNC_NOW_BY,
    census: [],
    rows: [acmeRow({ number: 1 })],
    selection: WITH_DRAFTS,
  });
  const OPENS_AT = Date.parse(FRESH_ISO) + AUTO_RETRY_MINUTES * 60_000;

  it("wakes at the instant the console's own reading's event opens, before the cadence, and asks that event then", () => {
    const state = shown({ reading: OWN_UNREAD });
    const nowMs = Date.parse(FRESH_ISO) + 60_000;
    expect([
      shellAskOf({ nowMs, state }),
      wakeOf({ asked: {}, nowMs, state }),
      shellAskOf({ nowMs: OPENS_AT, state }),
    ]).toStrictEqual([undefined, OPENS_AT, { readingId: OWN_UNREAD.readingId, reason: "census-unread" }]);
  });

  it("names no event instant over the console's own complete reading, only the cadence", () => {
    expect(wakeOf({ asked: {}, nowMs: Date.parse(FRESH_ISO) + 60_000, state: shown({ reading: OWN_READING }) })).toBe(
      DUE_AT,
    );
  });

  it("wakes the shell at the instant the reading shown comes due", () => {
    expect(wakeOf({ asked: {}, nowMs: NOW_MS, state: shown({ reading: OWN_READING }) })).toBe(DUE_AT);
  });

  it("wakes it when the backoff over a run it asked lapses, once the reading is already due", () => {
    const asked = { [OWN_READING.readingId]: DUE_AT };
    expect(wakeOf({ asked, nowMs: DUE_AT, state: shown({ reading: OWN_READING }) })).toBe(
      DUE_AT + (AUTO_RETRY_MINUTES + 1) * 60_000,
    );
  });

  it("never names the due instant while it falls inside the backoff over a run asked just before it", () => {
    const askedAt = DUE_AT - 5 * 60_000;
    const asked = { [OWN_READING.readingId]: askedAt };
    expect(wakeOf({ asked, nowMs: askedAt, state: shown({ reading: OWN_READING }) })).toBe(
      askedAt + (AUTO_RETRY_MINUTES + 1) * 60_000,
    );
  });

  it("wakes it to establish a reading again past the backoff when there is none it can show", () => {
    const state: LiveState<LandingReading> = { phase: "not-measured", why: "no reading recorded" };
    expect(wakeOf({ asked: { [NO_READING_ID]: NOW_MS }, nowMs: NOW_MS, state })).toBe(
      NOW_MS + (AUTO_RETRY_MINUTES + 1) * 60_000,
    );
  });

  it("has nothing ahead once every instant is behind it, so no timer is left running", () => {
    expect(
      wakeOf({
        asked: { [OWN_READING.readingId]: DUE_AT },
        nowMs: DUE_AT + (AUTO_RETRY_MINUTES + 1) * 60_000,
        state: shown({ reading: OWN_READING }),
      }),
    ).toBe(undefined);
  });
});

describe("landingRefreshPlanOf", () => {
  const failed: SyncState = {
    atIso: "2026-11-03T20:58:00.000Z",
    auto: "due",
    phase: "failed",
    why: "slopweaver github landing did not answer within 240s",
  };

  it("says what the runner is really doing, from its state, never from the reading's age", () => {
    expect([
      landingRefreshPlanOf({
        nextAtWords: undefined,
        sync: { auto: "due", phase: "taking", startedAtIso: FRESH_ISO },
        visible: true,
      }),
      landingRefreshPlanOf({ nextAtWords: "today 9:11 pm", sync: failed, visible: true }),
      landingRefreshPlanOf({ nextAtWords: "today 9:15 pm", sync: { phase: "idle" }, visible: true }),
      landingRefreshPlanOf({ nextAtWords: undefined, sync: { phase: "idle" }, visible: true }),
      landingRefreshPlanOf({ nextAtWords: undefined, sync: { phase: "idle" }, visible: false }),
      landingRefreshPlanOf({ nextAtWords: "today 9:11 pm", sync: failed, visible: false }),
      landingRefreshPlanOf({ nextAtWords: "today 9:15 pm", sync: { phase: "idle" }, visible: false }),
    ]).toStrictEqual([
      "the console is taking a fresh one now",
      "the console tries again today 9:11 pm",
      "the console takes a fresh one today 9:15 pm",
      "the console takes a fresh one now",
      "the console takes a fresh one when this window is next in view",
      "the console tries again when this window is in view, not before today 9:11 pm",
      "the console takes a fresh one when this window is in view, not before today 9:15 pm",
    ]);
  });
});

describe("syncShownOf", () => {
  const failed: SyncState = {
    atIso: "2026-11-03T20:58:00.000Z",
    auto: "drafts-excluded",
    phase: "failed",
    why: "github landing exited 1",
  };

  it("reports a failure while the reading it was asked over is still shown, and idle once a later reading is", () => {
    const later = landingReading({
      by: SYNC_NOW_BY,
      census: acmeCensus({ prs: [openPr({ number: 1 })], startedAtIso: "2026-11-03T20:59:00.000Z" }),
      observedAtIso: "2026-11-03T20:59:00.000Z",
      rows: [acmeRow({ number: 1 })],
      selection: WITH_DRAFTS,
    });
    expect(later.readingId).not.toBe(TICK_READING.readingId);
    expect([
      syncShownOf({ state: shown({ reading: TICK_READING }), sync: failed, syncOver: TICK_READING.readingId }),
      syncShownOf({ state: shown({ reading: later }), sync: failed, syncOver: TICK_READING.readingId }),
    ]).toStrictEqual([failed, { phase: "idle" }]);
  });

  it("reports a failure to establish a reading only while none is shown", () => {
    const state: LiveState<LandingReading> = { phase: "not-measured", why: "no reading recorded" };
    expect(syncShownOf({ state, sync: failed, syncOver: NO_READING_ID })).toStrictEqual(failed);
  });
});

describe("landingNotRecordedWhyOf", () => {
  const title = liveVerbFor({ slug: "landing-reading" })!.title;
  // The route's own words for `reading last` exiting 3, built by the function that words them.
  const absent: LiveState<LandingReading> = {
    phase: "not-measured",
    why: closedReason({
      code: 3,
      err: "reading last: the readings ledger holds no reading by `github landing` yet",
      signal: null,
      title,
    }),
  };

  it("withholds the count as an absence, never a failed read, while no run has failed", () => {
    expect(landingNotRecordedWhyOf({ state: absent, sync: { phase: "idle" } })).toBe(
      "no reading of your pull requests is recorded yet",
    );
  });

  it("quotes the console's own failed run apart from its words", () => {
    const failed: SyncState = { atIso: "2026-11-10T00:00:00.000Z", auto: "no-reading", phase: "failed", why: "boom" };
    expect(landingNotRecordedWhyOf({ state: absent, sync: failed })).toStrictEqual([
      {
        lead: "no reading of your pull requests is recorded yet, and the console's run to take one failed",
        why: "boom",
      },
    ]);
  });

  it("leaves a ledger that genuinely failed to read as a failure", () => {
    const broken: LiveState<LandingReading> = {
      phase: "not-measured",
      why: closedReason({ code: 1, err: "reading last: index.jsonl is not readable", signal: null, title }),
    };
    expect(landingNotRecordedWhyOf({ state: broken, sync: { phase: "idle" } })).toBeUndefined();
  });
});
