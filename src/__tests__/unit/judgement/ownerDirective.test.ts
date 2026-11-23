/** The pure current-owner ruling contract: explicit opt-in, provenance, replacement, ordering, and bounds. */
import { describe, expect, it } from "vitest";
import {
  correctionsForSubjects,
  mergeOwnerCorrections,
  mergeOwnerDirectives,
  OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION,
  type OwnerCorrection,
  type OwnerDirective,
  ownerDirectiveChangeFromMemory,
  ownerDirectiveFromMemory,
  parseOwnerDirectiveOverlay,
} from "../../../judgement/ownerDirective.js";
import { sha256Text } from "../../../lib/hash.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { parseMemoryLeaf } from "../../../memory/corpus.js";

/** Parse one synthetic memory with the requested type and explicit tag. */
function memory({
  description = "act on this standing decision",
  ownerDirective = true,
  type = "feedback",
  subject,
}: {
  description?: string;
  ownerDirective?: boolean;
  type?: string;
  subject?: { source: string; container: string; sourceId: string };
} = {}) {
  return parseMemoryLeaf({
    file: "standing_decision.md",
    text:
      "---\n" +
      "name: standing-decision\n" +
      `description: ${description}\n` +
      "metadata:\n" +
      `  type: ${type}\n` +
      "  modified: 2026-08-14T00:00:00.000Z\n" +
      "  slopweaver:\n" +
      `    ownerDirective: ${String(ownerDirective)}\n` +
      (subject === undefined
        ? ""
        : "    correctionSubject:\n" +
          `      source: ${subject.source}\n` +
          `      container: ${subject.container}\n` +
          `      sourceId: "${subject.sourceId}"\n`) +
      "---\n\nEvidence behind the ruling.\n",
  });
}

const SOURCE = {
  contentHash: `sha256:${"a".repeat(64)}`,
  file: "a.md",
  modified: null,
};

const SUBJECT = { container: "C0ACME", source: "slack", sourceId: "1700000000.000100" };

describe("ownerDirectiveFromMemory", () => {
  it("turns an explicitly tagged feedback memory into one bounded current ruling", () => {
    expect(unwrap(ownerDirectiveFromMemory({ leaf: memory() }))).toEqual({
      id: "standing-decision",
      source: {
        contentHash: sha256Text({ text: "standing-decision\nact on this standing decision" }),
        file: "standing_decision.md",
        modified: "2026-08-14T00:00:00.000Z",
      },
      text: "act on this standing decision",
    });
  });

  it("does not project an explicit revocation as an upsert directive", () => {
    expect(unwrap(ownerDirectiveFromMemory({ leaf: memory({ ownerDirective: false }) }))).toBeNull();
  });

  it("turns an explicit false into a named revocation rather than confusing it with an absent tag", () => {
    expect(unwrap(ownerDirectiveChangeFromMemory({ leaf: memory({ ownerDirective: false }) }))).toEqual({
      id: "standing-decision",
      kind: "remove",
      sourceFile: "standing_decision.md",
    });
  });

  it("refuses to turn a tagged reference memory into control-plane judgement", () => {
    expect(unwrapErr(ownerDirectiveFromMemory({ leaf: memory({ type: "reference" }) })).message).toBe(
      "standing_decision.md opts into owner directives but metadata.type is not feedback",
    );
  });
});

describe("mergeOwnerDirectives", () => {
  it("replaces a ruling with the same explicit id and sorts the complete overlay", () => {
    const current: OwnerDirective = { id: "z-rule", source: { ...SOURCE, file: "z.md" }, text: "old" };
    const replacement: OwnerDirective = { id: "z-rule", source: { ...SOURCE, file: "z.md" }, text: "new" };
    const first: OwnerDirective = { id: "a-rule", source: { ...SOURCE, file: "a.md" }, text: "first" };

    expect(
      unwrap(
        mergeOwnerDirectives({
          directives: [replacement, first],
          overlay: { corrections: [], directives: [current], schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION },
        }),
      ),
    ).toEqual({
      corrections: [],
      directives: [first, replacement],
      schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION,
    });
  });

  it("refuses more than 64 directives instead of silently truncating control-plane state", () => {
    const directives = Array.from({ length: 65 }, (_, index): OwnerDirective => ({
      id: `rule-${String(index)}`,
      source: SOURCE,
      text: "ruling",
    }));

    const result = parseOwnerDirectiveOverlay({
      value: { corrections: [], directives, schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION },
    });
    const error = unwrapErr(result);
    expect(error.code).toBe("OWNER_DIRECTIVE_SCHEMA_INVALID");
    expect(error.message).toContain("<=64 items");
  });

  it("removes an explicitly revoked id before applying upserts", () => {
    const kept: OwnerDirective = { id: "kept", source: SOURCE, text: "keep" };
    const removed: OwnerDirective = { id: "removed", source: SOURCE, text: "remove" };

    expect(
      unwrap(
        mergeOwnerDirectives({
          directives: [],
          overlay: {
            corrections: [],
            directives: [kept, removed],
            schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION,
          },
          removals: [{ id: "removed", sourceFile: "a.md" }],
        }),
      ),
    ).toEqual({ corrections: [], directives: [kept], schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION });
  });

  it("refuses a same-id replacement or revocation from a different memory file", () => {
    const current: OwnerDirective = { id: "standing", source: SOURCE, text: "old" };
    const replacement: OwnerDirective = { id: "standing", source: { ...SOURCE, file: "other.md" }, text: "new" };
    const overlay = {
      corrections: [],
      directives: [current],
      schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION,
    } as const;

    expect(unwrapErr(mergeOwnerDirectives({ directives: [replacement], overlay })).message).toBe(
      "other.md cannot replace owner directive standing; it is owned by a.md",
    );
    expect(
      unwrapErr(
        mergeOwnerDirectives({
          directives: [],
          overlay,
          removals: [{ id: "standing", sourceFile: "other.md" }],
        }),
      ).message,
    ).toBe("other.md cannot revoke owner directive standing; it is owned by a.md");
  });

  it("drops the same file's correction under the id it now upserts as a directive, and keeps another file's", () => {
    const directive: OwnerDirective = { id: "standing", source: SOURCE, text: "standing guidance" };
    const sameFile: OwnerCorrection = { id: "standing", source: SOURCE, subject: SUBJECT, text: "was a correction" };
    const otherFile: OwnerCorrection = { ...sameFile, source: { ...SOURCE, file: "other.md" } };

    expect(
      unwrap(
        mergeOwnerDirectives({
          directives: [directive],
          overlay: { corrections: [sameFile], directives: [], schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION },
        }),
      ),
    ).toEqual({ corrections: [], directives: [directive], schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION });
    expect(
      unwrap(
        mergeOwnerDirectives({
          directives: [directive],
          overlay: { corrections: [otherFile], directives: [], schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION },
        }),
      ),
    ).toEqual({
      corrections: [otherFile],
      directives: [directive],
      schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION,
    });
  });

  it("refuses duplicate ids in a stored overlay", () => {
    const directive: OwnerDirective = { id: "standing", source: SOURCE, text: "ruling" };

    expect(
      unwrapErr(
        parseOwnerDirectiveOverlay({
          value: {
            corrections: [],
            directives: [directive, directive],
            schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION,
          },
        }),
      ).message,
    ).toBe("duplicate owner directive id: standing");
  });
});

describe("mergeOwnerCorrections", () => {
  it("drops the same file's directive under the id it now upserts as a correction, and keeps another file's", () => {
    const correction: OwnerCorrection = { id: "standing", source: SOURCE, subject: SUBJECT, text: "now a correction" };
    const sameFile: OwnerDirective = { id: "standing", source: SOURCE, text: "was standing guidance" };
    const otherFile: OwnerDirective = { ...sameFile, source: { ...SOURCE, file: "other.md" } };

    expect(
      unwrap(
        mergeOwnerCorrections({
          corrections: [correction],
          overlay: { corrections: [], directives: [sameFile], schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION },
        }),
      ),
    ).toEqual({ corrections: [correction], directives: [], schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION });
    expect(
      unwrap(
        mergeOwnerCorrections({
          corrections: [correction],
          overlay: { corrections: [], directives: [otherFile], schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION },
        }),
      ),
    ).toEqual({
      corrections: [correction],
      directives: [otherFile],
      schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION,
    });
  });
});

describe("correctionsForSubjects", () => {
  const correction = (over: Partial<OwnerCorrection> = {}): OwnerCorrection => ({
    id: "ada-pain-points-wrong",
    source: { contentHash: `sha256:${"a".repeat(64)}`, file: "m.md", modified: null },
    subject: { container: "C0B5", source: "slack", sourceId: "1783644763.016499" },
    text: "that one's wrong — the owner never said onboarding was the blocker",
    ...over,
  });

  it("matches a correction whose exact source/container/sourceId is in the slice", () => {
    const matched = correctionsForSubjects({
      corrections: [correction()],
      subjects: [{ container: "C0B5", source: "slack", sourceId: "1783644763.016499" }],
    });

    expect(matched.map((c) => c.id)).toEqual(["ada-pain-points-wrong"]);
  });

  it("does NOT match on container alone — a correction about one message is not about the channel", () => {
    // The false positive that matters: firing a correction on a record the owner never saw attributes words to
    // them about a thing they did not read. A miss repeats a mistake; this invents one.
    const matched = correctionsForSubjects({
      corrections: [correction()],
      subjects: [{ container: "C0B5", source: "slack", sourceId: "1799999999.000000" }],
    });

    expect(matched).toEqual([]);
  });

  it("does NOT match the same id across different sources", () => {
    const matched = correctionsForSubjects({
      corrections: [correction()],
      subjects: [{ container: "C0B5", source: "github", sourceId: "1783644763.016499" }],
    });

    expect(matched).toEqual([]);
  });

  it("ignores `url` entirely, so one object reachable by two URLs still matches", () => {
    const matched = correctionsForSubjects({
      corrections: [correction({ subject: { container: "C0B5", source: "slack", sourceId: "1.0", url: "https://a" } })],
      subjects: [{ container: "C0B5", source: "slack", sourceId: "1.0" }],
    });

    expect(matched).toHaveLength(1);
  });

  it("returns nothing for an empty slice rather than every correction", () => {
    expect(correctionsForSubjects({ corrections: [correction()], subjects: [] })).toEqual([]);
  });

  it("keeps overlay order when several match, so rendering is deterministic", () => {
    const first = correction({ id: "a" });
    const second = correction({ id: "b", subject: { container: "C1", source: "slack", sourceId: "2.0" } });
    const matched = correctionsForSubjects({
      corrections: [first, second],
      subjects: [
        { container: "C1", source: "slack", sourceId: "2.0" },
        { container: "C0B5", source: "slack", sourceId: "1783644763.016499" },
      ],
    });

    expect(matched.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
