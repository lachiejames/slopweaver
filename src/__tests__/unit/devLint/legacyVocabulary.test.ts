/**
 * The legacy-vocabulary gate's own tests. Two halves, and the second is the load-bearing one: the gate must
 * catch a NAME this repository declares, and must not catch the prose that correctly describes a provider's
 * product or a file on disk — which is the whole reason the owner asked for a scoped criterion rather than a
 * word ban.
 */
import { describe, expect, it } from "vitest";
import { isScannablePath, namesLegacy, scanLegacyVocabulary } from "../../../devLint/legacyVocabulary.js";

/** Scan one snippet as if it were a source file whose own name is innocent. */
function names({ content }: { content: string }): readonly string[] {
  return scanLegacyVocabulary({ content, path: "src/x.ts" }).map((hit) => hit.name);
}

describe("scanLegacyVocabulary — the names it must catch", () => {
  it("catches a function declaration", () => {
    expect(names({ content: "function parseLegacyRow(): void {}\n" })).toEqual(["parseLegacyRow"]);
  });

  it("catches an interface, and separately its offending property signature", () => {
    expect(names({ content: "interface LegacyRow {\n  readonly legacyField: string;\n}\n" })).toEqual([
      "LegacyRow",
      "legacyField",
    ]);
  });

  it("catches a type alias and the string literal arm of a union it declares", () => {
    expect(names({ content: 'type LegacyQuality = "exact" | "legacy";\n' })).toEqual(["LegacyQuality", "legacy"]);
  });

  it("catches a const, a let and a parameter", () => {
    expect(names({ content: "const legacyA = 1;\nlet legacyB = 2;\nfunction f(legacyC: number): void {}\n" })).toEqual([
      "legacyA",
      "legacyB",
      "legacyC",
    ]);
  });

  it("catches a property assignment's key in an object literal", () => {
    expect(names({ content: "const x = { legacy: 0 };\n" })).toEqual(["legacy"]);
  });

  it("catches a hyphenated type-position literal, which a caller has to spell exactly", () => {
    expect(names({ content: 'type Outcome = "posted" | "legacy-unknown";\n' })).toEqual(["legacy-unknown"]);
  });

  it("catches the plural, and catches any casing", () => {
    expect(names({ content: "const LEGACIES = 1;\nconst Legacy_Thing = 2;\n" })).toEqual(["LEGACIES", "Legacy_Thing"]);
  });

  it("reports a file whose own NAME says legacy, on line 1, before anything inside it", () => {
    const hits = scanLegacyVocabulary({ content: "const ok = 1;\n", path: "src/x/legacyRepair.ts" });
    expect(hits).toEqual([{ line: 1, name: "legacyRepair.ts", path: "src/x/legacyRepair.ts" }]);
  });
});

describe("scanLegacyVocabulary — the shapes it must NOT catch", () => {
  it("reads no prose at all, so a comment naming a provider product is invisible", () => {
    const content = "// Cloudflare's Legacy WAF, and the legacy combined `.watermark.json` on disk.\nconst x = 1;\n";
    expect(names({ content })).toEqual([]);
  });

  it("ignores a JSDoc block naming a legacy record, which describes data rather than code", () => {
    expect(names({ content: "/** Read a legacy row. */\nexport function readRow(): void {}\n" })).toEqual([]);
  });

  it("ignores an IMPORT, because the fix belongs in the one file that declares the name", () => {
    expect(names({ content: 'import { parseLegacyRow } from "./a.js";\n' })).toEqual([]);
  });

  it("ignores a string literal in VALUE position — the declaration is the site to fix", () => {
    expect(names({ content: 'const q: string = "legacy";\nconst m = { kind: "legacy" as string };\n' })).toEqual([]);
  });

  it("ignores a string-literal member key naming a PATH, which names a file rather than a construct", () => {
    expect(names({ content: 'const seams = { "src/x/legacyRepair.ts": "ok" };\n' })).toEqual([]);
  });

  it("ignores a name that merely contains a similar run of letters", () => {
    expect(names({ content: "const delegates = 1;\nconst lega = 2;\n" })).toEqual([]);
  });
});

/*
 * The gate's own blind spots, as witnesses rather than a paragraph. The module header NAMES every one of
 * these as out of reach, and a named blind spot that nothing pins rots into a claim the next reader
 * believes. That happened once: the header said the walk covered "an import
 * alias" while `isJudgedDeclaration` carries no import kind at all. Each case below feeds a name this
 * repository would be CHOOSING and asserts the empty result, so widening the walk turns one of these red
 * instead of leaving the header quietly false.
 */
describe("scanLegacyVocabulary — the declaration shapes it does NOT reach yet", () => {
  it("misses every import shape, because the walk carries no import declaration kind", () => {
    expect(names({ content: 'import { readFileSync as legacyRead } from "node:fs";\n' })).toEqual([]);
    expect(names({ content: 'import * as legacyFs from "node:fs";\n' })).toEqual([]);
    expect(names({ content: 'import legacyFs = require("node:fs");\n' })).toEqual([]);
    expect(names({ content: 'import { readFileSync } from "node:fs";\nconst legacyRead = readFileSync;\n' })).toEqual([
      "legacyRead",
    ]);
  });

  it("misses a destructuring binding element, though the same name as a plain const is caught", () => {
    expect(names({ content: "const { value: legacyValue } = x;\n" })).toEqual([]);
    expect(names({ content: "const legacyValue = x.value;\n" })).toEqual(["legacyValue"]);
  });

  it("misses a getter and a setter, though an ordinary method of the same name is caught", () => {
    expect(names({ content: "class C {\n  get legacyValue(): number {\n    return 1;\n  }\n}\n" })).toEqual([]);
    expect(names({ content: "class C {\n  set legacyValue(next: number) {}\n}\n" })).toEqual([]);
    expect(names({ content: "class C {\n  legacyValue(): number {\n    return 1;\n  }\n}\n" })).toEqual([
      "legacyValue",
    ]);
  });

  it("misses a named function or class EXPRESSION, though the declaration form is caught", () => {
    expect(names({ content: "const f = function legacyInner(): void {};\n" })).toEqual([]);
    expect(names({ content: "const g = class LegacyInner {};\n" })).toEqual([]);
    expect(names({ content: "function legacyInner(): void {}\nclass LegacyInner {}\n" })).toEqual([
      "legacyInner",
      "LegacyInner",
    ]);
  });

  it("misses a QUOTED property declaration, though the unquoted spelling is caught", () => {
    expect(names({ content: 'interface X {\n  "legacyValue": number;\n}\n' })).toEqual([]);
    expect(names({ content: "interface Y {\n  legacyValue: number;\n}\n" })).toEqual(["legacyValue"]);
  });

  it("misses a QUOTED enum member too, so walking ts.isEnumMember buys the unquoted spelling alone", () => {
    expect(names({ content: 'enum Mode {\n  "legacy" = 0,\n}\n' })).toEqual([]);
    expect(names({ content: "enum Mode {\n  legacy = 0,\n}\n" })).toEqual(["legacy"]);
  });
});

describe("namesLegacy", () => {
  it("matches the singular and the plural, case-insensitively, anywhere in the name", () => {
    expect(namesLegacy({ name: "parseLegacyAskRow" })).toBe(true);
    expect(namesLegacy({ name: "LEGACIES" })).toBe(true);
    expect(namesLegacy({ name: "legacy-unlinked" })).toBe(true);
  });

  it("does not match a name that only shares a prefix", () => {
    expect(namesLegacy({ name: "delegate" })).toBe(false);
    expect(namesLegacy({ name: "legal" })).toBe(false);
  });
});

/*
 * Cloudflare's product is called Legacy WAF, and the owner ruled the name stays. The carve-out is the
 * product token itself, so each edge below is a spelling a reader would otherwise have to guess at.
 */
describe("namesLegacy — Cloudflare's Legacy WAF is the product's own name", () => {
  it.each([
    "legacyWaf.ts",
    "legacyWafSync.ts",
    "CloudflareLegacyWafChildItem",
    "extractCloudflareLegacyWafChildren",
    "legacy-waf",
    "legacy_waf_sync",
    "LEGACY_WAF",
  ])("reads %s as the product, not as this repository calling itself legacy", (name) => {
    expect(namesLegacy({ name })).toBe(false);
  });

  it.each(["legacyWafer", "legacyWafish", "legacyWaffle", "legaciesWaf", "legacyWafLegacyRow", "legacyRow"])(
    "still refuses %s, which is not the product token alone",
    (name) => {
      expect(namesLegacy({ name })).toBe(true);
    },
  );

  it("still catches a declaration that mentions the product beside another legacy word", () => {
    expect(names({ content: "const legacyWafLegacyRow = 1;\nconst legacyWafRow = 2;\n" })).toEqual([
      "legacyWafLegacyRow",
    ]);
  });
});

describe("scanLegacyVocabulary — a quoted key is data, the same key unquoted is a name", () => {
  it("passes a quoted provider wire key and catches the identical key written bare", () => {
    expect(names({ content: 'const shape = { "rum_browser_legacy_session_count": 1 };\n' })).toEqual([]);
    expect(names({ content: "const shape = { rum_browser_legacy_session_count: 1 };\n" })).toEqual([
      "rum_browser_legacy_session_count",
    ]);
  });
});

describe("isScannablePath", () => {
  it("scans a source file under one of the declared trees", () => {
    expect(isScannablePath({ path: "src/admit/queue.ts" })).toBe(true);
    expect(isScannablePath({ path: "hooks/pretooluse.ts" })).toBe(true);
  });

  it("skips a test, the test tree, a non-TypeScript file, and this gate's own files", () => {
    expect(isScannablePath({ path: "src/admit/queue.test.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/__tests__/unit/admit/queue.test.ts" })).toBe(false);
    expect(isScannablePath({ path: "docs/constraints.md" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/legacyVocabulary.ts" })).toBe(false);
  });

  it("skips a generated provider boundary: beneath src/atlas/, with a whole `generated` segment", () => {
    expect(isScannablePath({ path: "src/atlas/datadog/generated/responseBoundaries1.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/atlas/jumpcloud/generated/responseBoundaries1.ts" })).toBe(false);
  });

  it("still scans the generator itself, a generated folder outside src/atlas/, and a near-miss segment", () => {
    expect(isScannablePath({ path: "src/atlas/datadog/responseCodegen.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/generated/x.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/atlas/x/notgenerated/y.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/atlas/x/generated.ts" })).toBe(true);
  });
});
