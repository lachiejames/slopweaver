import { describe, expect, it } from "vitest";
import { countAssertions, weakenings } from "../../../../devLint/testAssertionCounts.js";

describe("countAssertions", () => {
  it("counts every expect() call", () => {
    const counts = countAssertions({ content: `it("x", () => { expect(1).toBe(1); expect(2).toBe(2); });` });
    expect(counts.expects).toBe(2);
  });

  it("counts an exact-value matcher only when the chain's root is expect", () => {
    const content = `expect(a).toBe(1); other.toBe(2); expect(b).not.toBe(3);`;
    expect(countAssertions({ content }).strong).toBe(2);
  });

  it("does not count a weak matcher as exact", () => {
    const counts = countAssertions({ content: `expect(a).toBeDefined(); expect(b).toContain("x");` });
    expect(counts.expects).toBe(2);
    expect(counts.strong).toBe(0);
  });

  it("ignores an expect written inside a string literal", () => {
    const counts = countAssertions({ content: `const sample = "expect(1).toBe(1)"; expect(sample).toBe("");` });
    expect(counts.expects).toBe(1);
  });

  it("counts describe.skip and it.skip as skipped", () => {
    const content = `describe.skip("a", () => {}); it.skip("b", () => {});`;
    expect(countAssertions({ content }).skipped).toBe(2);
  });

  it("counts it.only as focused and not as skipped", () => {
    const counts = countAssertions({ content: `it.only("a", () => {});` });
    expect(counts.focused).toBe(1);
    expect(counts.skipped).toBe(0);
  });

  // The first of these once broke this gate: a parenthesis stopped the
  // callee walk one node short of `it`, so `.only` was never seen and a head that silenced every other
  // case in the file compared as unchanged. The other three are the same evasion spelled differently.
  it("sees .only through a parenthesis, a non-null assertion, an as-expression and a satisfies", () => {
    expect(countAssertions({ content: `(it).only("a", () => {});` }).focused).toBe(1);
    expect(countAssertions({ content: `it!.only("a", () => {});` }).focused).toBe(1);
    expect(countAssertions({ content: `(it as never).only("a", () => {});` }).focused).toBe(1);
    expect(countAssertions({ content: `(it satisfies unknown).only("a", () => {});` }).focused).toBe(1);
  });

  it("still sees an ordinary expect through a parenthesised callee", () => {
    expect(countAssertions({ content: `(expect)(1).toBe(1);` })).toEqual({
      expects: 1,
      focused: 0,
      skipped: 0,
      strong: 1,
    });
  });

  // The FIRST of these broke the previous fix: unwrapping inside
  // the callee walk was not enough, because both guards tested the node's shape before the unwrap could
  // run. Parenthesising the WHOLE callee is a different hole from parenthesising the object.
  it("sees .only when the whole callee is wrapped, not just the object", () => {
    expect(countAssertions({ content: `(it.only)("a", () => {});` }).focused).toBe(1);
    expect(countAssertions({ content: `(describe.only)("a", () => {});` }).focused).toBe(1);
    expect(countAssertions({ content: `(it.skip)("a", () => {});` }).skipped).toBe(1);
  });

  it("counts a strong matcher when the whole matcher callee is wrapped", () => {
    expect(countAssertions({ content: `(expect(1).toBe)(1);` })).toEqual({
      expects: 1,
      focused: 0,
      skipped: 0,
      strong: 1,
    });
  });

  // The wrapper can also sit on an INTERMEDIATE object in the chain, where
  // `accessNames` was still stepping onto a raw `.expression`. Three passes found this one root cause in
  // three different walkers, so these cases pin the invariant — no walk steps onto a node it has not
  // unwrapped — rather than the three spellings that happened to expose it.
  it("sees .only through a wrapper on an intermediate object in the chain", () => {
    expect(countAssertions({ content: `(it.only).each([1])("x", () => {});` }).focused).toBe(1);
    expect(countAssertions({ content: `(it.only)!.each([1])("x", () => {});` }).focused).toBe(1);
    expect(countAssertions({ content: `((it).only).each([1])("x", () => {});` }).focused).toBe(1);
    expect(countAssertions({ content: `(it.skip).each([1])("x", () => {});` }).skipped).toBe(1);
  });

  it("counts an unwrapped .each chain identically, so the wrapper changes nothing", () => {
    expect(countAssertions({ content: `it.only.each([1])("x", () => {});` }).focused).toBe(1);
  });

  it("sees through an angle-bracket type assertion, the fifth wrapper spelling", () => {
    expect(countAssertions({ content: `(<typeof it.only>it.only)("x", () => {});` }).focused).toBe(1);
    expect(countAssertions({ content: `(<typeof expect>expect)(1).toBe(1);` })).toEqual({
      expects: 1,
      focused: 0,
      skipped: 0,
      strong: 1,
    });
  });

  it("does not count a .skip on something that is not a suite function", () => {
    expect(countAssertions({ content: `queue.skip("a");` }).skipped).toBe(0);
    expect(countAssertions({ content: `queue.skipIf(true)("a");` }).skipped).toBe(0);
    expect(countAssertions({ content: `queue.skip.skipIf(false)("a");` }).skipped).toBe(0);
  });

  // Reproduced end to end: an aliased import made a whole FILE invisible to the
  // counter at both commits, so the gate printed `clean` over a deleted assertion.
  it("follows an aliased import of expect", () => {
    const content = `import { expect as check } from "vitest";\ncheck(1).toBe(1);\ncheck(2).toBe(2);`;
    expect(countAssertions({ content })).toEqual({ expects: 2, focused: 0, skipped: 0, strong: 2 });
  });

  it("follows an aliased import of a suite function", () => {
    const content = `import { it as spec } from "vitest";\nspec.only("a", () => {});\nspec.skip("b", () => {});`;
    const counts = countAssertions({ content });
    expect(counts.focused).toBe(1);
    expect(counts.skipped).toBe(1);
  });

  it("keeps the global names working when a file also imports an alias", () => {
    const content = `import { expect as check } from "vitest";\nexpect(1).toBe(1);\ncheck(2).toBe(2);`;
    expect(countAssertions({ content })).toEqual({ expects: 2, focused: 0, skipped: 0, strong: 2 });
  });

  it("does not bind a local name imported from expect's own position under another import", () => {
    const content = `import { unrelated as check } from "vitest";\ncheck(1).toBe(1);`;
    expect(countAssertions({ content })).toEqual({ expects: 0, focused: 0, skipped: 0, strong: 0 });
  });

  // A `.each` table written as a TAGGED TEMPLATE puts the modifier in the tag
  // position, where a reader that only visits call expressions never looks. Vitest focuses the file anyway.
  it("counts a .only on a tagged-template each table", () => {
    const content = 'it.only.each`a | b\n${1} | ${1}`("row", () => {});';
    expect(countAssertions({ content }).focused).toBe(1);
  });

  it("counts a .skip on a tagged-template each table", () => {
    const content = 'describe.skip.each`a\n${1}`("row", () => {});';
    expect(countAssertions({ content }).skipped).toBe(1);
  });

  it("counts a tagged-template each table reached through an aliased import", () => {
    const content = 'import { it as spec } from "vitest";\nspec.only.each`a\n${1}`("row", () => {});';
    expect(countAssertions({ content }).focused).toBe(1);
  });

  it("counts a focused each table exactly once, in either spelling", () => {
    expect(countAssertions({ content: 'it.only.each`a\n${1}`("row", () => {});' }).focused).toBe(1);
    expect(countAssertions({ content: `it.only.each([1])("row", () => {});` }).focused).toBe(1);
  });

  it("does not count a tagged template whose root is not a suite function", () => {
    expect(countAssertions({ content: 'queue.only.each`a\n${1}`("row", () => {});' }).focused).toBe(0);
  });

  // `describe.skipIf(true)` took a genuinely failing suite from exit 1 to exit 0
  // with all four counts unchanged. The criterion is execution, not the word `skip`.
  it("counts every modifier that can stop a case running as a skip", () => {
    expect(countAssertions({ content: `describe.skipIf(true)("a", () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `it.runIf(flag)("a", () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `it.todo("a");` }).skipped).toBe(1);
    expect(countAssertions({ content: `it.skip("a", () => {});` }).skipped).toBe(1);
  });

  it("does not count .fails or .concurrent, which do not stop a case running", () => {
    expect(countAssertions({ content: `it.fails("a", () => {});` }).skipped).toBe(0);
    expect(countAssertions({ content: `it.concurrent("a", () => {});` }).skipped).toBe(0);
  });

  it("counts .only ahead of a skip modifier when a chain carries both", () => {
    const counts = countAssertions({ content: `it.only.skipIf(false)("a", () => {});` });
    expect(counts.focused).toBe(1);
    expect(counts.skipped).toBe(0);
  });

  it("counts a skipIf reached through an aliased import and a tagged template", () => {
    const content = 'import { describe as suite } from "vitest";\nsuite.skipIf(true).each`a\n${1}`("row", () => {});';
    expect(countAssertions({ content }).skipped).toBe(1);
  });

  // `it["skip"]` names the same property as `it.skip` and vitest treats them
  // identically, so a walk that knew only the dotted spelling could be stepped around with brackets.
  it("reads a modifier reached by a literal bracket key", () => {
    expect(countAssertions({ content: `it["skip"]("a", () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `it["only"]("a", () => {});` }).focused).toBe(1);
    expect(countAssertions({ content: 'it[`skip`]("a", () => {});' }).skipped).toBe(1);
  });

  it("reads a strong matcher reached by a literal bracket key", () => {
    expect(countAssertions({ content: `expect(1)["toBe"](1);` })).toEqual({
      expects: 1,
      focused: 0,
      skipped: 0,
      strong: 1,
    });
  });

  it("mixes bracket and dotted hops in one chain", () => {
    expect(countAssertions({ content: `it["only"].each([1])("x", () => {});` }).focused).toBe(1);
    expect(countAssertions({ content: `it.only["each"]([1])("x", () => {});` }).focused).toBe(1);
  });

  it("does not resolve a computed key it cannot read", () => {
    expect(countAssertions({ content: `it[modifier]("a", () => {});` }).skipped).toBe(0);
    expect(countAssertions({ content: `it[` + "`${modifier}`" + `]("a", () => {});` }).skipped).toBe(0);
  });

  // `toEqual` → `toMatchObject` is a plausible "make it less brittle" edit that
  // takes a test from exit 1 to exit 0, and it was invisible while both counted as strong.
  it("does not count toMatchObject as an exact-value matcher", () => {
    expect(countAssertions({ content: `expect(user).toMatchObject({ id: "u1" });` })).toEqual({
      expects: 1,
      focused: 0,
      skipped: 0,
      strong: 0,
    });
  });

  it("names the fall when an exact matcher is swapped for a partial one", () => {
    const base = countAssertions({ content: `expect(user).toEqual({ id: "u1" });` });
    const head = countAssertions({ content: `expect(user).toMatchObject({ id: "u1" });` });
    expect(weakenings({ base, deletedWithCode: [], head, path: "src/__tests__/unit/publicUser.test.ts" })).toEqual([
      "src/__tests__/unit/publicUser.test.ts: 1 exact-value matcher(s) became 0",
    ]);
  });
});
