/**
 * The unnamed-failure-assertion gate's own tests. Three properties, and each is the rule rather than a
 * sample: the matcher catches the three refused spellings and nothing else; one other assertion anywhere in
 * the case body exempts it; and the count collapse is stable and ordered the way the committed debt list is
 * written. The ratchet this gate then judges against is `countRatchet.ts`, tested with the ratchet.
 *
 * The first case is the survey's own re-checked instance — a case titled for ONE refusal whose whole body is
 * `expect(result.isErr()).toBe(true)` — because a gate that did not catch the site it was ruled into
 * existence over would be worth nothing.
 */
import { describe, expect, it } from "vitest";
import { countsOf, isScannablePath, scanUnnamedFailureAssertions } from "../../../devLint/unnamedFailureAssertion.js";

/** Scan one snippet as if it were a test file, as `<line> <title>` pairs. */
function hits({ content }: { content: string }): readonly string[] {
  return scanUnnamedFailureAssertions({ content, path: "src/__tests__/unit/x.test.ts" }).map(
    (hit) => `${String(hit.line)} ${hit.title}`,
  );
}

/** A test case wrapping one body, as source text — the shape every fixture below is built from. */
function testCase({ title, body }: { title: string; body: string }): string {
  return `it("${title}", () => {\n  ${body}\n});\n`;
}

describe("scanUnnamedFailureAssertions — the shapes it must catch", () => {
  it("catches the survey's re-checked instance: a titled refusal proved only by isErr", () => {
    const content = testCase({
      body: "expect(result.isErr()).toBe(true);",
      title: "refuses a respond decision missing tier",
    });
    expect(hits({ content })).toEqual(['1 "refuses a respond decision missing tier"']);
  });

  it("catches the same claim spelled as an isOk negation", () => {
    const content = testCase({ body: "expect(result.isOk()).toBe(false);", title: "refuses it" });
    expect(hits({ content })).toEqual(['1 "refuses it"']);
  });

  it("catches the same claim spelled as a falsy ok field", () => {
    const content = testCase({ body: "expect(result.ok).toBe(false);", title: "refuses it" });
    expect(hits({ content })).toEqual(['1 "refuses it"']);
  });

  it("catches a case whose every assertion is a bare failure, however many there are", () => {
    const content = testCase({
      body: "expect(a.isErr()).toBe(true);\n  expect(b.ok).toBe(false);",
      title: "refuses both",
    });
    expect(hits({ content })).toEqual(['1 "refuses both"']);
  });

  it("catches a failure subject behind a wrapper that changes only its type", () => {
    const content = testCase({ body: "expect((result as Parsed).ok).toBe(false);", title: "refuses it" });
    expect(hits({ content })).toEqual(['1 "refuses it"']);
  });

  it("catches a bare failure inside a nested callback, which is still the case's only assertion", () => {
    const content = testCase({
      body: "for (const one of inputs) {\n    expect(parse(one).isErr()).toBe(true);\n  }",
      title: "refuses every malformed input",
    });
    expect(hits({ content })).toEqual(['1 "refuses every malformed input"']);
  });

  it("catches a case written with `test` rather than `it`, and one carrying a modifier", () => {
    const content = `test("a", () => {\n  expect(r.isErr()).toBe(true);\n});\nit.only("b", () => {\n  expect(r.isErr()).toBe(true);\n});\n`;
    expect(hits({ content })).toEqual(['1 "a"', '4 "b"']);
  });

  it("clips a title longer than the reporting cap so one finding stays one line", () => {
    const long = "refuses ".repeat(20).trim();
    const found = scanUnnamedFailureAssertions({
      content: testCase({ body: "expect(r.isErr()).toBe(true);", title: long }),
      path: "src/__tests__/unit/x.test.ts",
    });
    expect(found.length).toBe(1);
    expect(found[0]!.title.length).toBe(70);
    expect(found[0]!.title.endsWith("...")).toBe(true);
  });
});

describe("scanUnnamedFailureAssertions — what is outside the criterion", () => {
  it("passes a case that also names the failure", () => {
    const content = testCase({
      body: 'expect(result.isErr()).toBe(true);\n  expect(result._unsafeUnwrapErr().code).toBe("REPO_NOT_FOUND");',
      title: "refuses a missing repo",
    });
    expect(hits({ content })).toEqual([]);
  });

  it("passes a case that asserts anything else at all, which is where the rest of the claim sits", () => {
    const content = testCase({
      body: "expect(result.isErr()).toBe(true);\n  expect(written).toEqual([]);",
      title: "refuses and writes nothing",
    });
    expect(hits({ content })).toEqual([]);
  });

  it("passes a case asserting SUCCESS, which is the opposite claim", () => {
    const content = testCase({ body: "expect(result.isOk()).toBe(true);", title: "accepts it" });
    expect(hits({ content })).toEqual([]);
  });

  it("passes a truthy ok field, which says it succeeded", () => {
    const content = testCase({ body: "expect(result.ok).toBe(true);", title: "accepts it" });
    expect(hits({ content })).toEqual([]);
  });

  it("passes a negated matcher, which is a different claim this gate does not read", () => {
    const content = testCase({ body: "expect(result.isErr()).not.toBe(false);", title: "refuses it" });
    expect(hits({ content })).toEqual([]);
  });

  it("passes a rejects chain, for the same reason", () => {
    const content = testCase({ body: "await expect(run()).rejects.toBe(true);", title: "refuses it" });
    expect(hits({ content })).toEqual([]);
  });

  it("passes a case with no assertion at all, which is a different class the tree has none of", () => {
    const content = testCase({ body: "parse(input);", title: "does not throw" });
    expect(hits({ content })).toEqual([]);
  });

  it("passes a case that declares no body", () => {
    expect(hits({ content: 'it.todo("refuses a respond decision missing tier");\n' })).toEqual([]);
  });

  it("passes a bare failure asserted outside any case, which no runner reports", () => {
    expect(hits({ content: "expect(result.isErr()).toBe(true);\n" })).toEqual([]);
  });

  it("passes a describe block, which is not a case", () => {
    const content = 'describe("x", () => {\n  expect(r.isErr()).toBe(true);\n});\n';
    expect(hits({ content })).toEqual([]);
  });

  it("passes an isErr called with an argument, which is not the neverthrow reader", () => {
    const content = testCase({ body: "expect(isErr(result)).toBe(true);", title: "refuses it" });
    expect(hits({ content })).toEqual([]);
  });

  it("passes a toBe against anything other than a boolean literal", () => {
    const content = testCase({ body: "expect(result.ok).toBe(expected);", title: "refuses it" });
    expect(hits({ content })).toEqual([]);
  });
});

describe("countsOf — the debt list's own shape", () => {
  it("collapses a scan to one entry per file", () => {
    const scanned = [
      ...scanUnnamedFailureAssertions({
        content: `${testCase({ body: "expect(r.isErr()).toBe(true);", title: "a" })}${testCase({ body: "expect(r.isErr()).toBe(true);", title: "b" })}`,
        path: "src/__tests__/unit/b.test.ts",
      }),
      ...scanUnnamedFailureAssertions({
        content: testCase({ body: "expect(r.isErr()).toBe(true);", title: "c" }),
        path: "src/__tests__/unit/a.test.ts",
      }),
    ];
    expect(countsOf({ hits: scanned })).toEqual([
      { count: 1, path: "src/__tests__/unit/a.test.ts" },
      { count: 2, path: "src/__tests__/unit/b.test.ts" },
    ]);
  });

  it("collapses an empty scan to an empty list", () => {
    expect(countsOf({ hits: [] })).toEqual([]);
  });
});

describe("isScannablePath", () => {
  it("scans a test file under the source tree, in every lane", () => {
    expect(isScannablePath({ path: "src/__tests__/unit/store/ingest.test.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/__tests__/integration/calendar.test.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/__tests__/subprocess/replay/dispatch.test.ts" })).toBe(true);
  });

  it("does not scan source, a test helper, or a tree outside src", () => {
    expect(isScannablePath({ path: "src/store/ingest.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/__tests__/captureTransportFake.ts" })).toBe(false);
    expect(isScannablePath({ path: "eval/x.test.ts" })).toBe(false);
  });

  it("does not scan its own files, which quote every refused shape in their documentation", () => {
    expect(isScannablePath({ path: "src/devLint/unnamedFailureAssertion.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/unnamedFailureAssertion.entry.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/__tests__/unit/devLint/unnamedFailureAssertion.test.ts" })).toBe(false);
  });
});
