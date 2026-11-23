/**
 * Every Queue card `handover currency` reads: each kind's exact key, the floor the console stamps on the same card,
 * and whether its facts were re-confirmed — a monitor's card only by that monitor's own last pass naming it.
 */
import { describe, expect, it } from "vitest";

import { buildHandStep, type HandStep } from "../../../hand/step.js";
import type { CurrencyAsk } from "../../../handover/currency.js";
import {
  askCurrencyCard,
  askFloorOf,
  handCurrencyCards,
  landingCurrencyCards,
  monitorOfStep,
  monitorPassOf,
  type RecordedMonitorPass,
} from "../../../handover/currencyCards.js";
import {
  heldReplyCurrencyCards,
  reviewDraftCurrencyCards,
  slackDraftCurrencyCards,
} from "../../../handover/currencyHeldCards.js";
import { unwrap } from "../../../lib/result.js";
import type { MonitorId } from "../../../monitor/types.js";

const CHECKED = "2026-10-02T12:00:00.000Z";
const POSTED = "2026-10-02T10:00:00.000Z";
const PASSED = "2026-10-02T11:30:00.000Z";

const step = ({ id }: { id: string }): HandStep =>
  unwrap(
    buildHandStep({
      draft: {
        id,
        postedBy: "supervisor",
        postedIso: POSTED,
        unblocks: "handover run datadog-monitor-deploy",
        url: "https://console.cloud.google.com/",
        what: "Sign in to Google Cloud so the monitor deploy can finish",
        witness: `slopweaver hand done ${id}`,
      },
    }),
  );

const firing = ({ keys }: { keys: readonly string[] }): unknown => ({
  actions: [],
  readings: [
    {
      monitorId: "fleet-unhealthy",
      state: "firing",
      subjects: keys.map((key) => ({ id: `fleet/${key}`, key, label: key })),
    },
  ],
});

const passes = ({ pass }: { pass: RecordedMonitorPass }): ReadonlyMap<MonitorId, RecordedMonitorPass> =>
  new Map([["fleet-unhealthy", pass]]);

describe("handCurrencyCards", () => {
  it("confirms an ordinary step by the register still holding it, carries the row it unblocks, and leaves a notice out", () => {
    const notice: HandStep = { ...step({ id: "a-notice" }), notice: true };
    const unblocking: HandStep = { ...step({ id: "try-now" }), row: "datadog-monitor-deploy" };

    expect(handCurrencyCards({ checkedIso: CHECKED, passes: new Map(), steps: [unblocking, notice] })).toEqual([
      {
        ask: undefined,
        fact: { atIso: CHECKED, by: "the hand register still holding it", kind: "confirmed" },
        floorIso: POSTED,
        key: "hand:try-now",
        row: "datadog-monitor-deploy",
      },
    ]);
  });

  it("confirms a monitor's step only by that monitor's last pass firing on its base, at the pass's instant", () => {
    const pass = monitorPassOf({
      document: firing({ keys: ["verdict"] }),
      monitorId: "fleet-unhealthy",
      observedAtIso: PASSED,
    });

    expect(
      handCurrencyCards({
        checkedIso: CHECKED,
        passes: passes({ pass }),
        steps: [step({ id: "mon-health-verdict.2" })],
      }).map((card) => card.fact),
    ).toEqual([{ atIso: PASSED, by: "the fleet-unhealthy monitor's last pass", kind: "confirmed" }]);
  });

  it("never confirms a monitor's step its monitor has gone clear on, stopped naming, or never recorded a pass of", () => {
    const cardFor = ({ pass }: { pass: RecordedMonitorPass | undefined }) =>
      handCurrencyCards({
        checkedIso: CHECKED,
        passes: pass === undefined ? new Map() : passes({ pass }),
        steps: [step({ id: "mon-health-verdict" })],
      })[0]!.fact;
    const clear = monitorPassOf({
      document: { actions: [], readings: [{ monitorId: "fleet-unhealthy", state: "clear" }] },
      monitorId: "fleet-unhealthy",
      observedAtIso: PASSED,
    });
    const other = monitorPassOf({
      document: firing({ keys: ["another"] }),
      monitorId: "fleet-unhealthy",
      observedAtIso: PASSED,
    });

    expect([cardFor({ pass: clear }), cardFor({ pass: other }), cardFor({ pass: undefined })]).toEqual([
      { kind: "not-confirmed", why: "its monitor's last pass found the condition clear" },
      { kind: "not-confirmed", why: "its monitor's last pass no longer names it" },
      { kind: "not-confirmed", why: "no pass of its monitor is recorded" },
    ]);
  });

  it("carries a monitor pass's failed read as the fact's unread reason, never in its why", () => {
    const pass: RecordedMonitorPass = {
      detail: "session sess-123 at /tmp/reply.json",
      kind: "unread",
      why: "its monitor's last pass would not read",
    };

    expect(
      handCurrencyCards({
        checkedIso: CHECKED,
        passes: passes({ pass }),
        steps: [step({ id: "mon-health-verdict" })],
      })[0]!.fact,
    ).toEqual({
      kind: "not-confirmed",
      unread: "session sess-123 at /tmp/reply.json",
      why: "its monitor's last pass would not read",
    });
  });

  it("never lets the register confirm a monitor's step whose monitor this build no longer defines", () => {
    expect(
      handCurrencyCards({ checkedIso: CHECKED, passes: new Map(), steps: [step({ id: "mon-legacy-alert" })] }),
    ).toEqual([
      {
        ask: undefined,
        fact: { kind: "not-confirmed", why: "no monitor this build defines posts it, so no pass can re-confirm it" },
        floorIso: POSTED,
        key: "hand:mon-legacy-alert",
      },
    ]);
  });
});

describe("monitorPassOf and monitorOfStep", () => {
  it("reads a pass that is not a whole reading of the monitor as unread, never as clear", () => {
    const read = ({ document }: { document: unknown }): RecordedMonitorPass =>
      monitorPassOf({ document, monitorId: "fleet-unhealthy", observedAtIso: PASSED });

    expect([
      read({ document: "not a document" }),
      read({ document: { readings: [{ monitorId: "org-health", state: "clear" }] } }),
      read({ document: { readings: [{ monitorId: "fleet-unhealthy", state: "asleep" }] } }),
      read({ document: { readings: [{ monitorId: "fleet-unhealthy", state: "firing", subjects: [{ key: "k" }] }] } }),
    ]).toEqual([
      { kind: "unread", why: "its monitor's last recorded pass is not a monitor check document" },
      { kind: "unread", why: "its monitor's last recorded pass holds no reading of that monitor" },
      { kind: "unread", why: "its monitor's last recorded pass declares a state this check does not know" },
      { kind: "unread", why: "its monitor's last recorded pass carries a subject this check cannot read" },
    ]);
  });

  it("names the monitor behind a step's id, whatever its occurrence, and none for a step no monitor posts", () => {
    expect([
      monitorOfStep({ stepId: "mon-health-verdict.3" }),
      monitorOfStep({ stepId: "mon-recipe-stopped" }),
      monitorOfStep({ stepId: "gcloud-signin" }),
    ]).toEqual(["fleet-unhealthy", "recipe-stopped", undefined]);
  });
});

describe("askCurrencyCard", () => {
  const ask = (over: Partial<CurrencyAsk> = {}): CurrencyAsk => ({
    anchor: undefined,
    askedIso: POSTED,
    doneWhen: [],
    sameQuestionRuling: undefined,
    slug: "mirror-evidence-files",
    stillRealIso: undefined,
    ...over,
  });

  it("floors the card at the later of its asking and its re-confirmation", () => {
    expect([
      askFloorOf({ left: POSTED, right: "2026-10-02T11:00:00.000Z" }),
      askFloorOf({ left: POSTED, right: "2026-10-01T11:00:00.000Z" }),
      askFloorOf({ left: undefined, right: undefined }),
    ]).toEqual(["2026-10-02T11:00:00.000Z", POSTED, undefined]);
  });

  it("confirms its facts at the later of the still-real check and a thread read finding no reply", () => {
    const card = askCurrencyCard({
      ask: ask({ stillRealIso: "2026-10-02T10:30:00.000Z" }),
      done: { kind: "not-yet", readAtIso: CHECKED },
    });

    expect(card).toEqual({
      ask: ask({ stillRealIso: "2026-10-02T10:30:00.000Z" }),
      fact: { atIso: CHECKED, by: "a read of its Slack thread finding no reply", kind: "confirmed" },
      floorIso: "2026-10-02T10:30:00.000Z",
      key: "ask:mirror-evidence-files",
      row: "mirror-evidence-files",
    });
  });

  it("leaves its facts unconfirmed, saying why in a closed phrase, never the failed read's own reason", () => {
    const failed = askCurrencyCard({
      ask: ask(),
      done: { kind: "could-not-check", why: "session sess-123 at /tmp/reply.json" },
    });

    expect([failed.fact, askCurrencyCard({ ask: ask(), done: { kind: "on-owner-ruling" } }).fact]).toEqual([
      { kind: "not-confirmed", why: "its Slack thread could not be read" },
      { kind: "not-confirmed", why: "nothing has re-confirmed it since it was asked" },
    ]);
  });
});

describe("the held registers", () => {
  it("draws a card for each row still held, floored at its park, and none for a spent row", () => {
    const draft = ({ state }: { state: "held" | "released" }) => ({ id: `q-${state}`, state, tsIso: POSTED });
    const post = ({ state }: { state: "held" | "dropped" }) => ({
      draft: { row: "deploy-row", tsIso: POSTED },
      id: `d-${state}`,
      state,
    });
    const review = ({ state }: { state: "held" | "posted" }) => ({ draft: { tsIso: POSTED }, id: `r-${state}`, state });

    expect([
      ...heldReplyCurrencyCards({
        checkedIso: CHECKED,
        items: [draft({ state: "held" }), draft({ state: "released" })],
      }),
      ...slackDraftCurrencyCards({ checkedIso: CHECKED, items: [post({ state: "held" }), post({ state: "dropped" })] }),
      ...reviewDraftCurrencyCards({
        checkedIso: CHECKED,
        items: [review({ state: "held" }), review({ state: "posted" })],
      }),
    ]).toEqual([
      {
        ask: undefined,
        fact: { atIso: CHECKED, by: "the held-reply queue still holding it", kind: "confirmed" },
        floorIso: POSTED,
        key: "draft:q-held",
      },
      {
        ask: undefined,
        fact: { atIso: CHECKED, by: "the draft register still holding it", kind: "confirmed" },
        floorIso: POSTED,
        key: "post:d-held",
        row: "deploy-row",
      },
      {
        ask: undefined,
        fact: { atIso: CHECKED, by: "the review register still holding it", kind: "confirmed" },
        floorIso: POSTED,
        key: "review:r-held",
      },
    ]);
  });

  it("floors a parked post at when its current words were written: its newest revision, else the owner's pick", () => {
    const picked = "2026-10-02T09:10:00.000Z";
    const revised = "2026-10-02T09:20:00.000Z";
    const cards = slackDraftCurrencyCards({
      checkedIso: CHECKED,
      items: [
        { draft: { tsIso: POSTED }, id: "d-picked", pick: { atIso: picked }, state: "held" },
        {
          draft: { tsIso: POSTED },
          id: "d-revised",
          pick: { atIso: picked },
          state: "held",
          versions: [{ atIso: picked }, { atIso: revised }],
        },
      ],
    });

    expect(cards.map((card) => [card.key, card.floorIso])).toEqual([
      ["post:d-picked", picked],
      ["post:d-revised", revised],
    ]);
  });
});

describe("landingCurrencyCards", () => {
  it("floors a pull request at GitHub's own update, and dates its facts by the poll", () => {
    expect(
      landingCurrencyCards({
        document: { rows: [{ number: 2176, repoSlug: "acme/widgets", updatedAtIso: POSTED }] },
        observedAtIso: PASSED,
      }),
    ).toEqual({
      cards: [
        {
          ask: undefined,
          fact: { atIso: PASSED, by: "the last landing poll", kind: "confirmed" },
          floorIso: POSTED,
          key: "pr:acme.widgets.2176",
        },
      ],
      kind: "read",
    });
  });

  it("keys the same number in two repositories as two cards, a dotted repository name kept whole", () => {
    const rows = [
      { number: 42, repoSlug: "acme/widgets", updatedAtIso: POSTED },
      { number: 42, repoSlug: "acme/widgets.api", updatedAtIso: POSTED },
    ];
    expect(landingCurrencyCards({ document: { rows }, observedAtIso: PASSED })).toMatchObject({
      cards: [{ key: "pr:acme.widgets.42" }, { key: "pr:acme.widgets.api.42" }],
      kind: "read",
    });
  });

  it("refuses a reading with no rows, a row with no updated instant or no repository, rather than dropping the card", () => {
    expect([
      landingCurrencyCards({ document: {}, observedAtIso: PASSED }),
      landingCurrencyCards({
        document: { rows: [{ number: 1, repoSlug: "a/b", updatedAtIso: 5 }] },
        observedAtIso: PASSED,
      }),
      landingCurrencyCards({ document: { rows: [{ number: 1, updatedAtIso: POSTED }] }, observedAtIso: PASSED }),
      landingCurrencyCards({
        document: { rows: [{ number: 1, repoSlug: "ab", updatedAtIso: POSTED }] },
        observedAtIso: PASSED,
      }),
    ]).toEqual([
      { kind: "unreadable", why: "the last landing reading carries no rows" },
      { kind: "unreadable", why: "a row of the last landing reading carries no number, repository or instant" },
      { kind: "unreadable", why: "a row of the last landing reading carries no number, repository or instant" },
      { kind: "unreadable", why: "a row of the last landing reading names no pull request: ab#1" },
    ]);
  });

  it("keeps a row whose updated instant does not parse, floored at that exact string as the console stamps it", () => {
    expect(
      landingCurrencyCards({
        document: { rows: [{ number: 1, repoSlug: "a/b", updatedAtIso: "soon" }] },
        observedAtIso: PASSED,
      }),
    ).toEqual({
      cards: [
        {
          ask: undefined,
          fact: { atIso: PASSED, by: "the last landing poll", kind: "confirmed" },
          floorIso: "soon",
          key: "pr:a.b.1",
        },
      ],
      kind: "read",
    });
  });
});
