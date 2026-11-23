import { describe, expect, it } from "vitest";

import {
  judgeName,
  looksLikeIdentifier,
  type NameFinding,
  nameFindingLines,
  planNameForms,
} from "../../../detective/nameProbe.js";
import { orderCells, type ProbeCell, type ProbeReport } from "../../../store/probe/result.js";
import type { ProbeShape } from "../../../store/probe/shapes.js";

/** One cell of a ladder, built from the total a test cares about. */
const cell = ({ shape, rows }: { shape: ProbeShape; rows: number }): ProbeCell => ({
  bySource: rows === 0 ? [] : [{ rows, source: "slack" }],
  ids: null,
  indexed: true,
  rows,
  shape,
});

/** A probe report over the given ladders. */
const report = ({ rows }: { rows: readonly { subject: string; cells: readonly ProbeCell[] }[] }): ProbeReport => ({
  elapsedMs: 1,
  enumerateAtOrBelow: 40,
  includeBots: false,
  rows: rows.map((row) => ({
    botsHidden: 0,
    cells: orderCells({ cells: row.cells }),
    elapsedMs: 1,
    kind: "term" as const,
    subject: row.subject,
  })),
  source: null,
});

describe("looksLikeIdentifier", () => {
  it("calls every shape of id an id, so the ambiguity step cannot fire on one", () => {
    const ids = [
      "<@U0SYNABCD>",
      "tobin.barton@acme.com",
      "https://github.com/acme/repo/pull/17000",
      "dd:AgAAAY",
      "364df1ca-3728-4214-952d-f7e147b4876f",
      "#17000",
      "17000",
      "U0SYNABCDE",
    ];
    expect(ids.filter((term) => !looksLikeIdentifier({ term }))).toEqual([]);
  });

  it("calls an ordinary written name not-an-id, including a two-word one and a hyphenated one", () => {
    const names = ["barten", "Barton", "Tobin Barton", "mary-jane", "Dr Ada"];
    expect(names.filter((term) => looksLikeIdentifier({ term }))).toEqual([]);
  });

  it("does not call a long ALL-CAPS name an id, which would silently skip the step", () => {
    const shouted = ["MACDONALD", "ALEKSANDRA", "CHRISTOPHER", "HERMANNSSON"];
    expect(shouted.filter((term) => looksLikeIdentifier({ term }))).toEqual([]);
  });

  it("still calls an upper-case object id an id, because it carries a digit", () => {
    expect(looksLikeIdentifier({ term: "U0SYNABCD" })).toBe(true);
    expect(looksLikeIdentifier({ term: "C0SYN2H9K" })).toBe(true);
  });

  it("is false on an empty term rather than throwing", () => {
    expect(looksLikeIdentifier({ term: "   " })).toBe(false);
  });
});

describe("planNameForms", () => {
  it("probes nothing at all when no name step was asked for", () => {
    const plan = planNameForms({ name: null, variants: ["barton"] });
    expect(plan.forms).toEqual([]);
    expect(plan.skipped).toBe(null);
  });

  it("refuses to probe variants of an id, and says which ruling put it outside the step", () => {
    const plan = planNameForms({ name: "<@U0SYNABCD>", variants: ["barten", "barton"] });
    expect(plan.forms).toEqual([]);
    expect(plan.skipped).toContain("ids are never ambiguous");
  });

  it("puts the asked spelling first, trims, and drops a repeat and a blank", () => {
    const plan = planNameForms({ name: "barten", variants: [" barton ", "barten", "", "tobin barton"] });
    expect(plan.forms).toEqual(["barten", "barton", "tobin barton"]);
    expect(plan.skipped).toBe(null);
  });
});

describe("judgeName", () => {
  /** The measured barten/barton ladder, reduced to the two rungs the classification reads. */
  const bartenProbe = report({
    rows: [
      { cells: [cell({ rows: 48, shape: "exact" }), cell({ rows: 3142, shape: "wild-both" })], subject: "barten" },
      { cells: [cell({ rows: 3061, shape: "exact" }), cell({ rows: 3085, shape: "wild-both" })], subject: "barton" },
    ],
  });

  it("names the form the corpus actually holds when it is not the one the question asked", () => {
    const finding = judgeName({ asked: "barten", forms: ["barten", "barton"], probe: bartenProbe });
    expect(finding.carriedInstead?.form).toBe("barton");
    expect(finding.carriedInstead?.narrowestRows).toBe(3061);
    expect(finding.absent).toEqual([]);
  });

  it("classifies a form found at no rung as absent, never as an answer about the person", () => {
    const finding = judgeName({
      asked: "barton",
      forms: ["barton", "bartone"],
      probe: report({
        rows: [
          { cells: [cell({ rows: 3061, shape: "exact" })], subject: "barton" },
          { cells: [cell({ rows: 0, shape: "exact" }), cell({ rows: 0, shape: "wild-both" })], subject: "bartone" },
        ],
      }),
    });
    expect(finding.absent.map((form) => form.form)).toEqual(["bartone"]);
    expect(finding.carrying.map((form) => form.form)).toEqual(["barton"]);
  });

  it("calls a form the tsvector cannot see lexeme-blind rather than absent", () => {
    const finding = judgeName({
      asked: "barton",
      forms: ["barton"],
      probe: report({
        rows: [
          { cells: [cell({ rows: 0, shape: "exact" }), cell({ rows: 3085, shape: "wild-both" })], subject: "barton" },
        ],
      }),
    });
    expect(finding.forms[0]?.verdict).toBe("lexeme-blind");
    expect(finding.forms[0]?.narrowestShape).toBe("wild-both");
  });

  it("reports no substitute when the asked spelling is itself the strongest form", () => {
    const finding = judgeName({
      asked: "barton",
      forms: ["barton", "barten"],
      probe: report({
        rows: [
          { cells: [cell({ rows: 3061, shape: "exact" })], subject: "barton" },
          { cells: [cell({ rows: 48, shape: "exact" })], subject: "barten" },
        ],
      }),
    });
    expect(finding.carriedInstead).toBe(null);
    expect(finding.carrying).toHaveLength(2);
  });

  it("does not hand the corpus to a form that only wins at a WIDER rung", () => {
    const finding = judgeName({
      asked: "barton",
      forms: ["barton", "barten"],
      probe: report({
        rows: [
          {
            cells: [cell({ rows: 3061, shape: "exact" }), cell({ rows: 3085, shape: "wild-both" })],
            subject: "barton",
          },
          { cells: [cell({ rows: 0, shape: "exact" }), cell({ rows: 3142, shape: "wild-both" })], subject: "barten" },
        ],
      }),
    });
    expect(finding.carriedInstead).toBe(null);
  });

  it("prefers a narrower rung over a larger count when picking the form that carries", () => {
    const finding = judgeName({
      asked: "ada",
      forms: ["ada", "aida loveless"],
      probe: report({
        rows: [
          { cells: [cell({ rows: 0, shape: "exact" }), cell({ rows: 17379, shape: "wild-both" })], subject: "ada" },
          { cells: [cell({ rows: 9, shape: "exact" })], subject: "aida loveless" },
        ],
      }),
    });
    expect(finding.carriedInstead?.form).toBe("aida loveless");
    expect(finding.carriedInstead?.narrowestRows).toBe(9);
  });

  it("gives a tie to the asked spelling, so a case variant substitutes nothing", () => {
    const finding = judgeName({
      asked: "MACDONALD",
      forms: ["MACDONALD", "macdonald"],
      probe: report({
        rows: [
          { cells: [cell({ rows: 56, shape: "exact" })], subject: "MACDONALD" },
          { cells: [cell({ rows: 56, shape: "exact" })], subject: "macdonald" },
        ],
      }),
    });
    expect(finding.carriedInstead).toBe(null);
  });

  it("skips a form the probe never ran rather than inventing a verdict for it", () => {
    const finding = judgeName({ asked: "barten", forms: ["barten", "never-probed"], probe: bartenProbe });
    expect(finding.forms.map((form) => form.form)).toEqual(["barten"]);
  });

  it("marks exactly the asked spelling as asked", () => {
    const finding = judgeName({ asked: "barten", forms: ["barten", "barton"], probe: bartenProbe });
    expect(finding.forms.filter((form) => form.asked).map((form) => form.form)).toEqual(["barten"]);
  });
});

describe("nameFindingLines", () => {
  it("renders nothing when no name step ran", () => {
    expect(nameFindingLines({ finding: null })).toEqual([]);
  });

  it("inverts an all-empty probe into a spelling problem, never an absent person", () => {
    const finding: NameFinding = judgeName({
      asked: "bartone",
      forms: ["bartone"],
      probe: report({ rows: [{ cells: [cell({ rows: 0, shape: "exact" })], subject: "bartone" }] }),
    });
    const text = nameFindingLines({ finding }).join("\n");
    expect(text).toContain("NOT a");
    expect(text).toContain("Propose another form");
    expect(text).toContain("aida loveless");
  });

  it("tells a detective the rows under the asked spelling may be other people", () => {
    const finding = judgeName({
      asked: "barten",
      forms: ["barten", "barton"],
      probe: report({
        rows: [
          { cells: [cell({ rows: 48, shape: "exact" })], subject: "barten" },
          { cells: [cell({ rows: 3061, shape: "exact" })], subject: "barton" },
        ],
      }),
    });
    const text = nameFindingLines({ finding }).join("\n");
    expect(text).toContain('holds this person under "barton"');
    expect(text).toContain("OTHER PEOPLE");
  });

  it("says the asked spelling stands when it is the one the corpus holds", () => {
    const finding = judgeName({
      asked: "barton",
      forms: ["barton"],
      probe: report({ rows: [{ cells: [cell({ rows: 3061, shape: "exact" })], subject: "barton" }] }),
    });
    expect(nameFindingLines({ finding }).join("\n")).toContain("the one the corpus holds");
  });

  it("prints one row per probed form, carrying its counts", () => {
    const finding = judgeName({
      asked: "barten",
      forms: ["barten", "barton"],
      probe: report({
        rows: [
          { cells: [cell({ rows: 48, shape: "exact" })], subject: "barten" },
          { cells: [cell({ rows: 3061, shape: "exact" })], subject: "barton" },
        ],
      }),
    });
    const lines = nameFindingLines({ finding });
    expect(lines.filter((line) => line.startsWith('  - "'))).toEqual([
      '  - "barten" (as asked): 48 at exact, exact 48 — carries',
      '  - "barton": 3061 at exact, exact 3061 — carries',
    ]);
  });
});
