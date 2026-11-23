import { describe, expect, it } from "vitest";
import {
  BumpManifestErrors,
  type BumpRow,
  canonicalText,
  digestOf,
  manifestFileName,
  parseBumpManifest,
  pathOfEntry,
  provenUnchanged,
  rowsUnmeasured,
  witnessClaim,
  witnessCommand,
  witnessPropertyId,
} from "../../../devLint/baselineBump.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

// deleted-with-code: mismatchesOf

/** The main commit every fixture manifest is declared against. */
const BASE = "a".repeat(40);

const FILE = ".baselines/file-size-baseline.json";
const WIDE: BumpRow = { cause: "widening", entry: "offenders:tools/gen.ts", file: FILE, from: null, to: 319 };
const GROW: BumpRow = { cause: "growth", entry: "exempt:src/reg.ts", file: FILE, from: 400, to: 410 };

const manifestText = ({ rows, reason = "tools/ joined the cap" }: { rows: readonly BumpRow[]; reason?: string }) =>
  JSON.stringify({ base: BASE, digest: digestOf({ base: BASE, rows }), loosenings: rows, reason });

describe("rowsUnmeasured", () => {
  const manifest = {
    base: BASE,
    digest: digestOf({ base: BASE, rows: [WIDE, GROW] }),
    loosenings: [WIDE, GROW],
    reason: "r",
  };

  it("returns nothing when every row is measured exactly, cause aside", () => {
    expect(rowsUnmeasured({ manifest, measured: [{ ...GROW }, { ...WIDE }] })).toEqual([]);
  });

  it("returns a row whose from differs from the measurement, so a row measured elsewhere is not reproduced", () => {
    expect(rowsUnmeasured({ manifest, measured: [WIDE, { ...GROW, from: 380 }] })).toEqual([GROW]);
  });

  it("returns every row against an empty measurement", () => {
    expect(rowsUnmeasured({ manifest, measured: [] })).toEqual([WIDE, GROW]);
  });
});

describe("canonicalText and digestOf", () => {
  it("is order-independent", () => {
    expect(canonicalText({ base: BASE, rows: [WIDE, GROW] })).toBe(canonicalText({ base: BASE, rows: [GROW, WIDE] }));
    expect(digestOf({ base: BASE, rows: [WIDE, GROW] })).toBe(digestOf({ base: BASE, rows: [GROW, WIDE] }));
  });

  it("renders the base line, then one tab-separated line per row, cause last", () => {
    expect(canonicalText({ base: BASE, rows: [WIDE] })).toBe(
      `base\t${BASE}\n${FILE}\toffenders:tools/gen.ts\tnull\t319\twidening`,
    );
  });

  it("changes when only the base changes, so the same rows declared again after a landed bump get their own file", () => {
    const later = "b".repeat(40);
    expect(manifestFileName({ digest: digestOf({ base: later, rows: [WIDE] }) })).not.toBe(
      manifestFileName({ digest: digestOf({ base: BASE, rows: [WIDE] }) }),
    );
  });

  it("changes when only the cause changes, so a witness cannot be reused across causes", () => {
    expect(digestOf({ base: BASE, rows: [WIDE] })).not.toBe(
      digestOf({ base: BASE, rows: [{ ...WIDE, cause: "growth" }] }),
    );
  });
});

describe("parseBumpManifest", () => {
  const rows = [WIDE, GROW];
  const name = manifestFileName({ digest: digestOf({ base: BASE, rows }) });

  it("accepts an honest manifest filed under its own digest", () => {
    const manifest = unwrap(
      parseBumpManifest({ name, path: `ledgers/baseline-bumps/${name}`, text: manifestText({ rows }) }),
    );
    expect(manifest.digest).toBe(digestOf({ base: BASE, rows }));
    expect(manifest.loosenings).toEqual(rows);
    expect(manifest.reason).toBe("tools/ joined the cap");
  });

  it("refuses a digest that is not its own rows'", () => {
    const text = JSON.stringify({
      base: BASE,
      digest: digestOf({ base: BASE, rows: [WIDE] }),
      loosenings: rows,
      reason: "r",
    });
    expect(unwrapErr(parseBumpManifest({ name, path: "p", text }))).toEqual(
      BumpManifestErrors.digestMismatch({ path: "p" }),
    );
  });

  it("refuses a manifest filed under another name", () => {
    const error = unwrapErr(
      parseBumpManifest({ name: "0000000000000000.json", path: "p", text: manifestText({ rows }) }),
    );
    expect(error.code).toBe("BUMP_MANIFEST_MALFORMED");
    expect(error.message).toBe(`p: not a bump manifest (filed as 0000000000000000.json, its digest names ${name})`);
  });

  it("refuses a row declared twice", () => {
    const twice = [WIDE, WIDE];
    const error = unwrapErr(
      parseBumpManifest({
        name: manifestFileName({ digest: digestOf({ base: BASE, rows: twice }) }),
        path: "p",
        text: manifestText({ rows: twice }),
      }),
    );
    expect(error.message).toBe("p: not a bump manifest (a row is declared twice)");
  });

  it("refuses a blank reason and an empty row list", () => {
    expect(unwrapErr(parseBumpManifest({ name, path: "p", text: manifestText({ reason: "  ", rows }) })).code).toBe(
      "BUMP_MANIFEST_MALFORMED",
    );
    expect(unwrapErr(parseBumpManifest({ name, path: "p", text: manifestText({ rows: [] }) })).code).toBe(
      "BUMP_MANIFEST_MALFORMED",
    );
  });

  it("refuses a control character in a file or entry, so a split declaration cannot match another row's key", () => {
    const ci = ".baselines/ci-job-seconds.json";
    const resplit: readonly BumpRow[] = [
      { cause: "growth", entry: "unit", file: `${ci}\u0000lint`, from: null, to: 100 },
    ];
    const tabbed: readonly BumpRow[] = [{ cause: "growth", entry: "lint\tunit", file: ci, from: null, to: 100 }];
    for (const bad of [resplit, tabbed]) {
      const named = manifestFileName({ digest: digestOf({ base: BASE, rows: bad }) });
      expect(unwrapErr(parseBumpManifest({ name: named, path: "p", text: manifestText({ rows: bad }) })).message).toBe(
        "p: not a bump manifest (expected { base, reason, loosenings: [...], digest })",
      );
    }
  });

  it("refuses text that is not JSON", () => {
    expect(unwrapErr(parseBumpManifest({ name, path: "p", text: "{" })).message).toBe(
      "p: not a bump manifest (expected { base, reason, loosenings: [...], digest })",
    );
  });
});

describe("pathOfEntry", () => {
  it("reads the path from a keyed row and a pair row", () => {
    expect(pathOfEntry({ entry: "offenders:tools/gen.ts" })).toBe("tools/gen.ts");
    expect(pathOfEntry({ entry: "sites:src/a.ts#??" })).toBe("src/a.ts");
  });

  it("names no path for a scalar, a CI job or a whole-file row", () => {
    expect(pathOfEntry({ entry: "filePairs" })).toBeUndefined();
    expect(pathOfEntry({ entry: "lint" })).toBeUndefined();
    expect(pathOfEntry({ entry: "*" })).toBeUndefined();
  });

  it("names no path for a heap ceiling, though its name holds a dot", () => {
    expect(pathOfEntry({ entry: "ceilingsMiB:package-script.build" })).toBeUndefined();
    expect(provenUnchanged({ changedPaths: new Set(), entry: "ceilingsMiB:package-script.build" })).toBe(false);
  });
});

describe("provenUnchanged", () => {
  it("proves a file no changed path names", () => {
    expect(provenUnchanged({ changedPaths: new Set(["src/other.ts"]), entry: "offenders:tools/gen.ts" })).toBe(true);
  });

  it("disproves a file the change touched, and a pair row on it", () => {
    expect(provenUnchanged({ changedPaths: new Set(["tools/gen.ts"]), entry: "offenders:tools/gen.ts" })).toBe(false);
    expect(provenUnchanged({ changedPaths: new Set(["src/a.ts"]), entry: "sites:src/a.ts#??" })).toBe(false);
  });

  it("disproves a changed file whose own name carries `#`, which a first-`#` split would read as another path", () => {
    expect(provenUnchanged({ changedPaths: new Set(["src/gen#v2.ts"]), entry: "offenders:src/gen#v2.ts" })).toBe(false);
  });

  it("disproves a directory-keyed row when the change touched a file beneath it, and proves it otherwise", () => {
    const entry = "directories:src/devLint";
    expect(provenUnchanged({ changedPaths: new Set(["src/devLint/newErrors.ts"]), entry })).toBe(false);
    expect(provenUnchanged({ changedPaths: new Set(["src/devLintExtra/a.ts"]), entry })).toBe(true);
  });

  it("never proves an entry that names no file", () => {
    expect(provenUnchanged({ changedPaths: new Set(), entry: "policy" })).toBe(false);
    expect(provenUnchanged({ changedPaths: new Set(), entry: "filePairs" })).toBe(false);
  });
});

describe("the witness the landing verbs require", () => {
  const rows = [WIDE];
  const manifest = {
    base: BASE,
    digest: digestOf({ base: BASE, rows }),
    loosenings: rows,
    reason: "tools/ joined the cap",
  };

  it("binds the property id to the whole digest, never a prefix", () => {
    expect(witnessPropertyId({ digest: manifest.digest })).toBe(`baseline-bump-${manifest.digest}`);
    expect(manifest.digest).toHaveLength(64);
  });

  it("names the manifest file for the whole digest, never a prefix", () => {
    expect(manifestFileName({ digest: manifest.digest })).toBe(`${manifest.digest}.json`);
  });

  it("renders the claim with the full digest, the reason and every row", () => {
    const claim = witnessClaim({ manifest });
    expect(claim).toContain(`Ratchet bump ${manifest.digest}:`);
    expect(claim).toContain("Stated reason: tools/ joined the cap.");
    expect(
      claim.endsWith(`Rows (file entry main->now (cause)): ${FILE} offenders:tools/gen.ts null->319 (widening)`),
    ).toBe(true);
    expect(claim.includes("\n")).toBe(false);
  });

  it("names the bump record in the home and a per-baseline count instead of inlining a row list past the cap", () => {
    const seeded: BumpRow[] = Array.from({ length: 2000 }, (_, index) => ({
      cause: "widening",
      entry: `files:docs/a-long-enough-path-to-pass-the-cap/page-${String(index)}.md`,
      file: ".baselines/transient-references-baseline.json",
      from: null,
      to: 3,
    }));
    const big = {
      base: BASE,
      digest: digestOf({ base: BASE, rows: [...seeded, GROW] }),
      loosenings: [...seeded, GROW],
      reason: "seed",
    };

    const claim = witnessClaim({ manifest: big });

    expect(
      claim.endsWith(
        `Rows: ${FILE} 1 row(s) (growth); .baselines/transient-references-baseline.json 2000 row(s) (widening), every one ` +
          `listed in the bump record ledgers/baseline-bumps/${big.digest}.json under $SLOPWEAVER_HOME, whose digest ` +
          "above binds them",
      ),
    ).toBe(true);
    expect(claim.length).toBeLessThan(1000);
  });

  it("prints one shell command that quotes the claim, apostrophes included", () => {
    const quoted = { ...manifest, reason: "it's the generators" };
    expect(witnessCommand({ base: "abc", manifest: quoted })).toBe(
      `slopweaver codex review --pass r3 --property-id ${witnessPropertyId({ digest: manifest.digest })} ` +
        `--property '${witnessClaim({ manifest: quoted }).replace("it's", "it'\\''s")}' --base abc --bound-seconds 1500 --max-diff-bytes 4000000`,
    );
  });
});
