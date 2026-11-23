/**
 * The surgical merge, tested against the exact failure it exists to prevent: an update that destroys a field
 * the caller did not mention. And the edit schema that keeps two operations on one field from disagreeing.
 */
import { describe, expect, it } from "vitest";

import { applyEdit } from "../../../../outbound/github/merge.js";
import { prFormEditSchema } from "../../../../outbound/github/schema.js";
import type { PrForm, UncheckedItem } from "../../../../outbound/github/types.js";
import { FEATURE_BODY, FIX_BODY, formOf, P3_CHECKED, TESTS_BODY, t } from "./fixtures.js";

/** The feature form: a not-seen problem, a reason and a screenshot, checks, a Not-checked item and a fold. */
const STORED: PrForm = formOf({ body: FEATURE_BODY });

const EXTRA_UNCHECKED: UncheckedItem = { check: t({ text: "A work account" }), why: t({ text: "Out of scope." }) };

describe("an unmentioned field survives the edit", () => {
  it("an empty edit is the identity", () => {
    expect(applyEdit({ edit: {}, form: STORED })).toStrictEqual(STORED);
  });

  it("editing only the title preserves every section, both proof slots and the fold included", () => {
    expect(applyEdit({ edit: { title: "a new title" }, form: STORED })).toStrictEqual({
      ...STORED,
      title: "a new title",
    });
  });

  it("setting the explainer leaves both proof slots and their screenshot alone", () => {
    const merged = applyEdit({ edit: { explainer: t({ text: "A new explainer." }) }, form: STORED });
    expect([merged.explainer, merged.problemProof, merged.solutionProof]).toStrictEqual([
      t({ text: "A new explainer." }),
      STORED.problemProof,
      STORED.solutionProof,
    ]);
  });

  it("a set section replaces that section whole and nothing else", () => {
    const merged = applyEdit({ edit: { risk: { items: [P3_CHECKED] } }, form: STORED });
    expect([merged.risk, merged.checks, merged.rerun]).toStrictEqual([
      { items: [P3_CHECKED] },
      STORED.checks,
      STORED.rerun,
    ]);
  });

  it("drops an optional section set to the empty list", () => {
    const merged = applyEdit({ edit: { notChecked: [], rerun: [] }, form: STORED });
    expect([merged.notChecked, merged.rerun, merged.checks]).toStrictEqual([[], [], STORED.checks]);
  });

  it("moves the problem from not seen to seen, and the proof to both screenshots, in one edit", () => {
    const merged = applyEdit({
      edit: { problemProof: TESTS_BODY.problemProof, problemSeen: TESTS_BODY.problemSeen },
      form: STORED,
    });
    expect([merged.problemSeen, merged.problemProof, merged.solutionProof]).toStrictEqual([
      TESTS_BODY.problemSeen,
      TESTS_BODY.problemProof,
      STORED.solutionProof,
    ]);
  });
});

describe("append adds after what is there", () => {
  it("appends a check after the recovered ones", () => {
    const extra = t({ text: "One more check." });
    expect(applyEdit({ edit: { appendChecks: [extra] }, form: STORED }).checks).toStrictEqual([
      ...STORED.checks,
      extra,
    ]);
  });

  it("appends a Not-checked item after the recovered ones", () => {
    expect(applyEdit({ edit: { appendNotChecked: [EXTRA_UNCHECKED] }, form: STORED }).notChecked).toStrictEqual([
      ...STORED.notChecked,
      EXTRA_UNCHECKED,
    ]);
  });

  it("appends onto a form that had no Not-checked items at all", () => {
    const bare = formOf({ body: FIX_BODY });
    expect(applyEdit({ edit: { appendNotChecked: [EXTRA_UNCHECKED] }, form: bare }).notChecked).toStrictEqual([
      EXTRA_UNCHECKED,
    ]);
  });

  it("appends a check onto a form that had no checks at all", () => {
    const extra = t({ text: "One more check." });
    expect(applyEdit({ edit: { appendChecks: [extra] }, form: { ...STORED, checks: [] } }).checks).toStrictEqual([
      extra,
    ]);
  });

  it("applies both appends in one edit, each after its own section", () => {
    const extra = t({ text: "One more check." });
    const merged = applyEdit({ edit: { appendChecks: [extra], appendNotChecked: [EXTRA_UNCHECKED] }, form: STORED });
    expect([merged.checks, merged.notChecked]).toStrictEqual([
      [...STORED.checks, extra],
      [...STORED.notChecked, EXTRA_UNCHECKED],
    ]);
  });

  it("leaves the recovered form untouched, since the merge builds a new draft", () => {
    applyEdit({ edit: { appendChecks: [t({ text: "One more check." })] }, form: STORED });
    expect(STORED.checks).toHaveLength(2);
  });
});

describe("a set optional section, and the keys a merged draft carries", () => {
  it("carries exactly the C3 form's keys, with no retired section left behind", () => {
    expect(Object.keys(applyEdit({ edit: { rerun: [] }, form: STORED })).toSorted()).toStrictEqual([
      "checks",
      "draft",
      "explainer",
      "notChecked",
      "problemProof",
      "problemSeen",
      "rerun",
      "risk",
      "solutionProof",
      "target",
      "title",
      "visualProof",
    ]);
  });

  it("carries the check groups through an edit that does not name them, and replaces them whole when set", () => {
    const grouped: PrForm = {
      ...STORED,
      checkGroups: [{ items: [t({ text: "An export of one sheet" })], label: t({ text: "Exports" }) }],
    };
    const replacement = [{ items: [t({ text: "An import of one sheet" })], label: t({ text: "Imports" }) }];
    expect([
      applyEdit({ edit: { title: "a new title" }, form: grouped }).checkGroups,
      applyEdit({ edit: { checkGroups: replacement }, form: grouped }).checkGroups,
    ]).toStrictEqual([grouped.checkGroups, replacement]);
  });

  it("drops the check groups set to the empty list, so the draft carries no groups key", () => {
    const grouped: PrForm = {
      ...STORED,
      checkGroups: [{ items: [t({ text: "An export of one sheet" })], label: t({ text: "Exports" }) }],
    };
    expect(Object.keys(applyEdit({ edit: { checkGroups: [] }, form: grouped }))).not.toContain("checkGroups");
    expect(Object.keys(grouped)).toContain("checkGroups");
  });

  it("sets an optional section the recovered form held empty", () => {
    const bare = formOf({ body: FIX_BODY });
    expect(applyEdit({ edit: { notChecked: [EXTRA_UNCHECKED] }, form: bare }).notChecked).toStrictEqual([
      EXTRA_UNCHECKED,
    ]);
  });

  it("replaces the fold whole and keeps the Not-checked items beside it", () => {
    const rerun = [{ kind: "command", lang: "sh", text: "yarn vitest run expiry.test.ts" }] as const;
    const merged = applyEdit({ edit: { rerun }, form: STORED });
    expect([merged.rerun, merged.notChecked]).toStrictEqual([rerun, STORED.notChecked]);
  });

  it("sets the visual-proof kind and leaves both proof slots alone", () => {
    const merged = applyEdit({ edit: { visualProof: "nothing-on-screen" }, form: STORED });
    expect([merged.visualProof, merged.problemProof, merged.solutionProof]).toStrictEqual([
      "nothing-on-screen",
      STORED.problemProof,
      STORED.solutionProof,
    ]);
  });
});

describe("draft and target are not editable", () => {
  it("keeps the stored draft state through an unrelated edit", () => {
    expect([
      applyEdit({ edit: { title: "x" }, form: STORED }).draft,
      applyEdit({ edit: { title: "x" }, form: { ...STORED, draft: false } }).draft,
    ]).toStrictEqual([true, false]);
  });

  it("keeps the stored target", () => {
    expect(applyEdit({ edit: { title: "x" }, form: STORED }).target).toStrictEqual(STORED.target);
  });

  it.each(["draft", "target", "writtenOn", "badges", "origin", "review", "goldAnchor", "reviewers"])(
    "the edit schema refuses %s by name",
    (key) => {
      const parsed = prFormEditSchema.safeParse({ [key]: true });
      expect(parsed.success).toBe(false);
      expect(parsed.error!.issues[0]!.message).toContain(key);
    },
  );
});

describe("prFormEditSchema — a field named by two operations is refused", () => {
  it("refuses appendChecks beside checks", () => {
    const parsed = prFormEditSchema.safeParse({ appendChecks: [t({ text: "a" })], checks: [t({ text: "b" })] });
    expect(parsed.error!.issues.map((issue) => [issue.path.join("."), issue.message])).toStrictEqual([
      [
        "appendChecks",
        "appendChecks adds to checks, and this edit also sets checks. Put every item in checks to replace it, or use " +
          "appendChecks alone to add after what is there",
      ],
    ]);
  });

  it("refuses appendNotChecked beside notChecked, even an empty one", () => {
    const parsed = prFormEditSchema.safeParse({ appendNotChecked: [EXTRA_UNCHECKED], notChecked: [] });
    expect(parsed.error!.issues.map((issue) => issue.path.join("."))).toStrictEqual(["appendNotChecked"]);
  });

  it("refuses an empty append, which would change nothing", () => {
    expect(prFormEditSchema.safeParse({ appendChecks: [] }).success).toBe(false);
  });

  it("accepts an empty check-group list, the edit that drops the groups", () => {
    expect(prFormEditSchema.safeParse({ checkGroups: [] }).success).toBe(true);
  });

  it("accepts a set and an append on two different fields", () => {
    const edit = { appendNotChecked: [EXTRA_UNCHECKED], checks: [t({ text: "b" })] };
    expect(prFormEditSchema.safeParse(edit).success).toBe(true);
  });

  it("refuses appendNotChecked beside notChecked with a message naming both and what to do", () => {
    const parsed = prFormEditSchema.safeParse({ appendNotChecked: [EXTRA_UNCHECKED], notChecked: [] });
    expect(parsed.error!.issues[0]!.message).toBe(
      "appendNotChecked adds to notChecked, and this edit also sets notChecked. Put every item in notChecked to " +
        "replace it, or use appendNotChecked alone to add after what is there",
    );
  });

  it("reports both conflicts at once, each on its own append", () => {
    const parsed = prFormEditSchema.safeParse({
      appendChecks: [t({ text: "a" })],
      appendNotChecked: [EXTRA_UNCHECKED],
      checks: [],
      notChecked: [],
    });
    expect(parsed.error!.issues.map((issue) => issue.path.join("."))).toStrictEqual([
      "appendChecks",
      "appendNotChecked",
    ]);
  });

  it("refuses an empty Not-checked append too", () => {
    expect(prFormEditSchema.safeParse({ appendNotChecked: [] }).success).toBe(false);
  });

  it("accepts a set, an append and a dropped section on three different fields", () => {
    const edit = { appendChecks: [t({ text: "a" })], rerun: [], title: "a new title" };
    expect(prFormEditSchema.safeParse(edit).success).toBe(true);
  });
});

describe("prFormEditSchema — a required section cannot be dropped", () => {
  it("refuses the retired remove operation by name, since a section is dropped by setting it to []", () => {
    const parsed = prFormEditSchema.safeParse({ remove: ["rerun"] });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toContain("remove");
  });

  it("refuses emptying the risk list or the explainer, which every description carries", () => {
    expect([
      prFormEditSchema.safeParse({ risk: { items: [] } }).success,
      prFormEditSchema.safeParse({ explainer: [] }).success,
    ]).toStrictEqual([false, false]);
  });
});
