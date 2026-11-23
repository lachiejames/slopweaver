/** The planning half of the owner-judgement store: a memory event becomes changes, then exact transitions. */
import { describe, expect, it } from "vitest";

import type { OwnerCorrection, OwnerDirective } from "../../../judgement/ownerDirective.js";
import {
  changesFromMemory,
  isEmptyTransition,
  noChanges,
  planMemorySync,
  transitionBetween,
} from "../../../judgement/ownerJudgementPlan.js";
import {
  correctionRowOf,
  directiveRowOf,
  type StoredOwnerDirective,
} from "../../../judgement/ownerJudgementRecords.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { parseMemoryLeaf } from "../../../memory/corpus.js";
import type { MemoryLeaf } from "../../../memory/types.js";

const DIRECTIVE: OwnerDirective = {
  id: "acme-response-policy",
  source: {
    contentHash: `sha256:${"c".repeat(64)}`,
    file: "acme-response-policy.md",
    modified: "2026-10-01T00:00:00.000Z",
  },
  text: "answer acme tickets from the runbook first",
};

const CORRECTION: OwnerCorrection = {
  id: "acme-ticket-correction",
  source: { contentHash: `sha256:${"d".repeat(64)}`, file: "acme-ticket-correction.md", modified: null },
  subject: { container: "C0ACME", source: "slack", sourceId: "1700000000.000100" },
  text: "the ABC-1 outage was the queue, not the database",
};

/** The active stored version of {@link DIRECTIVE}. */
function storedDirective(): StoredOwnerDirective {
  return { ...directiveRowOf({ directive: DIRECTIVE, origin: "legacy-file", state: "active" }), rowId: "row-1" };
}

/** A memory of the given type (feedback by default) whose `ownerDirective` flag is the given literal text. */
function memory({ flag, type = "feedback" }: { flag: string; type?: string }): MemoryLeaf {
  return parseMemoryLeaf({
    file: "acme-fallback-policy.md",
    text:
      `---\nname: acme-fallback-policy\ndescription: use the direct fallback\nmetadata:\n  type: ${type}\n` +
      `  slopweaver:\n    ownerDirective: ${flag}\n---\n`,
  });
}

describe("changesFromMemory", () => {
  it("turns an opted-in memory into one directive upsert", () => {
    const changes = unwrap(changesFromMemory({ leaves: [memory({ flag: "true" })] }));

    expect([changes.directives.map((one) => one.text), changes.corrections, changes.removals]).toEqual([
      ["use the direct fallback"],
      [],
      [],
    ]);
  });

  it("turns a revoked memory into one removal naming its file", () => {
    const changes = unwrap(changesFromMemory({ leaves: [memory({ flag: "false" })] }));

    expect(changes.removals.map((one) => one.sourceFile)).toEqual(["acme-fallback-policy.md"]);
  });

  it("refuses an opt-in on a memory that is not feedback, as one memory refusal", () => {
    expect(unwrapErr(changesFromMemory({ leaves: [memory({ flag: "true", type: "project" })] })).code).toBe(
      "OWNER_DIRECTIVE_MEMORY_INVALID",
    );
  });

  it("refuses an opt-in on a memory whose frontmatter fails its schema, naming the file", () => {
    const bare = parseMemoryLeaf({
      file: "acme-bare.md",
      text: "---\nname: acme-bare\nmetadata:\n  type: feedback\n  slopweaver:\n    ownerDirective: true\n---\n",
    });

    expect(unwrapErr(changesFromMemory({ leaves: [bare] })).message).toBe(
      "acme-bare.md opts into owner directives but its memory frontmatter is invalid",
    );
  });

  it("reads an event with no leaves as no changes", () => {
    expect(noChanges({ changes: unwrap(changesFromMemory({ leaves: [] })) })).toBe(true);
  });
});

describe("transitionBetween", () => {
  it("retires and re-activates a changed id, and activates a new one", () => {
    const changed: OwnerDirective = { ...DIRECTIVE, text: "answer from the runbook, then the corpus" };
    const added: OwnerDirective = { ...DIRECTIVE, id: "acme-escalation-policy" };

    expect(
      transitionBetween({
        after: { corrections: [], directives: [added, changed], schemaVersion: 2 },
        before: { corrections: [], directives: [DIRECTIVE], schemaVersion: 2 },
      }),
    ).toEqual({
      activateCorrections: [],
      activateDirectives: [added, changed],
      retireCorrections: [],
      retireDirectives: ["acme-response-policy"],
    });
  });
});

describe("planMemorySync", () => {
  it("plans nothing for an event that changes nothing, and says so", () => {
    const planned = unwrap(
      planMemorySync({
        changes: { corrections: [], directives: [DIRECTIVE], removals: [] },
        stored: { corrections: [], directives: [storedDirective()] },
      }),
    );

    expect(isEmptyTransition({ transition: planned.transition })).toBe(true);
    expect(planned.answer).toEqual({ directiveCount: 1, kind: "unchanged" });
  });

  it("refuses to plan over a stored version that will not decode", () => {
    const unreadable: StoredOwnerDirective = { ...storedDirective(), sourceContentHash: "sha256:short" };

    expect(
      unwrapErr(
        planMemorySync({
          changes: { corrections: [], directives: [DIRECTIVE], removals: [] },
          stored: { corrections: [], directives: [unreadable] },
        }),
      ).code,
    ).toBe("OWNER_DIRECTIVE_ROW_UNREADABLE");
  });

  it("refuses a correction another memory file owns, after the directives merged", () => {
    const stored = {
      ...correctionRowOf({ correction: CORRECTION, origin: "memory", state: "active" }),
      rowId: "row-2",
    };
    const rival: OwnerCorrection = {
      ...CORRECTION,
      source: { ...CORRECTION.source, file: "acme-other.md" },
      text: "the ABC-1 outage was the network",
    };

    expect(
      unwrapErr(
        planMemorySync({
          changes: { corrections: [rival], directives: [], removals: [] },
          stored: { corrections: [stored], directives: [] },
        }),
      ).code,
    ).toBe("OWNER_DIRECTIVE_CONFLICT");
  });

  it("plans a revocation as a retirement with nothing activated", () => {
    const planned = unwrap(
      planMemorySync({
        changes: {
          corrections: [],
          directives: [],
          removals: [{ id: DIRECTIVE.id, sourceFile: DIRECTIVE.source.file }],
        },
        stored: { corrections: [], directives: [storedDirective()] },
      }),
    );

    expect(planned).toEqual({
      answer: { directiveCount: 0, kind: "written" },
      transition: {
        activateCorrections: [],
        activateDirectives: [],
        retireCorrections: [],
        retireDirectives: ["acme-response-policy"],
      },
    });
  });

  it("retires the directive when its memory gains a subject, so the ruling stands once, as a correction", () => {
    const becomes: OwnerCorrection = { ...CORRECTION, id: DIRECTIVE.id, source: DIRECTIVE.source };
    const planned = unwrap(
      planMemorySync({
        changes: { corrections: [becomes], directives: [], removals: [] },
        stored: { corrections: [], directives: [storedDirective()] },
      }),
    );

    expect(planned).toEqual({
      answer: { directiveCount: 0, kind: "written" },
      transition: {
        activateCorrections: [becomes],
        activateDirectives: [],
        retireCorrections: [],
        retireDirectives: ["acme-response-policy"],
      },
    });
  });

  it("retires the correction when its memory loses its subject, so the ruling stands once, as a directive", () => {
    const was: OwnerCorrection = { ...CORRECTION, id: DIRECTIVE.id, source: DIRECTIVE.source };
    const stored = { ...correctionRowOf({ correction: was, origin: "memory", state: "active" }), rowId: "row-2" };
    const planned = unwrap(
      planMemorySync({
        changes: { corrections: [], directives: [DIRECTIVE], removals: [] },
        stored: { corrections: [stored], directives: [] },
      }),
    );

    expect(planned).toEqual({
      answer: { directiveCount: 1, kind: "written" },
      transition: {
        activateCorrections: [],
        activateDirectives: [DIRECTIVE],
        retireCorrections: ["acme-response-policy"],
        retireDirectives: [],
      },
    });
  });

  it("keeps another memory file's directive under the same id when a correction is upserted beside it", () => {
    const beside: OwnerCorrection = { ...CORRECTION, id: DIRECTIVE.id };
    const planned = unwrap(
      planMemorySync({
        changes: { corrections: [beside], directives: [], removals: [] },
        stored: { corrections: [], directives: [storedDirective()] },
      }),
    );

    expect(planned).toEqual({
      answer: { directiveCount: 1, kind: "written" },
      transition: {
        activateCorrections: [beside],
        activateDirectives: [],
        retireCorrections: [],
        retireDirectives: [],
      },
    });
  });

  it("keeps another memory file's correction under the same id when a directive is upserted beside it", () => {
    const other: OwnerCorrection = { ...CORRECTION, id: DIRECTIVE.id };
    const stored = { ...correctionRowOf({ correction: other, origin: "memory", state: "active" }), rowId: "row-2" };
    const planned = unwrap(
      planMemorySync({
        changes: { corrections: [], directives: [DIRECTIVE], removals: [] },
        stored: { corrections: [stored], directives: [] },
      }),
    );

    expect(planned).toEqual({
      answer: { directiveCount: 1, kind: "written" },
      transition: {
        activateCorrections: [],
        activateDirectives: [DIRECTIVE],
        retireCorrections: [],
        retireDirectives: [],
      },
    });
  });

  it("refuses, writing nothing, a kind change into an id another memory file already owns as that kind", () => {
    const leaving: OwnerCorrection = { ...CORRECTION, id: DIRECTIVE.id };
    const stored = { ...correctionRowOf({ correction: leaving, origin: "memory", state: "active" }), rowId: "row-2" };
    const becomes: OwnerDirective = { ...DIRECTIVE, source: leaving.source, text: "now standing guidance" };

    expect(
      unwrapErr(
        planMemorySync({
          changes: { corrections: [], directives: [becomes], removals: [] },
          stored: { corrections: [stored], directives: [storedDirective()] },
        }),
      ).message,
    ).toBe(
      "acme-ticket-correction.md cannot replace owner directive acme-response-policy; it is owned by acme-response-policy.md",
    );
  });

  it("heals a stored same-file pair when the directive re-syncs unchanged, retiring only the correction", () => {
    const pair: OwnerCorrection = { ...CORRECTION, id: DIRECTIVE.id, source: DIRECTIVE.source };
    const stored = { ...correctionRowOf({ correction: pair, origin: "memory", state: "active" }), rowId: "row-2" };
    const planned = unwrap(
      planMemorySync({
        changes: { corrections: [], directives: [DIRECTIVE], removals: [] },
        stored: { corrections: [stored], directives: [storedDirective()] },
      }),
    );

    expect(planned).toEqual({
      answer: { directiveCount: 1, kind: "written" },
      transition: {
        activateCorrections: [],
        activateDirectives: [],
        retireCorrections: ["acme-response-policy"],
        retireDirectives: [],
      },
    });
  });

  it("heals a stored same-file pair when the correction re-syncs unchanged, retiring only the directive", () => {
    const pair: OwnerCorrection = { ...CORRECTION, id: DIRECTIVE.id, source: DIRECTIVE.source };
    const stored = { ...correctionRowOf({ correction: pair, origin: "memory", state: "active" }), rowId: "row-2" };
    const planned = unwrap(
      planMemorySync({
        changes: { corrections: [pair], directives: [], removals: [] },
        stored: { corrections: [stored], directives: [storedDirective()] },
      }),
    );

    expect(planned).toEqual({
      answer: { directiveCount: 0, kind: "written" },
      transition: {
        activateCorrections: [],
        activateDirectives: [],
        retireCorrections: [],
        retireDirectives: ["acme-response-policy"],
      },
    });
  });
});
