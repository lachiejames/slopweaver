/**
 * PROPOSAL IDS — the thing the owner types back into `memory grade`.
 *
 * Two properties, and the second is the reason the separator is a zero byte: an id is STABLE across runs, and two
 * different (check, subject) pairs cannot be spelled into the same string. The collision case is written against
 * the exact pair a hyphen would have collapsed, so a future "readable separator" change fails here rather than
 * silently merging two proposals a year later.
 *
 * Everything here is invented. This is a public repository, and a fixture is the easiest place for a private
 * string to arrive unnoticed.
 */
import { describe, expect, it } from "vitest";

import {
  PROPOSAL_ID_LENGTH,
  pairSubject,
  proposalId,
  readableSubject,
  referentSubject,
} from "../../../../memory/hygiene/proposalId.js";

describe("proposalId", () => {
  it("is the same hex string on every run", () => {
    const first = proposalId({ check: "duplicate", subject: "a.md" });
    expect(first).toBe(proposalId({ check: "duplicate", subject: "a.md" }));
    expect(first.length).toBe(PROPOSAL_ID_LENGTH);
    expect(first).toMatch(/^[0-9a-f]{12}$/);
  });

  it("differs when the check differs, though the subject is the same", () => {
    expect(proposalId({ check: "duplicate", subject: "a.md" })).not.toBe(
      proposalId({ check: "enforcement", subject: "a.md" }),
    );
  });

  it("does not collide on the pair a printable separator would have collapsed", () => {
    expect(proposalId({ check: "duplicate-a", subject: "b" })).not.toBe(
      proposalId({ check: "duplicate", subject: "a-b" }),
    );
  });

  it("excludes the recommendation, so the arm demoting a drop keeps the same id", () => {
    // The signature takes no recommendation at all — which is the guarantee, since a demotion between runs must
    // not mint a second id for the same finding and reset its recurrence.
    expect(proposalId({ check: "enforcement", subject: "restates.md" })).toBe(
      proposalId({ check: "enforcement", subject: "restates.md" }),
    );
  });
});

describe("pairSubject", () => {
  it("sorts the pair, so iteration order cannot change the id", () => {
    expect(proposalId({ check: "duplicate", subject: pairSubject({ files: ["b.md", "a.md"] }) })).toBe(
      proposalId({ check: "duplicate", subject: pairSubject({ files: ["a.md", "b.md"] }) }),
    );
  });

  it("renders for a human with the separator shown", () => {
    expect(readableSubject({ subject: pairSubject({ files: ["b.md", "a.md"] }) })).toBe("a.md + b.md");
  });
});

describe("referentSubject", () => {
  it("makes two dead paths in one memory two separate decisions", () => {
    const first = referentSubject({ file: "a.md", referent: "src/one.ts" });
    const second = referentSubject({ file: "a.md", referent: "src/two.ts" });
    expect(proposalId({ check: "referent-gone", subject: first })).not.toBe(
      proposalId({ check: "referent-gone", subject: second }),
    );
    expect(readableSubject({ subject: first })).toBe("a.md + src/one.ts");
  });
});

describe("readableSubject", () => {
  it("leaves a subject with no separator alone", () => {
    expect(readableSubject({ subject: "MEMORY.md" })).toBe("MEMORY.md");
  });
});
