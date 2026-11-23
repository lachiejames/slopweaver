/**
 * `handover rule`'s PURE half — which row a slug resolves to, and what its flag parser accepts.
 *
 * The verb's real behaviour lives in `subprocess/cli/commands/handover/ruleDerivesRuling.test.ts`, and the
 * split is a rule rather than a preference: `runHandoverRule` samples the wall clock to stamp a ruling, and
 * `.claude/rules/testing.md` bans a real clock from this lane. Found by an adversarial review pass on the
 * pull request that moved rulings into the register.
 */
import { describe, expect, it } from "vitest";

import { parseHandoverRuleArgs, ruleTarget } from "../../../../../cli/commands/handover/ruleRun.js";
import type { HandoverDoc } from "../../../../../handover/doc.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const finding = (over: Partial<HandoverDoc> = {}): HandoverDoc => ({
  anchor: undefined,
  artifact: undefined,
  askedIso: "2026-09-02T06:14:01Z",
  baseBranch: undefined,
  blockedBy: [],
  branch: undefined,
  doneWhen: [],
  evidence: ["owner/repo#16360"],
  kind: "ask",
  notDoneReason: undefined,
  observedBy: "session-40",
  registeredBy: undefined,
  registeredRun: undefined,
  origin: "finding",
  outputs: [],
  pausedOn: undefined,
  pausedSince: undefined,
  risk: undefined,
  blastRadius: undefined,
  stillReal: undefined,
  stillRealIso: undefined,
  path: "/h/watchpr-dies.md",
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
  ruling: undefined,
  rulingAnchor: undefined,
  hisWords: { kind: "absent" },
  hisWordsSteers: [],
  settlement: undefined,
  settlementReason: undefined,
  settlementWitness: undefined,
  slug: "watchpr-dies",
  status: "ready",
  statusSummary: undefined,
  supervisorState: undefined,
  summary: "watchPr.sh dies silent",
  ...over,
});

describe("ruleTarget", () => {
  it("refuses a slug no row claims", () => {
    expect(ruleTarget({ archived: undefined, docs: [], slug: "nope" })).toEqual({
      refusal: 'no row on the board claims the slug "nope"',
    });
  });

  it("accepts the owner's OWN ask — a ruling lands on any row kind", () => {
    const own = finding({ evidence: [], observedBy: undefined, origin: undefined });
    expect(ruleTarget({ archived: undefined, docs: [own], slug: "watchpr-dies" })).toEqual({ row: own });
  });

  it("accepts a row that already carries a ruling — a second decision is history, not an error", () => {
    const ruled = finding({ ruling: "yes", rulingAnchor: "https://example.invalid/p9" });
    expect(ruleTarget({ archived: undefined, docs: [ruled], slug: "watchpr-dies" })).toEqual({ row: ruled });
  });

  it("accepts a declined row — recording what the owner said does not undo the settlement that refuses the door", () => {
    const declined = finding({
      settlement: "declined",
      settlementReason: "no memory of asking",
      settlementWitness: "https://example.invalid/pr/16658",
    });
    expect(ruleTarget({ archived: undefined, docs: [declined], slug: "watchpr-dies" })).toEqual({ row: declined });
  });

  it("resolves an ARCHIVED row, whose journal is live even when its document has been filed away", () => {
    const archived = finding({ path: "/h/archive/watchpr-dies.md" });
    expect(ruleTarget({ archived, docs: [], slug: "watchpr-dies" })).toEqual({ row: archived });
  });

  it("prefers the active row over an archived one of the same slug", () => {
    const row = finding();
    const archived = finding({ path: "/h/archive/watchpr-dies.md" });
    expect(ruleTarget({ archived, docs: [row], slug: "watchpr-dies" })).toEqual({ row });
  });
});

describe("parseHandoverRuleArgs", () => {
  it("takes the slug as a positional beside its flags", () => {
    const parsed = parseHandoverRuleArgs({ rest: ["a-slug", "--anchor", "p9", "--words", "yes"] });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).positionals).toEqual(["a-slug"]);
    expect(unwrap(parsed).values["anchor"]).toBe("p9");
    expect(unwrap(parsed).values["words"]).toBe("yes");
  });

  it("accepts the decision instant a relayed ruling needs", () => {
    const parsed = parseHandoverRuleArgs({
      rest: ["a-slug", "--anchor", "p9", "--words", "yes", "--decided-iso", "2026-09-04T12:38:57.414Z"],
    });

    expect(unwrap(parsed).values["decided-iso"]).toBe("2026-09-04T12:38:57.414Z");
  });

  it("refuses a flag it does not know, rather than ignoring it", () => {
    const parsed = parseHandoverRuleArgs({ rest: ["a-slug", "--rulings", "yes"] });

    expect(unwrapErr(parsed)).toEqual(["unknown flag: --rulings"]);
  });
});
