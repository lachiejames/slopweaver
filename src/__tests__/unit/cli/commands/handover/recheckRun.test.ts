/**
 * `handover recheck` — the way back to ready for a finding the trunk-moved hold took off it. The written
 * fields are read back through the real doc parser, so the floor the hold reads is the one this verb wrote.
 */
import { describe, expect, it } from "vitest";

import { recheckFields, recheckRefusal } from "../../../../../cli/commands/handover/recheckRun.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { docSettlementFields } from "../../../../../handover/docSettlement.js";
import { editFrontMatterFields } from "../../../../../handover/frontmatter.js";
import { trunkCheckFloor } from "../../../../../handover/trunkMoved.js";

/** A ready finding ask as `register --finding` writes one, with the given extra front-matter lines. */
function findingText({ extra = "" }: { extra?: string } = {}): string {
  return (
    "---\nslug: a-finding\nkind: ask\nsummary: a finding\nstatus: ready\naskedIso: 2026-09-29T15:38:16.738Z\n" +
    `origin: finding\nobservedBy: a-session\nevidence: [src/handover/settleCardErrors.ts:186]\n${extra}---\n\n# a finding\n`
  );
}

const PATH = "/h/a-finding.md";

describe("recheckRefusal", () => {
  it("lets an unsettled finding be rechecked", () => {
    expect(recheckRefusal({ doc: parseHandoverDoc({ path: PATH, text: findingText() }) })).toBeUndefined();
  });

  it("refuses an ask the owner made themselves, which the hold never judges", () => {
    // Evidence, too, is only meaningful on a finding, so the owner's own ask carries none of the three.
    const text = findingText().replace(
      "origin: finding\nobservedBy: a-session\nevidence: [src/handover/settleCardErrors.ts:186]\n",
      "",
    );
    expect(recheckRefusal({ doc: parseHandoverDoc({ path: PATH, text }) })).toBe(
      "a-finding is not a finding ask, and only a ready finding is held on the trunk moving under it",
    );
  });

  it("refuses a settled finding, which has nothing to offer again", () => {
    const text = findingText({ extra: "settlement: answered\nsettlementWitness: https://example.com/pr/1\n" });
    expect(recheckRefusal({ doc: parseHandoverDoc({ path: PATH, text }) })).toBe(
      "a-finding is already settled answered, so there is nothing to offer again",
    );
  });
});

describe("recheckFields", () => {
  it("writes the instant, the check and the tip, and the doc parser reads back exactly what was written", () => {
    const sha = "a".repeat(40);
    const fields = recheckFields({
      nowIso: "2026-10-10T12:00:00.000Z",
      stillReal: 'still "refuses" at 15f7cd45',
      trunkSha: sha,
    });
    const edited = editFrontMatterFields({ path: PATH, remove: fields.remove, set: fields.set, text: findingText() });
    expect(edited.isOk()).toBe(true);
    const doc = parseHandoverDoc({ path: PATH, text: edited._unsafeUnwrap() });

    expect([doc.trunkRecheckedIso, doc.trunkRechecked, doc.trunkRecheckedSha, doc.problems]).toEqual([
      "2026-10-10T12:00:00.000Z",
      'still "refuses" at 15f7cd45',
      sha,
      [],
    ]);
    // The floor is the second AFTER the recheck's own: a commit in that second is one the recheck saw.
    expect(trunkCheckFloor({ doc })).toBe("2026-10-10T12:00:01.000Z");
  });

  it("removes an earlier recheck's tip when this one's trunk did not resolve", () => {
    const earlier = findingText({ extra: `trunkRecheckedSha: ${"b".repeat(40)}\n` });
    const fields = recheckFields({ nowIso: "2026-10-11T12:00:00.000Z", stillReal: "re-ran it", trunkSha: undefined });
    const edited = editFrontMatterFields({ path: PATH, remove: fields.remove, set: fields.set, text: earlier });
    expect(edited.isOk()).toBe(true);
    const doc = parseHandoverDoc({ path: PATH, text: edited._unsafeUnwrap() });

    expect([doc.trunkRecheckedIso, "trunkRecheckedSha" in doc]).toEqual(["2026-10-11T12:00:00.000Z", false]);
  });
});

describe("docSettlementFields", () => {
  it("carries neither recheck key for a row nobody rechecked, and each key only when declared", () => {
    const declared = new Map([
      ["trunkRechecked", "re-ran it"],
      ["trunkRecheckedIso", "2026-10-10T12:00:00.000Z"],
    ]);
    const rechecked = docSettlementFields({ named: ({ key }) => declared.get(key) });
    const unchecked = docSettlementFields({ named: () => undefined });

    expect(["trunkRechecked" in unchecked, "trunkRecheckedIso" in unchecked]).toEqual([false, false]);
    expect([rechecked.trunkRechecked, rechecked.trunkRecheckedIso]).toEqual(["re-ran it", "2026-10-10T12:00:00.000Z"]);
  });
});
