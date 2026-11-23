/** What a row publishes for an ask that offers a drafted message: its action, its options and its links. */
import { describe, expect, it } from "vitest";

import {
  boardJsonDocument,
  NO_BOARD_REFERENCES,
  NO_DETACHED_FINDINGS,
} from "../../../../cli/commands/handover/listJson.js";
import { BOARD_SUMMARY_CHARS } from "../../../../cli/commands/handover/listJsonRowText.js";
import type { HandoverDoc } from "../../../../handover/doc.js";
import { EMPTY_TAG_FILTER } from "../../../../handover/tagFilter.js";
import { doc, type Journal, modelsFor, OBSERVED, SCAN_STARTED } from "./fixtures.js";

describe("what an OFFERED ask publishes", () => {
  const ACTION = {
    actor: "me" as const,
    body: "<@U01ARI> the E2E switch-over is ready for review.",
    destinations: [
      {
        channel: "C01SDLC",
        kind: "channel" as const,
        label: "Post it to #delivery",
        tradeoff: "the whole channel sees we are asking",
      },
    ],
    mentions: [{ label: "Ari", userId: "U01ARI" }],
    version: 1 as const,
  };

  const QUESTION = "Do you want to post this into #delivery?";

  /** A run parked on the owner, holding a question that carries the draft. */
  const offered: Journal = {
    events: [
      { atIso: "2026-09-22T10:00:00.000Z", branch: "a-branch", docHash: "h1", kind: "started" },
      { action: ACTION, atIso: "2026-09-22T11:00:00.000Z", kind: "question", question: QUESTION },
    ],
    unreadableLines: [],
  };

  /** The board that one journal makes. */
  function rowFor({ journal, over }: { journal?: Journal; over?: Partial<HandoverDoc> }) {
    const journals = journal === undefined ? new Map<string, Journal>() : new Map([["offered", journal]]);
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [{ ...doc({ kind: "ask", slug: "offered" }), ...over }], journals }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });
    return document.rows.find((candidate) => candidate.slug === "offered")!;
  }

  it("publishes the whole action off the run's open question", () => {
    expect(rowFor({ journal: offered }).action).toEqual(ACTION);
  });

  it("publishes no action for a run that is not parked on the owner at all", () => {
    expect(rowFor({}).action).toBeUndefined();
  });

  it("publishes no action for a parked run whose ask offers no draft", () => {
    const plain: Journal = {
      events: [
        { atIso: "2026-09-22T10:00:00.000Z", branch: "a-branch", docHash: "h1", kind: "started" },
        { atIso: "2026-09-22T11:00:00.000Z", kind: "question", question: QUESTION },
      ],
      unreadableLines: [],
    };
    expect(rowFor({ journal: plain }).action).toBeUndefined();
    expect(rowFor({ journal: plain }).actionUnreadable).toBe(false);
  });

  // A counterexample, end to end: the decoder drops a broken draft, and unless the DROP is
  // visible here the publisher reads the row as an ask that never offered one and restores the doc's own
  // front-matter options. Those options describe the very destinations that failed to decode, so the card
  // would print "DM Tobias" over a draft addressed to #delivery. The front matter is populated in the input, and
  // the plain case above is the witness that this suppression is about the BROKEN draft and not about
  // front matter in general.
  it("publishes NO shape for a parked run whose draft will not read, front matter and all", () => {
    const broken: Journal = {
      events: [
        { atIso: "2026-09-22T10:00:00.000Z", branch: "a-branch", docHash: "h1", kind: "started" },
        { actionUnreadable: true, atIso: "2026-09-22T11:00:00.000Z", kind: "question", question: QUESTION },
      ],
      unreadableLines: [],
    };
    const over = {
      lean: "DM Tobias — Tobias reviewed the last one",
      options: [
        { letter: "A", option: "DM Tobias", tradeoff: "only Tobias sees it" },
        { letter: "B", option: "Hold", tradeoff: "the review waits" },
      ],
      problem: "no review in nine days",
    };
    const row = rowFor({ journal: broken, over });

    expect(row.actionUnreadable).toBe(true);
    expect(row.options).toEqual([]);
    expect(row.lean).toBeUndefined();
    expect(row.problem).toBeUndefined();
  });

  // A second counterexample, and the one the `actionUnreadable` criterion was too narrow to catch: the
  // draft here is PERFECTLY READABLE and the row still reached the doc's front matter, because the journal
  // line carried no `lean` — one hand edit away, on a file every checkout shares. The published row then
  // held the #delivery action beside "DM Tobias", which is the same wrong card by a different route. The offer is
  // the criterion, not the defect: a run that offered a draft has its own options, derived from what it
  // actually recorded. Front matter is populated in the input, so this reddens if the suppression narrows
  // back to the broken case.
  it("publishes the ACTION's own options beside a READABLE draft whose journal line carries no lean", () => {
    const over = {
      lean: "DM Tobias — Tobias reviewed the last one",
      options: [
        { letter: "A", option: "DM Tobias", tradeoff: "only Tobias sees it" },
        { letter: "B", option: "Hold", tradeoff: "the review waits" },
      ],
      problem: "no review in nine days",
    };
    const row = rowFor({ journal: offered, over });

    expect(row.action).toEqual(ACTION);
    expect(row.actionUnreadable).toBe(false);
    // Neither the doc's list nor an empty one: the destinations the draft actually carries, HOLD last.
    // Empty was an earlier answer and it was its own defect — an ask offering a message and no way to
    // send it. `lean` and `problem` stay absent because the line genuinely carried none, and
    // the card draws its "needs rewriting" mark off exactly that.
    expect(row.options).toEqual([
      { letter: "A", option: "Post it to #delivery", tradeoff: "the whole channel sees we are asking" },
      {
        letter: "B",
        option: "Hold it — send nothing for now",
        tradeoff: "the thread moves on without our answer, and the draft goes stale",
      },
    ]);
    expect(row.lean).toBeUndefined();
    expect(row.problem).toBeUndefined();
  });

  // A third counterexample: `questionOfferedEvent` refuses a line whose action will not read,
  // so the line is UNREADABLE and the run stops being `waiting-on-owner` — which means `offeredADraft`
  // never sees it and the doc's front matter publishes. That is not the wrong card it looks like, and this
  // test is the witness for WHY: the row publishes no question and `ownerWait: not-waiting`, so nothing
  // renders it as an ask and its `options` are the doc's own registration, exactly as on every unparked
  // row. The board says `unreadable` and names the line instead, which is `area-handover.md`'s stated
  // contract for a line no decoder here can read. Verified by running this composition.
  it("publishes a run whose OFFER line will not read as unreadable, asking the owner nothing", () => {
    const over = {
      lean: "DM Tobias — Tobias reviewed the last one",
      options: [
        { letter: "A", option: "DM Tobias", tradeoff: "only Tobias sees it" },
        { letter: "B", option: "Hold", tradeoff: "the review waits" },
      ],
      problem: "no review in nine days",
    };
    const refusedOffer: Journal = {
      events: [
        { atIso: "2026-09-22T10:00:00.000Z", branch: "a-branch", docHash: "h1", kind: "started" },
        { atIso: "2026-09-22T11:00:00.000Z", kind: "question", question: QUESTION },
      ],
      unreadableLines: [3],
    };
    const row = rowFor({ journal: refusedOffer, over });

    expect(row.run).toBe("unreadable");
    expect(row.question).toBeUndefined();
    expect(row.ownerWait).toBe("not-waiting");
    expect(row.action).toBeUndefined();
  });

  it("still publishes the doc's front matter for a parked run that offered no draft at all", () => {
    const plain: Journal = {
      events: [
        { atIso: "2026-09-22T10:00:00.000Z", branch: "a-branch", docHash: "h1", kind: "started" },
        { atIso: "2026-09-22T11:00:00.000Z", kind: "question", question: QUESTION },
      ],
      unreadableLines: [],
    };
    const over = {
      lean: "ship it",
      options: [
        { letter: "A", option: "ship it", tradeoff: "the rollback is a revert" },
        { letter: "B", option: "wait", tradeoff: "the branch drifts" },
      ],
      problem: "no review in nine days",
    };

    expect(rowFor({ journal: plain, over }).options).toEqual(over.options);
  });

  it("publishes every pull request the row's own text names, each once and in order", () => {
    const first = "https://github.com/acme/acme-admin/pull/16339";
    const second = "https://github.com/acme/slopweaver/pull/1114";
    const row = rowFor({ over: { summary: `${first} then ${second} then ${first} again` } });
    expect(row.prUrls).toEqual([first, second]);
  });

  it("reads a link the summary cap would have cut off, which is where most of them sit", () => {
    const url = "https://github.com/acme/acme-admin/pull/16339";
    const row = rowFor({ over: { summary: `${"x".repeat(BOARD_SUMMARY_CHARS)} ${url}` } });
    expect(row.summary).not.toContain(url);
    expect(row.prUrls).toEqual([url]);
  });

  it("stops the URL at the number, so a /files suffix names the same request", () => {
    const row = rowFor({ over: { summary: "see https://github.com/acme/acme-admin/pull/16339/files#r1" } });
    expect(row.prUrls).toEqual(["https://github.com/acme/acme-admin/pull/16339"]);
  });

  it("reads a link out of the row's question as readily as out of its summary", () => {
    const url = "https://github.com/acme/acme-admin/pull/16339";
    const asking: Journal = {
      events: [
        { atIso: "2026-09-22T10:00:00.000Z", branch: "a-branch", docHash: "h1", kind: "started" },
        { atIso: "2026-09-22T11:00:00.000Z", kind: "question", question: `Should we chase ${url}?` },
      ],
      unreadableLines: [],
    };
    expect(rowFor({ journal: asking }).prUrls).toEqual([url]);
  });

  it("publishes no links for a row whose text names none", () => {
    expect(rowFor({}).prUrls).toEqual([]);
  });

  it("publishes the doc's own anchor, so a card can link back to what the owner said", () => {
    const anchor = "transcript:00000000-0000-4000-8000-000000000001#aaaa0001";
    expect(rowFor({ over: { anchor } }).anchor).toBe(anchor);
  });
});
