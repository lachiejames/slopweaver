/**
 * `slack draft pick`, driven with the register as a plain fake: a pick lands once, only beside a ready Codex draft, and
 * never on a row an approval already bound.
 */
import { describe, expect, it } from "vitest";

import { pickRefusal, runDraftPick } from "../../../../../cli/commands/slack/draftPickRun.js";
import type { SlackDraftDeps } from "../../../../../cli/commands/slack/draftRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { ok } from "../../../../../lib/result.js";
import type { ComparisonOutcome, SlackDraftComparison } from "../../../../../outbound/slack/draftComparison.js";
import {
  parkedDraftDigest,
  type SlackDraftEvent,
  type SlackDraftItem,
  slackDraftEventLine,
} from "../../../../../outbound/slack/draftRegister.js";
import type { SlackDripMessagePayload } from "../../../../../outbound/slack/types.js";
import { draftItem, KNOCK } from "../../../supervisor/draftItemFixture.js";

const HOME = "/tmp/no-home";
const NOW = "2026-10-10T00:20:00.000Z";
const ID = "sd-1a2b3c4d";
const PARKED_AT = "2026-10-10T00:10:00.000Z";

/** Codex's words, as `dripRender` builds a one-line rich message. */
const PAYLOAD: SlackDripMessagePayload = {
  blocks: [
    {
      elements: [{ elements: [{ text: "works for me", type: "text" }], type: "rich_text_section" }],
      type: "rich_text",
    },
  ],
  form: "rich",
  text: "works for me",
  unfurl_links: true,
  unfurl_media: true,
};

/** A Codex draft admitted beside the original, its digest over the original's destination, as its pass journalled it. */
const OUTCOME: ComparisonOutcome = {
  candidate: {
    advisory: [],
    digest: parkedDraftDigest({
      draft: { channel: draftItem({ id: ID, tsIso: PARKED_AT }).draft.channel, mentions: [], payload: PAYLOAD },
    }),
    form: "{}",
    mentions: [],
    payload: PAYLOAD,
  },
  elapsedMs: 4200,
  requestedModel: "gpt-5.5",
  state: "ready",
};
/** The parked original, a plain message: a stored top-level row as the owner declaring no kind is held as a finding. */
const ORIGINAL = { ...draftItem({ id: ID, tsIso: PARKED_AT }).draft, kind: "message" as const };
const READY_AT = "2026-10-10T00:11:00.000Z";
/** {@link OUTCOME}, as the fold carries it onto the row. */
const READY: SlackDraftComparison = { ...OUTCOME, atIso: READY_AT };

/** A held row carrying `comparison`, as the fold hands it over. */
function heldWith({ comparison }: { comparison: SlackDraftComparison }): SlackDraftItem {
  return { ...draftItem({ id: ID, tsIso: PARKED_AT }), comparison, draft: ORIGINAL };
}

describe("pickRefusal", () => {
  it("lets a pick land beside a ready Codex draft", () => {
    expect(pickRefusal({ item: heldWith({ comparison: READY }), variant: "codex" })).toBe(undefined);
  });

  it("refuses a row with no Codex draft ready, and a row an approval already bound", () => {
    const pending = heldWith({ comparison: { state: "pending" } });
    const approved = {
      ...heldWith({ comparison: READY }),
      draft: draftItem({ approval: KNOCK, id: ID, tsIso: PARKED_AT }).draft,
    };
    expect([
      pickRefusal({ item: pending, variant: "original" }),
      pickRefusal({ item: approved, variant: "codex" }),
    ]).toEqual([
      `${ID} has no Codex draft ready beside it, so there is nothing to choose between`,
      `${ID} is already approved, and the words an approval bound are never swapped under it`,
    ]);
  });

  it("records a pick once: the same variant again is no refusal, the other one is", () => {
    const picked = {
      ...heldWith({ comparison: READY }),
      pick: { atIso: NOW, model: "gpt-5.5", variant: "codex" as const },
    };
    expect([
      pickRefusal({ item: picked, variant: "codex" }),
      pickRefusal({ item: picked, variant: "original" }),
    ]).toEqual([undefined, `${ID}: they already chose the codex draft; a pick is recorded once`]);
  });

  it("refuses Codex's draft when it raises a finding the row cannot prove, and takes it once the row does", () => {
    const text = "12 users cannot check out <https://example.test/evidence|evidence>";
    const finding: SlackDraftComparison = {
      ...READY,
      candidate: {
        ...OUTCOME.candidate,
        form: '{"kind":"one-card","problem":{"kind":"possible","affects":"many"}}',
        payload: { form: "plain", text, unfurl_links: false, unfurl_media: false },
      },
    };
    const unproved = heldWith({ comparison: finding });
    const proved = {
      ...unproved,
      draft: { ...ORIGINAL, impact: "12 users cannot check out", media: [{ bytes: 1, name: "a.png", sha256: "d" }] },
    };
    expect([
      pickRefusal({ item: unproved, variant: "codex" }),
      pickRefusal({ item: unproved, variant: "original" }),
      pickRefusal({ item: proved, variant: "codex" }),
    ]).toEqual([
      `${ID}: Codex's draft raises a finding the row cannot prove (missing screenshot, impact), so it is not picked: ` +
        "they send such a card back unseen. Pick the original, or re-cut the row with its proof.",
      undefined,
      undefined,
    ]);
  });
});

/** A register holding `lines`, recording every append and every printed line; an append is read back by the next read. */
function world({ lines }: { lines: readonly string[] }) {
  const appended: SlackDraftEvent[] = [];
  const printed: string[] = [];
  const log = [...lines];
  const deps: Pick<
    SlackDraftDeps,
    "appendEvent" | "lockRegister" | "nowIso" | "out" | "readOwnerWords" | "readLandedDrafts" | "readLog"
  > = {
    appendEvent: ({ event }) => {
      appended.push(event);
      log.push(slackDraftEventLine({ event }));
      return ok(true as const);
    },
    lockRegister: () => ok(() => {}),
    nowIso: () => NOW,
    out: (line) => {
      printed.push(line);
    },
    // A relay about no card, predating its verdict: an approve refuses it, and a pick — not a yes — must not.
    readOwnerWords: () =>
      ok({
        atIso: NOW,
        context: { about: "", kind: "relay", triageRuling: undefined },
        headKnown: true,
        headLost: false,
        tailKnown: true,
        tailLost: false,
        text: "B",
        where: "console-voice",
      }),
    readLandedDrafts: () => ({
      bindings: { bound: [], unreadable: [] },
      kind: "read" as const,
      ledgerRows: 0,
      vanished: [],
    }),
    readLog: () => log,
  };
  return { appended, deps, printed };
}

const PARK = slackDraftEventLine({
  event: {
    draft: { ...ORIGINAL, comparison: { state: "pending" } },
    id: ID,
    kind: "parked",
    tsIso: PARKED_AT,
  },
});
const COMPARED = slackDraftEventLine({ event: { id: ID, kind: "compared", outcome: OUTCOME, tsIso: READY_AT } });

describe("runDraftPick", () => {
  it("appends the pick and says the row still waits for the owner's yes", () => {
    const { appended, deps, printed } = world({ lines: [PARK, COMPARED] });
    const code = runDraftPick({ deps, options: { home: HOME, id: ID, json: false, mode: "pick", variant: "codex" } });
    expect(code).toBe(EXIT_OK);
    expect(appended).toEqual([{ id: ID, kind: "picked", tsIso: NOW, variant: "codex" }]);
    expect(printed).toEqual([`picked the codex draft on ${ID}; it still waits for their yes to send`]);
  });

  it("refuses Codex's draft when it drops the link A brings as its receipt, and still takes A", () => {
    const link = "https://github.com/acme/acme-admin/pull/18398";
    const linked = slackDraftEventLine({
      event: {
        draft: {
          ...ORIGINAL,
          comparison: { state: "pending" },
          payload: { form: "plain", text: `the PR: <${link}|#18398>`, unfurl_links: false, unfurl_media: false },
          receipts: { kind: "attached", links: [link], media: 0 },
        },
        id: ID,
        kind: "parked",
        tsIso: PARKED_AT,
      },
    });
    const refused = world({ lines: [linked, COMPARED] });
    const codex = runDraftPick({
      deps: refused.deps,
      options: { home: HOME, id: ID, json: false, mode: "pick", variant: "codex" },
    });
    expect([codex, refused.appended.length]).toEqual([EXIT_USAGE, 0]);
    const taken = world({ lines: [linked, COMPARED] });
    const original = runDraftPick({
      deps: taken.deps,
      options: { home: HOME, id: ID, json: false, mode: "pick", variant: "original" },
    });
    expect([original, taken.appended.map((event) => event.kind)]).toEqual([EXIT_OK, ["picked"]]);
  });

  it("refuses a pick while Codex's draft is still owed, appending nothing", () => {
    const { appended, deps, printed } = world({ lines: [PARK] });
    const code = runDraftPick({
      deps,
      options: { home: HOME, id: ID, json: false, mode: "pick", variant: "original" },
    });
    expect([code, appended.length, printed.length]).toEqual([EXIT_USAGE, 0, 0]);
  });
});
