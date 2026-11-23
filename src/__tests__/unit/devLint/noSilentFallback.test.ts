/**
 * The no-silent-fallback gate's own tests. Three properties, and each is the rule rather than a sample:
 * the matcher catches the five refused spellings — the fifth a call to a pass-through fallback helper — and nothing else; the count collapse is stable and ordered
 * the way the committed debt list is written; and the ratchet refuses a new or grown entry while never
 * refusing one that shrank.
 *
 * The first case is the owner's own line — `displayName: author.handle ?? author.nativeId` — because a gate
 * that did not catch the site it was ruled into existence over would be worth nothing.
 */
import { describe, expect, it } from "vitest";
import { fallbackHelperExports } from "../../../devLint/fallbackHelpers.js";
import {
  countsOf,
  type FallbackCount,
  isScannablePath,
  parseBaselineJson,
  regressionsOf,
  scanNoSilentFallback,
  worseningsOf,
} from "../../../devLint/noSilentFallback.js";
import { type FallbackOperator } from "../../../devLint/noSilentFallbackOperators.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** Scan one snippet as if it were a source file, as `<line> <operator>` pairs. */
function hits({ content }: { content: string }): readonly string[] {
  return scanNoSilentFallback({ content, path: "src/x.ts" }).map((hit) => `${String(hit.line)} ${hit.operator}`);
}

/** One counted pair, for building a debt list in a test. */
function site({ path, operator, count }: { path: string; operator: FallbackOperator; count: number }): FallbackCount {
  return { count, operator, path };
}

describe("scanNoSilentFallback — the shapes it must catch", () => {
  it("catches the owner's own line: a display name falling back to a platform id", () => {
    expect(hits({ content: "const displayName = author.handle ?? author.nativeId;\n" })).toEqual(["1 ??"]);
  });

  it("catches a nullish coalesce whatever its right operand is", () => {
    expect(hits({ content: "const a = x ?? [];\nconst b = y ?? null;\nconst c = z ?? 0;\n" })).toEqual([
      "1 ??",
      "2 ??",
      "3 ??",
    ]);
  });

  it("catches the nullish coalescing assignment", () => {
    expect(hits({ content: "state.title ??= text();\n" })).toEqual(["1 ??="]);
  });

  it("catches the logical OR assignment", () => {
    expect(hits({ content: "state.title ||= text();\n" })).toEqual(["1 ||="]);
  });

  it("catches a logical OR falling back to a string literal", () => {
    expect(hits({ content: 'const label = parts.join(".") || "<root>";\n' })).toEqual(["1 ||-literal"]);
  });

  it("catches a logical OR falling back to a number, an array, an object or a template", () => {
    const content = "const a = x || 1;\nconst b = x || [];\nconst c = x || {};\nconst d = x || `n-${id}`;\n";
    expect(hits({ content })).toEqual(["1 ||-literal", "2 ||-literal", "3 ||-literal", "4 ||-literal"]);
  });

  it("catches a logical OR whose literal fallback is parenthesised, even twice", () => {
    expect(hits({ content: 'const label = name || (("-"));\n' })).toEqual(["1 ||-literal"]);
  });

  it("catches a literal fallback behind a wrapper that changes only its type", () => {
    const content = 'const a = x || ("-" as const);\nconst b = x || ("-" satisfies string);\n';
    expect(hits({ content })).toEqual(["1 ||-literal", "2 ||-literal"]);
  });

  it("catches a negated number literal, because the sign is part of the number a reader sees", () => {
    expect(hits({ content: "const index = found || -1;\n" })).toEqual(["1 ||-literal"]);
  });

  it("catches a coalesce wherever an expression may sit — a default parameter, a class field, an as-cast", () => {
    const content = "function f(a = b ?? c): void {}\nclass K {\n  x = d ?? e;\n}\nconst y = (g ?? h) as string;\n";
    expect(hits({ content })).toEqual(["1 ??", "3 ??", "5 ??"]);
  });

  it("catches each arm of a chained coalesce, because each one substitutes independently", () => {
    expect(hits({ content: "const x = a ?? b ?? c;\n" })).toEqual(["1 ??", "1 ??"]);
  });

  it("reports the expression's own starting line when it wraps", () => {
    expect(hits({ content: "const x =\n  author.handle ??\n  author.nativeId;\n" })).toEqual(["2 ??"]);
  });
});

describe("scanNoSilentFallback — the shapes it must NOT catch", () => {
  it("allows a logical OR whose right operand is a comparison — a boolean condition, not a fallback", () => {
    expect(hits({ content: "if (raw === undefined || raw === null) {\n  return;\n}\n" })).toEqual([]);
  });

  it("allows a logical OR whose right operand is a predicate call", () => {
    expect(hits({ content: 'const ok = s.startsWith("{") || s.endsWith("}");\n' })).toEqual([]);
  });

  it("allows a logical OR whose right operand is a negation", () => {
    expect(hits({ content: "const bad = size > cap || !pattern.test(name);\n" })).toEqual([]);
  });

  it("allows a logical OR falling back to an identifier — the stated blind spot, not a false negative bug", () => {
    expect(hits({ content: "const name = handle || fallbackName;\n" })).toEqual([]);
  });

  it("allows a logical OR falling back to an ASSERTED identifier — stripping the cast leaves a name", () => {
    expect(hits({ content: "const name = handle || (fallbackName as string);\n" })).toEqual([]);
  });

  it("allows a logical OR falling back to a negated identifier or a tagged template, neither a literal", () => {
    expect(hits({ content: "const a = x || -y;\nconst b = x || tag`z`;\n" })).toEqual([]);
  });

  it("allows a logical OR falling back to `null`, `undefined` or a boolean keyword", () => {
    expect(hits({ content: "const a = x || null;\nconst b = x || undefined;\nconst c = x || true;\n" })).toEqual([]);
  });

  it("allows optional chaining, which propagates the absence instead of substituting a value", () => {
    expect(hits({ content: "const id = author?.identity?.nativeId;\n" })).toEqual([]);
  });

  it("allows a logical AND, which never supplies a value for an absent one", () => {
    expect(hits({ content: "const ok = a && b;\n" })).toEqual([]);
  });

  it("allows an explicit undefined check, which is the correction the refusal names", () => {
    const content = "let name = author.handle;\nif (name === undefined) {\n  throw new Error('no handle');\n}\n";
    expect(hits({ content })).toEqual([]);
  });

  it("allows a destructured default, the other correction the refusal names", () => {
    expect(hits({ content: 'function f({ cwd = "." }: { cwd?: string }): string {\n  return cwd;\n}\n' })).toEqual([]);
  });
});

describe("countsOf", () => {
  it("collapses repeated sites in one file into one entry per operator", () => {
    const scanned = scanNoSilentFallback({
      content: 'const a = x ?? 1;\nconst b = y ?? 2;\nconst c = z || "-";\n',
      path: "src/a.ts",
    });
    expect(countsOf({ hits: scanned })).toEqual([
      { count: 2, operator: "??", path: "src/a.ts" },
      { count: 1, operator: "||-literal", path: "src/a.ts" },
    ]);
  });

  it("is empty for a file with no refused site", () => {
    expect(countsOf({ hits: [] })).toEqual([]);
  });

  it("sorts by path, then by operator in the declared order", () => {
    const scanned = [
      ...scanNoSilentFallback({ content: 'const c = z || "-";\n', path: "src/b.ts" }),
      ...scanNoSilentFallback({ content: "const a = x ?? 1;\n", path: "src/b.ts" }),
      ...scanNoSilentFallback({ content: "const a = x ?? 1;\n", path: "src/a.ts" }),
    ];
    expect(countsOf({ hits: scanned }).map((one) => `${one.path} ${one.operator}`)).toEqual([
      "src/a.ts ??",
      "src/b.ts ??",
      "src/b.ts ||-literal",
    ]);
  });
});

describe("regressionsOf — the ratchet", () => {
  const baseline = { sites: [site({ count: 2, operator: "??", path: "src/a.ts" })] };

  it("holds when a file matches its debt entry exactly", () => {
    const current = [site({ count: 2, operator: "??", path: "src/a.ts" })];
    expect(regressionsOf({ baseline, current })).toEqual([]);
  });

  it("holds when a file has FEWER sites than its debt entry", () => {
    const current = [site({ count: 1, operator: "??", path: "src/a.ts" })];
    expect(regressionsOf({ baseline, current })).toEqual([]);
  });

  it("holds when a file's sites are gone entirely", () => {
    expect(regressionsOf({ baseline, current: [] })).toEqual([]);
  });

  it("refuses a file whose count grew past its debt entry, and names the floor", () => {
    const current = [site({ count: 3, operator: "??", path: "src/a.ts" })];
    expect(regressionsOf({ baseline, current })).toEqual([
      { baselineCount: 2, count: 3, operator: "??", path: "src/a.ts" },
    ]);
  });

  it("refuses a file absent from the debt list, with no floor", () => {
    const current = [site({ count: 1, operator: "??", path: "src/new.ts" })];
    expect(regressionsOf({ baseline, current })).toEqual([
      { baselineCount: undefined, count: 1, operator: "??", path: "src/new.ts" },
    ]);
  });

  it("refuses a DIFFERENT operator in a file that already has a debt entry for another", () => {
    const current = [
      site({ count: 2, operator: "??", path: "src/a.ts" }),
      site({ count: 1, operator: "||-literal", path: "src/a.ts" }),
    ];
    expect(regressionsOf({ baseline, current })).toEqual([
      { baselineCount: undefined, count: 1, operator: "||-literal", path: "src/a.ts" },
    ]);
  });
});

describe("worseningsOf — what a rebaseline refuses", () => {
  it("refuses an entry that grew", () => {
    const regressions = [{ baselineCount: 2, count: 3, operator: "??" as const, path: "src/a.ts" }];
    expect(worseningsOf({ regressions })).toEqual(regressions);
  });

  it("allows a brand-new entry, which widens the list rather than an entry", () => {
    const regressions = [{ baselineCount: undefined, count: 1, operator: "??" as const, path: "src/new.ts" }];
    expect(worseningsOf({ regressions })).toEqual([]);
  });
});

describe("parseBaselineJson", () => {
  it("decodes a well-formed debt list", () => {
    const text = '{ "sites": [{ "path": "src/a.ts", "operator": "??", "count": 2 }] }';
    const parsed = parseBaselineJson({ text });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).sites).toEqual([{ count: 2, operator: "??", path: "src/a.ts" }]);
  });

  it("decodes an empty debt list, which is how a fresh one is seeded", () => {
    const parsed = parseBaselineJson({ text: '{ "sites": [] }' });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).sites).toEqual([]);
  });

  it("refuses an operator label outside the five the gate can produce", () => {
    const text = '{ "sites": [{ "path": "src/a.ts", "operator": "?.", "count": 1 }] }';
    const parsed = parseBaselineJson({ text });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().message).toBe(
      "no-silent-fallback debt list: unexpected shape (expected { sites: [{ path, operator, count }] })",
    );
  });

  it("refuses a negative count", () => {
    const text = '{ "sites": [{ "path": "src/a.ts", "operator": "??", "count": -1 }] }';
    expect(unwrapErr(parseBaselineJson({ text })).message).toBe(
      "no-silent-fallback debt list: unexpected shape (expected { sites: [{ path, operator, count }] })",
    );
  });

  it("refuses text that is not JSON at all", () => {
    const parsed = parseBaselineJson({ text: "not json" });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().message).toBe("no-silent-fallback debt list: invalid JSON");
  });
});

describe("isScannablePath", () => {
  it("scans the source trees, tests included", () => {
    expect(isScannablePath({ path: "src/store/ingest.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/__tests__/unit/store/ingest.test.ts" })).toBe(true);
    expect(isScannablePath({ path: "eval/x.ts" })).toBe(true);
    expect(isScannablePath({ path: "hooks/y.ts" })).toBe(true);
  });

  it("does not scan its own source, which quotes every banned shape in its documentation", () => {
    expect(isScannablePath({ path: "src/devLint/noSilentFallback.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/noSilentFallback.entry.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/__tests__/unit/devLint/noSilentFallback.test.ts" })).toBe(false);
  });

  it("does not scan a document or a non-TypeScript file", () => {
    expect(isScannablePath({ path: "src/README.md" })).toBe(false);
    expect(isScannablePath({ path: "docs/architecture.md" })).toBe(false);
  });
});

/** An in-memory `src/lib/absent.ts`: two pass-through helpers and the four-statement spelling that is not one. */
const ABSENT = [
  "export function absentAsNull<T>({ value }: { value: T | undefined }): T | null {",
  "  if (value === undefined) {",
  "    return null;",
  "  }",
  "  return value;",
  "}",
  "export function absentAs({ value, whenAbsent }: { value: string | null | undefined; whenAbsent: string }): string {",
  "  if (value === null || value === undefined) {",
  "    return whenAbsent;",
  "  }",
  "  return value;",
  "}",
  "export function unsetFieldAsNull<R extends object, K extends keyof R>({ record, key }: { record: R | null | undefined; key: K }): Exclude<R[K], undefined> | null {",
  "  if (record === null || record === undefined) {",
  "    return null;",
  "  }",
  "  const value = record[key];",
  "  if (value === undefined) {",
  "    return null;",
  "  }",
  "  return value as Exclude<R[K], undefined>;",
  "}",
  "",
].join("\n");

/** The tree's helper map when the only module in it is {@link ABSENT}. */
const ABSENT_EXPORTS = fallbackHelperExports({ files: [{ content: ABSENT, path: "src/lib/absent.ts" }] });

/** Scan one snippet against {@link ABSENT_EXPORTS}, as `<line> <operator>` pairs. */
function helperHits({ content, path }: { content: string; path: string }): readonly string[] {
  return scanNoSilentFallback({ content, helperExports: ABSENT_EXPORTS, path }).map(
    (hit) => `${String(hit.line)} ${hit.operator}`,
  );
}

describe("fallbackHelperExports — which exported functions are pass-through fallback helpers", () => {
  it("names the two helpers and not the four-statement unsetFieldAsNull", () => {
    expect(ABSENT_EXPORTS).toEqual(new Map([["src/lib/absent.ts", new Set(["absentAsNull", "absentAs"])]]));
  });

  it("records no module that exports no helper", () => {
    const files = [
      { content: "export function f({ a }: { a: string }): string {\n  return a;\n}\n", path: "src/f.ts" },
    ];
    expect(fallbackHelperExports({ files })).toEqual(new Map());
  });
});

describe("scanNoSilentFallback — a call to a pass-through fallback helper", () => {
  it("counts a named import from #lib/absent.js, and names the call it counted", () => {
    const content = 'import { absentAsNull } from "#lib/absent.js";\nconst a = absentAsNull({ value: raw.name });\n';
    expect(helperHits({ content, path: "src/atlas/x.ts" })).toEqual(["2 fallback-helper"]);
    expect(scanNoSilentFallback({ content, helperExports: ABSENT_EXPORTS, path: "src/atlas/x.ts" })[0]!.text).toBe(
      "absentAsNull({ value: raw.name })",
    );
  });

  it("counts an aliased import reached by a relative specifier", () => {
    const content =
      'import { absentAs as wordFor } from "../../lib/absent.js";\nconst a = wordFor({ value: s, whenAbsent: "-" });\n';
    expect(helperHits({ content, path: "src/atlas/cloudflare/x.ts" })).toEqual(["2 fallback-helper"]);
  });

  it("counts a call through a namespace import", () => {
    const content = 'import * as absent from "#lib/absent.js";\nconst a = absent.absentAsNull({ value: raw.name });\n';
    expect(helperHits({ content, path: "src/atlas/x.ts" })).toEqual(["2 fallback-helper"]);
  });

  it("counts a same-file generic copy, whatever it is named", () => {
    const content =
      "function orNull<T>(v: T | undefined): T | null {\n  if (v === undefined) return null;\n  return v;\n}\nconst a = orNull(x);\n";
    expect(hits({ content })).toEqual(["5 fallback-helper"]);
  });

  it("counts a same-file copy whose if returns a caller-supplied substitute", () => {
    const content = [
      "function orDefault({ value, fallback }: { value: string | null | undefined; fallback: string }): string {",
      "  if (value == null) {",
      "    return fallback;",
      "  }",
      "  return value;",
      "}",
      'const a = orDefault({ fallback: "-", value: x });',
      "",
    ].join("\n");
    expect(hits({ content })).toEqual(["7 fallback-helper"]);
  });

  it("counts an exported copy called from a second file", () => {
    const declaring =
      "export function orNull<T>(v: T | undefined): T | null {\n  if (v === undefined) {\n    return null;\n  }\n  return v;\n}\n";
    const calling = 'import { orNull } from "./boardRow.js";\nconst a = orNull(row.title);\n';
    const helperExports = fallbackHelperExports({
      files: [
        { content: declaring, path: "src/store/fleet/boardRow.ts" },
        { content: calling, path: "src/store/fleet/render.ts" },
      ],
    });
    const found = scanNoSilentFallback({ content: calling, helperExports, path: "src/store/fleet/render.ts" });
    expect(found.map((hit) => `${String(hit.line)} ${hit.operator}`)).toEqual(["2 fallback-helper"]);
  });

  it("counts a copy exported through a local export list, under its exported name", () => {
    const declaring = [
      "function orZ<T>(v: T | undefined): T | null {",
      "  if (v === undefined) {",
      "    return null;",
      "  }",
      "  return v;",
      "}",
      "export { orZ, orZ as orNothing };",
      "",
    ].join("\n");
    const calling = 'import { orZ, orNothing } from "./c.js";\nconst a = orZ(x);\nconst b = orNothing(y);\n';
    const helperExports = fallbackHelperExports({
      files: [
        { content: declaring, path: "src/a/c.ts" },
        { content: calling, path: "src/a/d.ts" },
      ],
    });
    expect(helperExports).toEqual(new Map([["src/a/c.ts", new Set(["orZ", "orNothing"])]]));
    const found = scanNoSilentFallback({ content: calling, helperExports, path: "src/a/d.ts" });
    expect(found.map((hit) => `${String(hit.line)} ${hit.operator}`)).toEqual([
      "2 fallback-helper",
      "3 fallback-helper",
    ]);
  });

  it("does not export a top-level non-helper because a nested helper shares its name", () => {
    const declaring = [
      "function pick({ x }: { x: number }): number {",
      "  return x * 2;",
      "}",
      "function outer(): void {",
      "  function pick<T>(v: T | undefined): T | null {",
      "    if (v === undefined) {",
      "      return null;",
      "    }",
      "    return v;",
      "  }",
      "  pick(undefined);",
      "}",
      "export { pick, outer };",
      "",
    ].join("\n");
    expect(fallbackHelperExports({ files: [{ content: declaring, path: "src/a/c.ts" }] })).toEqual(new Map());
  });

  it("does not treat a helper declared in a module-scope loop header as exportable by a list", () => {
    const declaring = [
      "function pick({ x }: { x: number }): number {",
      "  return x * 2;",
      "}",
      "for (const pick = <T,>(v: T | undefined): T | null => {",
      "  if (v === undefined) {",
      "    return null;",
      "  }",
      "  return v;",
      "}; ; ) {",
      "  break;",
      "}",
      "export { pick };",
      "",
    ].join("\n");
    expect(fallbackHelperExports({ files: [{ content: declaring, path: "src/a/c.ts" }] })).toEqual(new Map());
  });

  it("exports an export-default helper as default, not under its local name", () => {
    const declaring = [
      "export default function pick<T>(v: T | undefined): T | null {",
      "  if (v === undefined) {",
      "    return null;",
      "  }",
      "  return v;",
      "}",
      "function other({ x }: { x: number }): number {",
      "  return x * 2;",
      "}",
      "export { other as pick };",
      "",
    ].join("\n");
    expect(fallbackHelperExports({ files: [{ content: declaring, path: "src/a/c.ts" }] })).toEqual(
      new Map([["src/a/c.ts", new Set(["default"])]]),
    );
  });

  it("does not count a generic function whose absent branch returns a call, which may throw", () => {
    const content = [
      "function required<T>(v: T | undefined): T {",
      "  if (v === undefined) {",
      '    return fail({ why: "v is required" });',
      "  }",
      "  return v;",
      "}",
      "const a = required(x);",
      "",
    ].join("\n");
    expect(hits({ content })).toEqual([]);
  });

  it("does not count a resolveHome-shaped function, whose substitute is a call", () => {
    const content = [
      "function resolveHome({ named }: { named: string | undefined }): string {",
      "  if (named === undefined) {",
      "    return slopweaverHome();",
      "  }",
      "  return named;",
      "}",
      "const h = resolveHome({ named: x });",
      "",
    ].join("\n");
    expect(hits({ content })).toEqual([]);
  });

  it("does not count a domain function returning a fresh object literal", () => {
    const content = [
      "function heldManifest({ manifest }: { manifest: Manifest | null }): Manifest {",
      "  if (manifest == null) {",
      "    return { kinds: {} };",
      "  }",
      "  return manifest;",
      "}",
      "const m = heldManifest({ manifest });",
      "",
    ].join("\n");
    expect(hits({ content })).toEqual([]);
  });

  it("does not count unsetFieldAsNull, imported or declared in the same file", () => {
    const content =
      'import { unsetFieldAsNull } from "#lib/absent.js";\nconst a = unsetFieldAsNull({ key: "name", record: raw });\n';
    expect(helperHits({ content, path: "src/atlas/x.ts" })).toEqual([]);
    expect(hits({ content: `${ABSENT}const b = unsetFieldAsNull({ key: "name", record: raw });\n` })).toEqual([]);
  });

  it("does not count a function whose if carries an else", () => {
    const content =
      "function pick<T>(v: T | undefined): T | null {\n  if (v === undefined) {\n    return null;\n  } else {\n    log(v);\n  }\n  return v;\n}\nconst a = pick(x);\n";
    expect(hits({ content })).toEqual([]);
  });

  it("does not count an import of a module that exports no helper", () => {
    const content = 'import { absentAsNull } from "#lib/other.js";\nconst a = absentAsNull({ value: raw.name });\n';
    expect(helperHits({ content, path: "src/atlas/x.ts" })).toEqual([]);
  });
});

describe("the ratchet admits a first fallback-helper pair", () => {
  it("parses a debt entry labelled fallback-helper", () => {
    const text = '{ "sites": [{ "path": "src/a.ts", "operator": "fallback-helper", "count": 3 }] }';
    expect(unwrap(parseBaselineJson({ text })).sites).toEqual([
      { count: 3, operator: "fallback-helper", path: "src/a.ts" },
    ]);
  });

  it("reports the new pair as a regression the rebaseline does not refuse", () => {
    const baseline = { sites: [site({ count: 2, operator: "??", path: "src/a.ts" })] };
    const current = [
      site({ count: 2, operator: "??", path: "src/a.ts" }),
      site({ count: 3, operator: "fallback-helper", path: "src/a.ts" }),
    ];
    const regressions = regressionsOf({ baseline, current });
    expect(regressions).toEqual([
      { baselineCount: undefined, count: 3, operator: "fallback-helper", path: "src/a.ts" },
    ]);
    expect(worseningsOf({ regressions })).toEqual([]);
  });

  it("sorts a fallback-helper pair after every operator pair in the same file", () => {
    const scanned = scanNoSilentFallback({
      content:
        "function orNull<T>(v: T | undefined): T | null {\n  if (v === undefined) return null;\n  return v;\n}\nconst a = orNull(x) ?? 1;\n",
      path: "src/a.ts",
    });
    expect(countsOf({ hits: scanned })).toEqual([
      { count: 1, operator: "??", path: "src/a.ts" },
      { count: 1, operator: "fallback-helper", path: "src/a.ts" },
    ]);
  });
});
