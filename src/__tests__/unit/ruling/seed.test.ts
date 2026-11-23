/**
 * The seed's pure half: a key that survives an archive move, decisions that must cover every candidate, and a batch
 * planned oldest first through the same checks `ruling record` runs. Synthetic documents only.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { projectRulings, type RulingProjection } from "../../../ruling/registry.js";
import {
  parseSeedDecisionLine,
  planSeedApply,
  type RulingSeedDecision,
  seedIdOf,
  seedKeyOf,
  uniqueSeedCandidates,
} from "../../../ruling/seed.js";
import { type RulingSeedScan, scanRulingSource } from "../../../ruling/sourceRows.js";

const NOW = "2026-01-10T00:00:00.000Z";
const EMPTY: RulingProjection = unwrap(projectRulings({ file: "/synthetic/rulings.jsonl", rows: [] }));

const STATE = [
  "### RULINGS",
  "- RULED 2026-01-03, the owner, talk:00000000-0000-4000-8000-00000000000a: one review pass is enough.",
].join("\n");
const ARCHIVE = [
  "### RULINGS",
  "- RULED 2026-01-01, the owner, talk:00000000-0000-4000-8000-00000000000b: two review passes, no third.",
  "- RULED 2026-01-02, the owner, talk:00000000-0000-4000-8000-00000000000c: keep the store local.",
].join("\n");

/** Both synthetic documents, scanned. */
function scans(): readonly RulingSeedScan[] {
  return [
    scanRulingSource({ file: "/synthetic/state.md", text: STATE }),
    scanRulingSource({ file: "/synthetic/archive/state-1.md", text: ARCHIVE }),
  ];
}

/** The keyed candidates of both documents, oldest first. */
function keyed(): ReturnType<typeof uniqueSeedCandidates>["candidates"] {
  return uniqueSeedCandidates({ scans: scans() }).candidates;
}

describe("seedKeyOf and seedIdOf", () => {
  it("keys a ruling by what it says, not where it sits, so an archive move keeps its key", () => {
    const here = scanRulingSource({ file: "/synthetic/state.md", text: STATE }).candidates[0]!;
    const moved = scanRulingSource({ file: "/synthetic/archive/x.md", text: `\n\n${STATE}` }).candidates[0]!;
    expect(moved.line).not.toBe(here.line);
    expect(seedKeyOf({ candidate: moved })).toBe(seedKeyOf({ candidate: here }));
  });

  it("spells a key the decisions schema accepts", () => {
    const candidate = scanRulingSource({ file: "/synthetic/state.md", text: STATE }).candidates[0]!;
    expect(seedKeyOf({ candidate })).toMatch(/^seed-v1:[0-9a-f]{64}$/u);
  });

  it("derives the id from the key", () => {
    const key = `seed-v1:${"0123456789ab".repeat(5)}abcd`;
    expect(seedIdOf({ seedKey: key })).toBe("ruling-0123456789ab");
  });
});

describe("uniqueSeedCandidates", () => {
  it("orders candidates oldest first and collapses a ruling copied into a second document", () => {
    const copied = [...scans(), scanRulingSource({ file: "/synthetic/copy.md", text: STATE })];
    const unique = uniqueSeedCandidates({ scans: copied });
    expect(unique.candidates.map((candidate) => candidate.decidedOn)).toStrictEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
    expect(unique.duplicates.map((duplicate) => duplicate.file)).toStrictEqual(["/synthetic/copy.md"]);
  });
});

describe("parseSeedDecisionLine", () => {
  it("reads a decision", () => {
    const line = JSON.stringify({
      alongside: true,
      category: "landing",
      replaces: [],
      seedKey: `seed-v1:${"a".repeat(64)}`,
    });
    expect(unwrap(parseSeedDecisionLine({ line, lineNumber: 1 })).category).toBe("landing");
  });

  it("refuses a decision missing a field, naming its line", () => {
    const line = JSON.stringify({ category: "landing", replaces: [], seedKey: `seed-v1:${"a".repeat(64)}` });
    const error = unwrapErr(parseSeedDecisionLine({ line, lineNumber: 4 }));
    expect(error.code).toBe("SEED_DECISIONS_INVALID");
    expect(error.message).toContain("line 4");
  });
});

describe("planSeedApply", () => {
  /** A decision for each candidate, by date. */
  function decisions(): readonly RulingSeedDecision[] {
    const [first, second, third] = keyed();
    return [
      { alongside: false, category: "landing", replaces: [], seedKey: first!.seedKey },
      { alongside: false, category: "privacy", replaces: [], seedKey: second!.seedKey },
      { alongside: false, category: "landing", replaces: [first!.id], seedKey: third!.seedKey },
    ];
  }

  it("files every candidate oldest first, the later landing ruling replacing the earlier", () => {
    const plan = unwrap(planSeedApply({ decisions: decisions(), projection: EMPTY, recordedIso: NOW, scans: scans() }));
    expect(plan.alreadyFiled).toBe(0);
    expect(plan.records.map((record) => [record.category, record.words, record.replaces.length])).toStrictEqual([
      ["landing", "two review passes, no third.", 0],
      ["privacy", "keep the store local.", 0],
      ["landing", "one review pass is enough.", 1],
    ]);
    expect(plan.records[0]!.origin).toStrictEqual({
      file: "/synthetic/archive/state-1.md",
      kind: "seed",
      line: 2,
      seedKey: keyed()[0]!.seedKey,
    });
  });

  it("files nothing twice: a second plan over the register the first wrote finds everything filed", () => {
    const first = unwrap(
      planSeedApply({ decisions: decisions(), projection: EMPTY, recordedIso: NOW, scans: scans() }),
    );
    const after = unwrap(projectRulings({ file: "/synthetic/rulings.jsonl", rows: first.records }));
    const again = unwrap(
      planSeedApply({ decisions: decisions(), projection: after, recordedIso: NOW, scans: scans() }),
    );
    expect(again.records).toStrictEqual([]);
    expect(again.alreadyFiled).toBe(3);
  });

  it("refuses a later same-category ruling that neither replaces nor stands alongside the earlier one", () => {
    const undisposed = decisions().map((decision) => ({ ...decision, replaces: [] }));
    const error = unwrapErr(
      planSeedApply({ decisions: undisposed, projection: EMPTY, recordedIso: NOW, scans: scans() }),
    );
    expect(error.code).toBe("SEED_DECISIONS_INVALID");
    expect(error.message).toContain("current ruling(s) in landing stand beside this one");
  });

  it("refuses a candidate with no decision, a decision for no candidate, and two decisions for one", () => {
    const [first, second] = decisions();
    const missing = unwrapErr(
      planSeedApply({ decisions: [first!, second!], projection: EMPTY, recordedIso: NOW, scans: scans() }),
    );
    expect(missing.message).toContain("no decision for");
    const stray = { ...first!, seedKey: `seed-v1:${"f".repeat(64)}` };
    const unknown = unwrapErr(
      planSeedApply({ decisions: [...decisions(), stray], projection: EMPTY, recordedIso: NOW, scans: scans() }),
    );
    expect(unknown.message).toContain("which no source row holds");
    const twice = unwrapErr(
      planSeedApply({ decisions: [...decisions(), first!], projection: EMPTY, recordedIso: NOW, scans: scans() }),
    );
    expect(twice.message).toContain("two decisions for");
  });

  it("refuses the whole batch while any source row is a blocker", () => {
    const blocked = [
      ...scans(),
      scanRulingSource({ file: "/synthetic/odd.md", text: "### RULINGS\n- not a ruling row" }),
    ];
    const error = unwrapErr(
      planSeedApply({ decisions: decisions(), projection: EMPTY, recordedIso: NOW, scans: blocked }),
    );
    expect(error.message).toContain("1 row(s) could not be read: /synthetic/odd.md:2");
  });
});
