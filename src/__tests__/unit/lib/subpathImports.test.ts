import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseJson } from "#lib/jsonParse.js";
import { isRecord } from "#lib/parsers.js";
import { unwrap } from "#lib/result.js";
import { isInternalSpecifier, resolveSubpathImport, SUBPATH_IMPORT_ROOTS } from "#lib/subpathImports.js";

/** The real manifest, read rather than imported — `package.json` sits outside `rootDir`. */
function manifestImports(): Record<string, unknown> {
  const text = readFileSync(fileURLToPath(new URL("../../../../package.json", import.meta.url)), "utf8");
  const parsed = unwrap(parseJson({ text }));
  const manifest = isRecord(parsed) ? parsed : {};
  const imports = manifest["imports"];
  return isRecord(imports) ? imports : {};
}

describe("SUBPATH_IMPORT_ROOTS", () => {
  it("mirrors package.json's own imports field, entry for entry", () => {
    const mirrored = Object.fromEntries(
      SUBPATH_IMPORT_ROOTS.map(({ prefix, target }) => [`${prefix}*`, `./${target}*`]),
    );

    expect(mirrored).toStrictEqual(manifestImports());
  });

  it("declares the lib root", () => {
    expect([...SUBPATH_IMPORT_ROOTS]).toStrictEqual([{ prefix: "#lib/", target: "src/lib/" }]);
  });
});

describe("resolveSubpathImport", () => {
  it("resolves a declared root to its repo-relative path", () => {
    expect(resolveSubpathImport({ specifier: "#lib/result.js" })).toBe("src/lib/result.js");
  });

  it("keeps a nested segment under the root", () => {
    expect(resolveSubpathImport({ specifier: "#lib/nested/deep.js" })).toBe("src/lib/nested/deep.js");
  });

  it("returns undefined for an undeclared root", () => {
    expect(resolveSubpathImport({ specifier: "#corpus/types.js" })).toBe(undefined);
  });

  it("returns undefined for a relative specifier", () => {
    expect(resolveSubpathImport({ specifier: "../../lib/result.js" })).toBe(undefined);
  });

  it("returns undefined for a bare package name", () => {
    expect(resolveSubpathImport({ specifier: "neverthrow" })).toBe(undefined);
  });

  it("returns undefined for the bare prefix with nothing after it", () => {
    expect(resolveSubpathImport({ specifier: "#lib" })).toBe(undefined);
  });
});

describe("isInternalSpecifier", () => {
  it("accepts a relative specifier", () => {
    expect(isInternalSpecifier({ specifier: "../../lib/result.js" })).toBe(true);
  });

  it("accepts a same-directory specifier", () => {
    expect(isInternalSpecifier({ specifier: "./result.js" })).toBe(true);
  });

  it("accepts a declared subpath import", () => {
    expect(isInternalSpecifier({ specifier: "#lib/result.js" })).toBe(true);
  });

  it("rejects a bare package name", () => {
    expect(isInternalSpecifier({ specifier: "node:fs" })).toBe(false);
  });

  it("rejects an undeclared subpath root", () => {
    expect(isInternalSpecifier({ specifier: "#corpus/types.js" })).toBe(false);
  });
});
