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
  rowKey,
  rowsUnmeasured,
  witnessClaim,
  witnessCommand,
  witnessPropertyId,
} from "../../../devLint/baselineBump.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** The main commit every fixture manifest is declared against. */
const BASE = "a".repeat(40);

const FILE = ".baselines/file-size-baseline.json";
const WIDE: BumpRow = { cause: "widening", entry: "offenders:tools/gen.ts", file: FILE, from: null, to: 319 };
const GROW: BumpRow = { cause: "growth", entry: "exempt:src/reg.ts", file: FILE, from: 400, to: 410 };

const manifestText = ({ rows, reason = "tools/ joined the cap" }: { rows: readonly BumpRow[]; reason?: string }) =>
  JSON.stringify({ base: BASE, digest: digestOf({ base: BASE, rows }), loosenings: rows, reason });

/**
 * A row whose path holds `#`, and the different row that SHOWS the same entry: `src/a`+`b.ts#jsonl-read-whole`.
 * Only the first carries a tuple, so the two must never key, digest or prove alike.
 */
const WHOLE = ".baselines/whole-file-json-baseline.json";
const HASHED_TUPLE = ["sites", "src/a#b.ts", "jsonl-read-whole"];
const LOOKALIKE: BumpRow = {
  cause: "growth",
  entry: "sites:src/a#b.ts#jsonl-read-whole",
  file: WHOLE,
  from: null,
  to: 1,
};
const HASHED: BumpRow = { ...LOOKALIKE, identityTuple: HASHED_TUPLE };

/**
 * The digest the pre-tuple `baselineBump.ts` gives `[WIDE, GROW]` at `BASE` — measured by running this case with
 * that file's copy from before tuples existed checked out
 * (`git checkout <that commit> -- src/devLint/baselineBump.ts src/devLint/baselineRegistry.ts`).
 */
const LEGACY_DIGEST = "d83cda32df9efa98100c52eb74a375f3d3c7ba4f597a2ed8fb3c1c20b1659b36";

describe("rows without a tuple are byte-identical to before tuples existed", () => {
  it("keeps the legacy row key, canonical text and digest", () => {
    expect(rowKey({ row: WIDE })).toBe(`${FILE}\u0000offenders:tools/gen.ts\u0000null\u0000319`);
    expect(canonicalText({ base: BASE, rows: [WIDE, GROW] })).toBe(
      `base\t${BASE}\n${FILE}\texempt:src/reg.ts\t400\t410\tgrowth\n${FILE}\toffenders:tools/gen.ts\tnull\t319\twidening`,
    );
    expect(digestOf({ base: BASE, rows: [WIDE, GROW] })).toBe(LEGACY_DIGEST);
  });
});

describe("a row whose path holds #", () => {
  it("keys, renders and digests apart from the different row showing the same entry", () => {
    expect(rowKey({ row: HASHED })).toBe(
      `${WHOLE}\u0000sites:src/a#b.ts#jsonl-read-whole\u0000null\u00001\u0000["sites","src/a#b.ts","jsonl-read-whole"]`,
    );
    expect(rowKey({ row: LOOKALIKE })).toBe(`${WHOLE}\u0000sites:src/a#b.ts#jsonl-read-whole\u0000null\u00001`);
    expect(canonicalText({ base: BASE, rows: [HASHED] })).toBe(
      `base\t${BASE}\n${WHOLE}\tsites:src/a#b.ts#jsonl-read-whole\tnull\t1\tgrowth\t["sites","src/a#b.ts","jsonl-read-whole"]`,
    );
    expect(digestOf({ base: BASE, rows: [HASHED] })).not.toBe(digestOf({ base: BASE, rows: [LOOKALIKE] }));
  });

  it("is never covered by a record of the lookalike row, nor covers one", () => {
    const record = ({ rows }: { rows: readonly BumpRow[] }) => ({
      base: BASE,
      digest: digestOf({ base: BASE, rows }),
      loosenings: rows,
      reason: "r",
    });
    expect(rowsUnmeasured({ manifest: record({ rows: [LOOKALIKE] }), measured: [HASHED] })).toEqual([LOOKALIKE]);
    expect(rowsUnmeasured({ manifest: record({ rows: [HASHED] }), measured: [LOOKALIKE] })).toEqual([HASHED]);
    expect(rowsUnmeasured({ manifest: record({ rows: [HASHED] }), measured: [{ ...HASHED }] })).toEqual([]);
  });

  it("parses an honest record, and refuses one whose tuple is not its entry's or was not needed", () => {
    const honest = manifestFileName({ digest: digestOf({ base: BASE, rows: [HASHED] }) });
    expect(
      unwrap(parseBumpManifest({ name: honest, path: "p", text: manifestText({ rows: [HASHED] }) })).loosenings,
    ).toEqual([HASHED]);
    const forged: BumpRow = { ...HASHED, identityTuple: ["sites", "src/a#c.ts", "jsonl-read-whole"] };
    const needless: BumpRow = { ...WIDE, identityTuple: ["offenders", "tools/gen.ts"] };
    for (const bad of [forged, needless]) {
      const named = manifestFileName({ digest: digestOf({ base: BASE, rows: [bad] }) });
      expect(
        unwrapErr(parseBumpManifest({ name: named, path: "p", text: manifestText({ rows: [bad] }) })).message,
      ).toBe("p: not a bump manifest (expected { base, reason, loosenings: [...], digest })");
    }
  });

  it("names its exact path, and a tuple that is not its entry's names nothing", () => {
    expect(pathOfEntry({ entry: HASHED.entry, identityTuple: HASHED_TUPLE })).toBe("src/a#b.ts");
    expect(pathOfEntry({ entry: HASHED.entry })).toBe("src/a");
    expect(pathOfEntry({ entry: HASHED.entry, identityTuple: ["sites", "src/x.ts", "jsonl-read-whole"] })).toBe(
      undefined,
    );
  });

  it("is disproved by a change to its exact path, and proved by a change elsewhere", () => {
    const proven = ({ changed }: { changed: string }) =>
      provenUnchanged({ changedPaths: new Set([changed]), entry: HASHED.entry, identityTuple: HASHED_TUPLE });
    expect(proven({ changed: "src/a#b.ts" })).toBe(false);
    expect(proven({ changed: "src/other.ts" })).toBe(true);
  });

  it("shows the witness which row the entry is", () => {
    const manifest = {
      base: BASE,
      digest: digestOf({ base: BASE, rows: [HASHED] }),
      loosenings: [HASHED],
      reason: "r",
    };
    expect(
      witnessClaim({ manifest }).endsWith(
        `Rows (file entry main->now (cause)): ${WHOLE} sites:src/a#b.ts#jsonl-read-whole identity ` +
          '["sites","src/a#b.ts","jsonl-read-whole"] null->1 (growth)',
      ),
    ).toBe(true);
  });
});

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
