import { describe, expect, it } from "vitest";

import { claimOf, collisionsAmong, type DocClaim, renderCollisions } from "../../../handover/collide.js";
import { parseHandoverDoc } from "../../../handover/doc.js";

/** A claim built directly, for the pairing rules. */
function claim({ slug, files }: { slug: string; files: readonly string[] }): DocClaim {
  return { files: new Set(files), slug };
}

describe("claimOf", () => {
  it("takes the file tokens out of a doc's body", () => {
    const text = "---\nslug: a\n---\n\nRewrite `src/handover/doc.ts` and `docs/constraints.md`.\n";
    const doc = parseHandoverDoc({ path: "/h/a.md", text });

    expect([...claimOf({ doc, text }).files].toSorted()).toEqual(["docs/constraints.md", "src/handover/doc.ts"]);
  });

  it("drops a suffix convention, which is not a path any doc owns", () => {
    const text = "---\nslug: a\n---\n\nEvery gate has a `.entry.ts` file.\n";

    expect([...claimOf({ doc: parseHandoverDoc({ path: "/h/a.md", text }), text }).files]).toEqual([]);
  });

  it("deduplicates a file mentioned more than once", () => {
    const text = "---\nslug: a\n---\n\nSee `a.ts`, then `a.ts` again.\n";

    expect([...claimOf({ doc: parseHandoverDoc({ path: "/h/a.md", text }), text }).files]).toEqual(["a.ts"]);
  });

  it("yields nothing for a doc that names no files", () => {
    const text = "---\nslug: a\n---\n\nDecide whether the thing is worth doing.\n";

    expect([...claimOf({ doc: parseHandoverDoc({ path: "/h/a.md", text }), text }).files]).toEqual([]);
  });
});

describe("collisionsAmong", () => {
  it("finds nothing when no two docs share a file", () => {
    const claims = [claim({ files: ["a.ts"], slug: "one" }), claim({ files: ["b.ts"], slug: "two" })];

    expect(collisionsAmong({ claims })).toEqual([]);
  });

  it("reports a pair sharing one file, naming the file", () => {
    const claims = [claim({ files: ["a.ts", "b.ts"], slug: "one" }), claim({ files: ["b.ts"], slug: "two" })];

    expect(collisionsAmong({ claims })).toEqual([{ files: ["b.ts"], slugs: ["one", "two"] }]);
  });

  it("sorts the shared files so the report is stable", () => {
    const claims = [claim({ files: ["z.ts", "a.ts"], slug: "one" }), claim({ files: ["a.ts", "z.ts"], slug: "two" })];

    expect(collisionsAmong({ claims })[0]!.files).toEqual(["a.ts", "z.ts"]);
  });

  it("reports each pair once, not both orderings", () => {
    const claims = [
      claim({ files: ["a.ts"], slug: "one" }),
      claim({ files: ["a.ts"], slug: "two" }),
      claim({ files: ["a.ts"], slug: "three" }),
    ];

    expect(collisionsAmong({ claims }).map((collision) => collision.slugs)).toEqual([
      ["one", "two"],
      ["one", "three"],
      ["two", "three"],
    ]);
  });

  it("finds nothing among fewer than two claims", () => {
    expect(collisionsAmong({ claims: [claim({ files: ["a.ts"], slug: "one" })] })).toEqual([]);
    expect(collisionsAmong({ claims: [] })).toEqual([]);
  });

  it("ignores a doc with no files rather than pairing it with everything", () => {
    const claims = [claim({ files: [], slug: "empty" }), claim({ files: ["a.ts"], slug: "one" })];

    expect(collisionsAmong({ claims })).toEqual([]);
  });
});

describe("renderCollisions", () => {
  it("prints nothing when nothing overlapped", () => {
    expect(renderCollisions({ collisions: [] })).toEqual([]);
  });

  /** The uncertainty ships WITH the finding: a caveat separated from its claim is one nobody applies. */
  it("states its own heuristic nature alongside the finding", () => {
    const lines = renderCollisions({ collisions: [{ files: ["a.ts"], slugs: ["one", "two"] }] });

    expect(lines[0]).toBe("⚠ 1 pair(s) of live docs name the same file(s):");
    expect(lines[1]).toBe("  one ↔ two: a.ts");
    expect(lines.join("\n")).toContain("HEURISTIC");
    expect(lines.join("\n")).toContain("warning, never a refusal");
  });
});
