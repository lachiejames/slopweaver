import { describe, expect, it } from "vitest";
import { countAssertions, weakenings } from "../../../../devLint/testAssertionCounts.js";

describe("countAssertions", () => {
  // `it("x", { skip: true }, fn)` is vitest's own signature and reads as ordinary
  // configuration rather than evasion, which is exactly why it silenced a failing case with counts unmoved.
  it("counts a skip set as an option rather than a chained property", () => {
    expect(countAssertions({ content: `it("a", { skip: true }, () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `it("a", { todo: true }, () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `describe("a", { skip: true }, () => {});` }).skipped).toBe(1);
  });

  it("counts an only set as an option", () => {
    expect(countAssertions({ content: `it("a", { only: true }, () => {});` }).focused).toBe(1);
  });

  it("ignores an option set to a literal false, and one this gate does not read", () => {
    expect(countAssertions({ content: `it("a", { skip: false }, () => {});` }).skipped).toBe(0);
    expect(countAssertions({ content: `it("a", { retry: 2 }, () => {});` }).skipped).toBe(0);
  });

  // The skipped count is a WEIGHT summed per modifier. A conditional whose own literal argument says it
  // never skips scores zero; every other modifier scores one, an unreadable condition included, because a
  // condition this gate cannot evaluate must never read as weaker than it is.
  it("scores a neutralised conditional zero and every other skip modifier one", () => {
    expect(countAssertions({ content: `it.skipIf(false)("a", () => {});` }).skipped).toBe(0);
    expect(countAssertions({ content: `it.runIf(true)("a", () => {});` }).skipped).toBe(0);
    expect(countAssertions({ content: `it.skipIf(true)("a", () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `it.runIf(false)("a", () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `describe.skipIf(true)("a", () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `it.skipIf(process.env["CI"])("a", () => {});` }).skipped).toBe(1);
  });

  // Only the OUTERMOST hop owns the call's arguments, so the `false` answers `skipIf` and says nothing
  // about the `.skip` beside it. A whole-chain veto was written, and
  // caught it erasing exactly this real `.skip`; scoring per modifier is what keeps both readings.
  it("lets a neutralised conditional stand beside a real skip without erasing it", () => {
    expect(countAssertions({ content: `it.skip.skipIf(false)("a", () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `it.skipIf(false).runIf(true)("a", () => {});` }).skipped).toBe(0);
  });

  // A CASE takes any modifier that skips; a SUITE takes only the last one applied. Every line here was
  // run on vitest 4.1.11 and the expectation is that run's exit code, not a reading of the chain.
  it("resolves a case chain by any modifier and a suite chain by the last one applied", () => {
    expect(countAssertions({ content: `describe.skip.skipIf(false)("s", () => {});` }).skipped).toBe(0);
    expect(countAssertions({ content: `describe.skip.runIf(true)("s", () => {});` }).skipped).toBe(0);
    expect(countAssertions({ content: `describe.skip.skipIf(true)("s", () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `describe.skipIf(false).skip("s", () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `describe.skip("s", () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `it.skip.skipIf(false)("a", () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `it.skip.runIf(true)("a", () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `it.skipIf(false).skip("a", () => {});` }).skipped).toBe(1);
  });

  it("reads an aliased suite import by the same last-wins rule", () => {
    const content = `import { describe as group } from "vitest";\ngroup.skip.skipIf(false)("s", () => {});`;
    expect(countAssertions({ content }).skipped).toBe(0);
  });

  // A chain INTERRUPTED by a conditional call is still one chain.
  // `describe.skipIf(true).skipIf(false)` is three nested calls, and a walk that stopped at the first saw
  // two independent one-hop chains — so the outer override was lost and the repeated modifier counted
  // twice. Every expectation here is a vitest 4.1.11 exit code.
  it("resolves a chain the conditional calls interrupt as one chain", () => {
    expect(countAssertions({ content: `describe.skipIf(true).skipIf(false)("s", () => {});` }).skipped).toBe(0);
    expect(countAssertions({ content: `describe.skipIf(false).skipIf(true)("s", () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `describe.skipIf(true)("s", () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `it.skipIf(true).skipIf(true)("a", () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `it.skipIf(true).skipIf(false)("a", () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `it.skipIf(false).each([1])("a %i", () => {});` }).skipped).toBe(0);
    expect(countAssertions({ content: `it.skip.each([1])("a %i", () => {});` }).skipped).toBe(1);
  });

  it("counts a focus through a chain the conditional calls interrupt, exactly once", () => {
    expect(countAssertions({ content: `describe.only.skipIf(false)("s", () => {});` })).toEqual({
      expects: 0,
      focused: 1,
      skipped: 0,
      strong: 0,
    });
    expect(countAssertions({ content: `it.only.each([1])("a %i", () => {});` }).focused).toBe(1);
  });

  // The other direction of the same pass: both ends run the case and fail it, so neither the deletion nor
  // the addition of a modifier the outermost one overrides may be reported.
  it("names the rise for an overridden suite conditional without refusing its inverse", () => {
    const suite = `("s", () => { it("r", () => { expect(1).toBe(2); }); })`;
    const running = countAssertions({ content: `describe.skipIf(true).skipIf(false)${suite};` });
    const silenced = countAssertions({ content: `describe.skipIf(true)${suite};` });
    const plain = countAssertions({ content: `describe${suite};` });
    expect(weakenings({ base: running, deletedWithCode: [], head: silenced, path: "a.test.ts" })).toEqual([
      "a.test.ts: 0 skipped suite(s)/case(s) became 1",
    ]);
    expect(weakenings({ base: plain, deletedWithCode: [], head: running, path: "a.test.ts" })).toEqual([]);
  });

  // A declared `skip` option is the LAST word in both directions, measured on vitest 4.1.11. Reading the
  // chain first scored `it.skipIf(false)("r", { skip: true }, fn)` zero while vitest skipped it — the miss
  // this gate exists to catch, written in vitest's own documented signature.
  it("lets a declared skip option override whatever the chain said", () => {
    const fail = `() => { expect(1).toBe(2); }`;
    expect(countAssertions({ content: `it.skipIf(false)("r", { skip: true }, ${fail});` }).skipped).toBe(1);
    expect(countAssertions({ content: `it.skipIf(true)("r", { skip: false }, ${fail});` }).skipped).toBe(0);
    expect(countAssertions({ content: `it.skip("r", { skip: false }, ${fail});` }).skipped).toBe(0);
    expect(countAssertions({ content: `describe.skipIf(false)("s", { skip: true }, ${fail});` }).skipped).toBe(1);
  });

  it("names the rise when only a declared skip option silences a failing case", () => {
    const fail = `() => { expect(1).toBe(2); }`;
    const base = countAssertions({ content: `it.skipIf(false)("r", ${fail});` });
    const head = countAssertions({ content: `it.skipIf(false)("r", { skip: true }, ${fail});` });
    expect(weakenings({ base, deletedWithCode: [], head, path: "a.test.ts" })).toEqual([
      "a.test.ts: 0 skipped suite(s)/case(s) became 1",
    ]);
  });

  it("does not refuse a case that repeated a skip condition it already had", () => {
    const body = `("r", () => { expect(1).toBe(2); })`;
    const base = countAssertions({ content: `it.skipIf(true)${body};` });
    const head = countAssertions({ content: `it.skipIf(true).skipIf(true)${body};` });
    expect(base.skipped).toBe(1);
    expect(weakenings({ base, deletedWithCode: [], head, path: "a.test.ts" })).toEqual([]);
  });

  // Counterexamples, each run at BOTH ends on vitest 4.1.11: the base exits 1 with
  // a failing case and the head exits 0 with it skipped. A flat per-call count scored both ends the same,
  // so flipping the literal moved nothing and `weakenings` returned []. These are the witnesses that the
  // rise is now named.
  it("names the rise when a literal condition is flipped to silence a failing case", () => {
    const base = countAssertions({ content: `it.skipIf(false)("regression", () => { expect(1).toBe(2); });` });
    const viaSkip = countAssertions({ content: `it.skip.skipIf(false)("regression", () => { expect(1).toBe(2); });` });
    const viaLiteral = countAssertions({ content: `it.skipIf(true)("regression", () => { expect(1).toBe(2); });` });
    expect(weakenings({ base, deletedWithCode: [], head: viaSkip, path: "a.test.ts" })).toEqual([
      "a.test.ts: 0 skipped suite(s)/case(s) became 1",
    ]);
    expect(weakenings({ base, deletedWithCode: [], head: viaLiteral, path: "a.test.ts" })).toEqual([
      "a.test.ts: 0 skipped suite(s)/case(s) became 1",
    ]);
  });

  it("names the rise when runIf is flipped from true to false", () => {
    const base = countAssertions({ content: `it.runIf(true)("regression", () => { expect(1).toBe(2); });` });
    const head = countAssertions({ content: `it.runIf(false)("regression", () => { expect(1).toBe(2); });` });
    expect(weakenings({ base, deletedWithCode: [], head, path: "a.test.ts" })).toEqual([
      "a.test.ts: 0 skipped suite(s)/case(s) became 1",
    ]);
  });

  // The sharpest of the cases: DELETING a modifier is what weakens here,
  // because vitest lets a trailing conditional override a suite's own `.skip`. The over-count this
  // replaced scored both ends one, so the gate printed clean over a silenced failing suite.
  it("names the rise when deleting a suite's trailing conditional silences it", () => {
    const suite = `("s", () => { it("r", () => { expect(1).toBe(2); }); })`;
    const base = countAssertions({ content: `describe.skip.skipIf(false)${suite};` });
    const head = countAssertions({ content: `describe.skip${suite};` });
    expect(weakenings({ base, deletedWithCode: [], head, path: "a.test.ts" })).toEqual([
      "a.test.ts: 0 skipped suite(s)/case(s) became 1",
    ]);
  });

  // The same pass named this separately as a false REFUSAL: both of these run the case and fail it, so
  // adding the contradictory spelling is not a weakening and must not be reported as one.
  it("does not refuse a suite that gained a neutralised conditional it never had", () => {
    const suite = `("s", () => { it("r", () => { expect(1).toBe(2); }); })`;
    const base = countAssertions({ content: `describe${suite};` });
    const head = countAssertions({ content: `describe.skip.skipIf(false)${suite};` });
    expect(weakenings({ base, deletedWithCode: [], head, path: "a.test.ts" })).toEqual([]);
  });

  // The element-access half, closed for the bare-string spelling only:
  // a parenthesis around the KEY read as a ParenthesizedExpression and the walk gave up, so `it[("only")]`
  // silenced every other case in its file while all four counts held still.
  it("reads an element-access modifier through a parenthesised key", () => {
    expect(countAssertions({ content: `it[("only")]("a", () => {});` }).focused).toBe(1);
    expect(countAssertions({ content: `it[("skip")]("a", () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `it[(("skip"))]("a", () => {});` }).skipped).toBe(1);
    expect(countAssertions({ content: `describe[("only")]("a", () => {});` }).focused).toBe(1);
  });

  it("still resolves no name for a computed key it cannot read", () => {
    expect(countAssertions({ content: `it[modifier]("a", () => {});` }).skipped).toBe(0);
    expect(countAssertions({ content: `it[modifier]("a", () => {});` }).focused).toBe(0);
  });

  it("counts one modifier per call when a chain and an option both carry one", () => {
    const counts = countAssertions({ content: `it.only("a", { skip: true }, () => {});` });
    expect(counts.focused).toBe(1);
    expect(counts.skipped).toBe(0);
  });

  it("does not read an options object that is not an argument of the suite call", () => {
    expect(countAssertions({ content: `it.each([{ skip: true }])("a", () => {});` }).skipped).toBe(0);
    expect(countAssertions({ content: `it("a", () => { const row = { skip: true }; });` }).skipped).toBe(0);
  });

  it("does not read options off a call that is not a suite function", () => {
    expect(countAssertions({ content: `queue("a", { skip: true }, () => {});` }).skipped).toBe(0);
  });

  // Object-property shorthand carries no initialiser to test, so `{ only }` is
  // counted on sight — the answer that cannot be wrong in the direction that matters.
  it("counts a modifier written as object-property shorthand", () => {
    expect(countAssertions({ content: `it("a", { only }, () => {});` }).focused).toBe(1);
    expect(countAssertions({ content: `it("a", { skip }, () => {});` }).skipped).toBe(1);
  });

  it("does not resolve a spread it cannot follow", () => {
    expect(countAssertions({ content: `it("a", { ...options }, () => {});` }).skipped).toBe(0);
  });

  // A tagged-template `.each` table invoked with an option combined two spellings
  // this counter handled apart. The root walk now treats a tag as the hop it is.
  it("counts an option on a tagged-template each table", () => {
    const content = 'it.each`a | b\n${1} | ${2}`("row", { skip: true }, () => {});';
    expect(countAssertions({ content }).skipped).toBe(1);
  });

  it("counts an only option on a tagged-template each table", () => {
    const content = 'describe.each`a\n${1}`("row", { only: true }, () => {});';
    expect(countAssertions({ content }).focused).toBe(1);
  });

  it("does not read an option off a tagged template whose root is not a suite function", () => {
    const content = 'queue.each`a\n${1}`("row", { skip: true }, () => {});';
    expect(countAssertions({ content }).skipped).toBe(0);
  });

  it("returns four zeroes for an empty source", () => {
    expect(countAssertions({ content: "" })).toEqual({ expects: 0, focused: 0, skipped: 0, strong: 0 });
  });
});
