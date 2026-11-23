/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { checkInRules, placeOfSubject, rulingTargets } from "../../../autonomy/checkIns.js";
import { foldAutonomy } from "../../../autonomy/query.js";
import type { AutonomyAction, AutonomyActionRow, AutonomyRecord } from "../../../autonomy/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** One act, varying only what a test cares about. */
function act({
  actionId,
  kind = "push-back-on-coderabbit",
  subject = "https://github.com/acme/acme-admin/pull/18032",
  doneIso = "2026-10-01T10:00:00Z",
  said,
}: {
  actionId: string;
  kind?: string;
  subject?: string;
  doneIso?: string;
  said?: string;
}): AutonomyActionRow {
  const base: AutonomyActionRow = {
    actionId,
    bySession: "workspace:1",
    doneIso,
    kind,
    subject,
    why: "the comment asked for a change the base already makes",
    witness: "slopweaver github comment reply -> posted",
  };
  return said === undefined ? base : { ...base, said };
}

/** The register those records fold to. */
function folded({ records }: { records: readonly AutonomyRecord[] }): readonly AutonomyAction[] {
  return unwrap(foldAutonomy({ records }));
}

/** Three acme-admin pushback cards (two acts on one pull request), one slopweaver pushback, one other kind. */
const RECORDS: readonly AutonomyRecord[] = [
  act({
    actionId: "ev-1",
    doneIso: "2026-10-01T09:00:00Z",
    subject: "https://github.com/acme/acme-admin/pull/1",
  }),
  act({
    actionId: "ev-1b",
    doneIso: "2026-10-01T09:30:00Z",
    subject: "https://github.com/acme/acme-admin/pull/1",
  }),
  act({
    actionId: "ev-2",
    doneIso: "2026-10-01T10:00:00Z",
    subject: "https://github.com/acme/acme-admin/pull/2",
  }),
  act({
    actionId: "ev-3",
    doneIso: "2026-10-01T11:00:00Z",
    subject: "https://github.com/acme/acme-admin/pull/3",
  }),
  act({
    actionId: "sw-1",
    doneIso: "2026-10-01T12:00:00Z",
    subject: "https://github.com/lachiejames/slopweaver/pull/9",
  }),
  act({ actionId: "mail-1", kind: "gmail-archive", subject: "https://mail.google.com/mail/u/0/#all/abc" }),
];

describe("placeOfSubject", () => {
  it("reads a GitHub repository, a web host, a board slug and a state path", () => {
    expect(placeOfSubject({ subject: "https://github.com/acme/acme-admin/pull/18032" })).toBe("acme/acme-admin");
    expect(placeOfSubject({ subject: "https://ap1.datadoghq.com/monitors/50100" })).toBe("ap1.datadoghq.com");
    expect(placeOfSubject({ subject: "a-board-row-slug" })).toBe("the board");
    expect(placeOfSubject({ subject: "state:ledgers/autonomy.jsonl" })).toBe("this machine");
  });

  it("reads github.com with no repository as the host", () => {
    expect(placeOfSubject({ subject: "https://github.com/acme" })).toBe("github.com");
  });
});

describe("checkInRules", () => {
  it("groups unsettled cards by kind and place, the biggest rule first, each led by its newest card", () => {
    const rules = checkInRules({ actions: folded({ records: RECORDS }) });
    expect(rules.map((rule) => [rule.kind, rule.place, rule.cards, rule.acts, rule.lead.actionId])).toEqual([
      ["push-back-on-coderabbit", "acme/acme-admin", 3, 4, "ev-3"],
      ["push-back-on-coderabbit", "lachiejames/slopweaver", 1, 1, "sw-1"],
      ["gmail-archive", "mail.google.com", 1, 1, "mail-1"],
    ]);
  });

  it("leaves out a card the owner's word already settled", () => {
    const records: readonly AutonomyRecord[] = [
      ...RECORDS,
      { actionId: "ev-3", bySession: "talk:x", steer: "fine", steeredIso: "2026-10-01T13:00:00Z" },
    ];
    const rules = checkInRules({ actions: folded({ records }) });
    expect(rules[0]!.cards).toBe(2);
    expect(rules[0]!.lead.actionId).toBe("ev-2");
  });

  it("is empty when nothing is waiting on the owner", () => {
    expect(checkInRules({ actions: [] })).toEqual([]);
  });
});

describe("rulingTargets", () => {
  it("covers every unsettled card of the rule, the read card first, one act per card", () => {
    const targets = rulingTargets({ actionId: "ev-2", actions: folded({ records: RECORDS }), covers: "rule" });
    expect(unwrap(targets)).toEqual(["ev-2", "ev-3", "ev-1b"]);
  });

  it("covers only the read card for 'this', through the card's newest act", () => {
    const targets = rulingTargets({ actionId: "ev-1", actions: folded({ records: RECORDS }), covers: "this" });
    expect(unwrap(targets)).toEqual(["ev-1b"]);
  });

  it("never reaches the same kind in another place, nor another kind in the same place", () => {
    const targets = unwrap(rulingTargets({ actionId: "sw-1", actions: folded({ records: RECORDS }), covers: "rule" }));
    expect(targets).toEqual(["sw-1"]);
  });

  it("refuses an act the register does not carry", () => {
    const refused = unwrapErr(
      rulingTargets({ actionId: "nope", actions: folded({ records: RECORDS }), covers: "rule" }),
    );
    expect(refused.code).toBe("CHECK_IN_UNKNOWN");
  });

  it("refuses an act whose card already carries the owner's word", () => {
    const records: readonly AutonomyRecord[] = [
      ...RECORDS,
      { actionId: "sw-1", bySession: "talk:x", steer: "fine", steeredIso: "2026-10-01T13:00:00Z" },
    ];
    const refused = unwrapErr(rulingTargets({ actionId: "sw-1", actions: folded({ records }), covers: "rule" }));
    expect(refused.code).toBe("CHECK_IN_SETTLED");
  });
});
