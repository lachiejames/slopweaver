import { describe, expect, it } from "vitest";

import { askRowProblems, isOpenAsk, settledAskOf, settledAskRefusal } from "../../../handover/askRow.js";
import type { HandoverDoc } from "../../../handover/doc.js";

// register-class: slack-ts-hand-converted-to-iso (docs/recurring-failure-register/bindings.md)

/** A well-formed ask row, overridden per case — every field stated, because absence is what is under test. */
const row = (over: Partial<HandoverDoc> = {}): HandoverDoc => ({
  anchor: "https://example.invalid/p1",
  artifact: null as unknown as string,
  askedIso: "2026-08-30T23:08:43Z",
  baseBranch: undefined,
  blockedBy: [],
  branch: undefined,
  doneWhen: [],
  kind: "ask",
  notDoneReason: undefined,
  outputs: [],
  pausedOn: undefined,
  pausedSince: undefined,
  risk: undefined,
  blastRadius: undefined,
  stillReal: undefined,
  stillRealIso: undefined,
  path: "/board/ask.md",
  priority: undefined,
  probeWaiver: undefined,
  lean: undefined,
  examples: [],
  exampleGap: undefined,
  options: [],
  problem: undefined,
  problems: [],
  repo: undefined,
  role: undefined,
  settlement: undefined,
  settlementReason: undefined,
  settlementWitness: undefined,
  origin: undefined,
  observedBy: undefined,
  registeredBy: undefined,
  registeredRun: undefined,
  evidence: [],
  ruling: undefined,
  rulingAnchor: undefined,
  hisWords: { kind: "absent" },
  hisWordsSteers: [],
  slug: "ask",
  status: "ready",
  statusSummary: undefined,
  supervisorState: undefined,
  summary: "account for every stuck chat",
  ...over,
});

describe("askRowProblems", () => {
  it("finds nothing wrong with an open ask that says when the owner asked", () => {
    expect(askRowProblems({ declaredKind: "ask", declaredOrigin: undefined, doc: row() })).toEqual([]);
  });

  it("reports a kind the board swallowed into doc, so a typo cannot silently drop the row", () => {
    const problems = askRowProblems({
      declaredKind: "Ask",
      declaredOrigin: undefined,
      doc: row({ askedIso: undefined, kind: "doc" }),
    });
    expect(problems).toEqual(['kind: "Ask" is not a kind a row may declare — use doc or ask']);
  });

  it("refuses an ask with no askedIso, because the delay is what it exists to measure", () => {
    const problems = askRowProblems({
      declaredKind: "ask",
      declaredOrigin: undefined,
      doc: row({ askedIso: undefined }),
    });
    expect(problems).toEqual([
      "an ask row declares no askedIso — when the owner said it is what makes the delay measurable",
    ]);
  });

  it("refuses an askedIso that is not an instant", () => {
    const problems = askRowProblems({
      declaredKind: "ask",
      declaredOrigin: undefined,
      doc: row({ askedIso: "yesterday" }),
    });
    expect(problems).toEqual(['askedIso: "yesterday" is not an instant']);
  });

  it("refuses a settlement with no witness, so nobody closes an ask on their own say-so", () => {
    const problems = askRowProblems({
      declaredKind: "ask",
      declaredOrigin: undefined,
      doc: row({ settlement: "answered" }),
    });
    expect(problems).toEqual([
      "settlement: answered declares no settlementWitness — a settled ask names the doc slug, the permalink " +
        "or the anchor behind it, so nobody has to take a session's word for it",
    ]);
  });

  it("refuses a decline with no reason", () => {
    const problems = askRowProblems({
      declaredKind: "ask",
      declaredOrigin: undefined,
      doc: row({ settlement: "declined", settlementWitness: "https://example.invalid/p2" }),
    });
    expect(problems).toEqual([
      "settlement: declined declares no settlementReason — only the owner declines an ask, and a decline " +
        "carries why, in the owner's words",
    ]);
  });

  it("accepts a decline that carries both a reason and an anchor", () => {
    const problems = askRowProblems({
      declaredKind: "ask",
      declaredOrigin: undefined,
      doc: row({
        settlement: "declined",
        settlementReason: "not doing this",
        settlementWitness: "https://example.invalid/p2",
      }),
    });
    expect(problems).toEqual([]);
  });

  it("reports ask-only fields sitting on a doc row, which means somebody meant kind: ask", () => {
    const problems = askRowProblems({ declaredKind: undefined, declaredOrigin: undefined, doc: row({ kind: "doc" }) });
    expect(problems).toEqual(["askedIso is only meaningful on an ask row — declare `kind: ask` or remove them"]);
  });

  it("names every misplaced field at once", () => {
    const problems = askRowProblems({
      declaredKind: "doc",
      declaredOrigin: undefined,
      doc: row({ kind: "doc", settlement: "filed", settlementWitness: "some-doc" }),
    });
    expect(problems).toEqual([
      "askedIso, settlement, settlementWitness are only meaningful on an ask row — declare `kind: ask` or remove them",
    ]);
  });

  it("finds nothing wrong with an ordinary doc row", () => {
    const doc = row({ askedIso: undefined, anchor: undefined, kind: "doc" });
    expect(askRowProblems({ declaredKind: undefined, declaredOrigin: undefined, doc })).toEqual([]);
  });
});

describe("isOpenAsk", () => {
  it("is true for an unsettled ask", () => {
    expect(isOpenAsk({ doc: row() })).toBe(true);
  });

  it("is false once it is settled", () => {
    expect(isOpenAsk({ doc: row({ settlement: "filed", settlementWitness: "some-doc" }) })).toBe(false);
  });

  it("is false for a doc row, whatever else it says", () => {
    expect(isOpenAsk({ doc: row({ askedIso: undefined, kind: "doc" }) })).toBe(false);
  });
});

describe("askRowProblems · the anchor its instant claims to come from", () => {
  /** The exact incident: the permalink for `1788220579.306599`. */
  const slackAnchor = "https://acme.slack.com/archives/C123/p1788220579306599";

  it("catches the hand-converted instant that was 80 minutes from its own anchor", () => {
    const problems = askRowProblems({
      declaredKind: "ask",
      declaredOrigin: undefined,
      doc: row({ anchor: slackAnchor, askedIso: "2026-09-01T01:16:19Z" }),
    });
    expect(problems).toEqual([
      'askedIso: "2026-09-01T01:16:19Z" is 80 minute(s) from the instant its anchor names ' +
        "(2026-08-31T23:56:19.000Z, from ts 1788220579.306599) — derive it with " +
        "`slopweaver slack when 1788220579.306599` rather than by hand",
    ]);
  });

  it("accepts the instant the anchor actually names", () => {
    expect(
      askRowProblems({
        declaredKind: "ask",
        declaredOrigin: undefined,
        doc: row({ anchor: slackAnchor, askedIso: "2026-08-31T23:56:19Z" }),
      }),
    ).toEqual([]);
  });

  it("tolerates a minute, because the owner says a thing and the message capturing it lands moments later", () => {
    expect(
      askRowProblems({
        declaredKind: "ask",
        declaredOrigin: undefined,
        doc: row({ anchor: slackAnchor, askedIso: "2026-08-31T23:57:19Z" }),
      }),
    ).toEqual([]);
  });

  it("says nothing about an anchor that is not a Slack permalink — it carries no instant to check", () => {
    expect(
      askRowProblems({
        declaredKind: "ask",
        declaredOrigin: undefined,
        doc: row({ anchor: "https://example.invalid/transcript#L40", askedIso: "2026-09-01T01:16:19Z" }),
      }),
    ).toEqual([]);
  });

  it("says nothing about a row with no anchor at all", () => {
    expect(
      askRowProblems({
        declaredKind: "ask",
        declaredOrigin: undefined,
        doc: row({ anchor: undefined, askedIso: "2026-09-01T01:16:19Z" }),
      }),
    ).toEqual([]);
  });

  it("reports the unparseable instant once rather than also comparing it to the anchor", () => {
    expect(
      askRowProblems({
        declaredKind: "ask",
        declaredOrigin: undefined,
        doc: row({ anchor: slackAnchor, askedIso: "yesterdayish" }),
      }),
    ).toEqual(['askedIso: "yesterdayish" is not an instant']);
  });
});

describe("settledAskOf — the ONE settlement read every door and every ranking shares", () => {
  it("reads the settlement and its witness off a settled ask", () => {
    expect(settledAskOf({ doc: row({ settlement: "answered", settlementWitness: "#303" }) })).toEqual({
      settlement: "answered",
      witness: "#303",
    });
  });

  it("reports a missing witness as undefined rather than inventing one", () => {
    expect(settledAskOf({ doc: row({ settlement: "declined", settlementReason: "not now" }) })).toEqual({
      settlement: "declined",
      witness: undefined,
    });
  });

  it("is undefined for an ask nobody has settled, which is the row still open to work", () => {
    expect(settledAskOf({ doc: row() })).toBe(undefined);
  });

  it("is undefined for a row that is not an ask, whatever its front matter says", () => {
    expect(settledAskOf({ doc: row({ kind: "doc", settlement: "answered", settlementWitness: "#303" }) })).toBe(
      undefined,
    );
  });

  it("agrees with the refusal the spawn door prints, because the refusal is built from it", () => {
    const doc = row({ settlement: "answered", settlementWitness: "#303" });

    expect(settledAskOf({ doc })!.settlement).toBe("answered");
    expect(settledAskRefusal({ doc })).toBe(
      "ask is an ask already settled answered (witness: #303) — " +
        "a settled ask is not work to pick up; register a new row if there is more to do",
    );
  });
});

describe("settledAskRefusal", () => {
  it("refuses an ask settled answered, naming the witness a reader can go and check", () => {
    expect(
      settledAskRefusal({
        doc: row({ settlement: "answered", settlementWitness: "https://example.invalid/p1788326101421679" }),
      }),
    ).toBe(
      "ask is an ask already settled answered (witness: https://example.invalid/p1788326101421679) — " +
        "a settled ask is not work to pick up; register a new row if there is more to do",
    );
  });

  it("refuses one settled filed", () => {
    expect(settledAskRefusal({ doc: row({ settlement: "filed", settlementWitness: "some-doc-slug" }) })).toBe(
      "ask is an ask already settled filed (witness: some-doc-slug) — " +
        "a settled ask is not work to pick up; register a new row if there is more to do",
    );
  });

  it("refuses one settled declined", () => {
    expect(
      settledAskRefusal({
        doc: row({ settlement: "declined", settlementReason: "not now", settlementWitness: "anchor" }),
      }),
    ).toBe(
      "ask is an ask already settled declined (witness: anchor) — " +
        "a settled ask is not work to pick up; register a new row if there is more to do",
    );
  });

  it("still refuses a settlement whose witness went missing, rather than reading the gap as open", () => {
    expect(settledAskRefusal({ doc: row({ settlement: "answered" }) })).toBe(
      "ask is an ask already settled answered (witness: no witness declared) — " +
        "a settled ask is not work to pick up; register a new row if there is more to do",
    );
  });

  it("lets an unsettled ask through, which is the whole point of registering one", () => {
    expect(settledAskRefusal({ doc: row() })).toBe(undefined);
  });

  it("refuses on `settlement:` rather than on `status:`, which a settled ask deliberately leaves ready", () => {
    const settled = row({ settlement: "answered", settlementWitness: "p1", status: "ready" });
    expect(settled.status).toBe("ready");
    expect(settledAskRefusal({ doc: settled })).toBe(
      "ask is an ask already settled answered (witness: p1) — " +
        "a settled ask is not work to pick up; register a new row if there is more to do",
    );
  });

  it("says nothing about a doc row, whose terminal state `status:` already carries", () => {
    expect(settledAskRefusal({ doc: row({ kind: "doc", status: "done" }) })).toBe(undefined);
  });
});
