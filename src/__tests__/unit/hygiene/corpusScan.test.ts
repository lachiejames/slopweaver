/**
 * The hygiene gate run over the corpus.
 *
 * The three arms are the whole contract, so the assertions are about which arm a hit lands in: a credential
 * shape FAILS, while an identifier and the organisation's own words in the organisation's own corpus do
 * not. The readers are injected, so a synthetic bronze tree exercises the walk without a corpus on disk — bar the
 * symlink skip, which needs real directories because the protect-list judge resolves a link to its real path.
 */
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { absentAsNumber } from "#lib/absent.js";
import { err, ok, unwrap, unwrapErr } from "#lib/result.js";
import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import type { CorpusHit, CorpusScanResult, ReportedArm } from "../../../hygiene/corpusScan.js";
import { protectedSkipLines, renderCorpusScan, scanCorpusHygiene } from "../../../hygiene/corpusScan.js";
import { fileMatchesSource } from "../../../hygiene/corpusScanFiles.js";
import { OwnerProtectionErrors } from "../../../protectedPaths/ownerEntries.js";

const HOME = "/tmp/does-not-exist-home";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

/** A no-access entry over the gmail bronze of {@link HOME}. */
const GMAIL_NO_ACCESS: OwnerProtectionResolver = () =>
  ok([
    {
      addedIso: "2026-01-01T00:00:00.000Z",
      mode: "no-access",
      path: `${HOME}/corpus/bronze/gmail`,
      why: "a synthetic fixture entry",
    },
  ]);

/** The scan under an empty protect list, unwrapped: every arm test below is about a scan the list let through. */
const scanned = (args: Omit<Parameters<typeof scanCorpusHygiene>[0], "protection">): CorpusScanResult =>
  unwrap(scanCorpusHygiene({ ...args, protection: NO_ENTRIES }));

/**
 * A bronze tree as `<source>/<file>` → contents.
 *
 * `readLines` mirrors the real reader's contract exactly — one call per `\n`-delimited slice, including the
 * trailing empty one after a final newline — so a fixture written as whole text still exercises the
 * streaming walk the shipped scanner uses.
 */
function fakeBronze({ tree }: { tree: Readonly<Record<string, string>> }): {
  listFiles: (args: { dir: string }) => readonly string[];
  readLines: (args: { path: string; onLine: (args: { line: string; index: number }) => void }) => void;
} {
  const sources = [...new Set(Object.keys(tree).map((key) => key.slice(0, key.indexOf("/"))))];
  return {
    listFiles: ({ dir }) => {
      if (dir.endsWith("/bronze")) {
        return sources;
      }
      const source = dir.slice(dir.lastIndexOf("/") + 1);
      return Object.keys(tree)
        .filter((key) => key.startsWith(`${source}/`))
        .map((key) => key.slice(source.length + 1));
    },
    readLines: ({ path, onLine }) => {
      const rel = Object.keys(tree).find((key) => path.endsWith(`/${key}`));
      if (rel === undefined) {
        throw new Error(`no such file: ${path}`);
      }
      tree[rel]!.split("\n").forEach((line, index) => {
        onLine({ index, line });
      });
    },
  };
}

/** A report-only arm holding exactly these hits — the shape `renderCorpusScan` reads. */
const arm = ({ hits, total = hits.length }: { hits: readonly CorpusHit[]; total?: number }): ReportedArm => {
  const byLabel: Record<string, number> = {};
  for (const hit of hits) {
    byLabel[hit.label] = absentAsNumber({ value: byLabel[hit.label], whenAbsent: 0 }) + 1;
  }
  return { byLabel, sample: hits, total: total };
};

/** An arm with nothing in it. */
const EMPTY_ARM: ReportedArm = arm({ hits: [] });

const record = ({ id, text }: { id: string; text: string }): string =>
  `${JSON.stringify({ kind: "message", source: "gmail", sourceId: id, text })}\n`;

/**
 * Token-shaped fixtures, ASSEMBLED rather than written out.
 *
 * A literal `sk-…` or `xoxb-…` in this file would trip the repository hygiene gate — correctly, since it
 * cannot tell a test fixture from a leak, and a gate with an exception for "it is only a test" is the
 * exception every real leak would claim. Joining the prefix to the body at run time produces the same
 * string for the scanner under test and no matchable literal on disk.
 */
// 48 characters after the prefix, and a numeric first segment: the shapes the providers actually issue.
// See the PATTERNS note in `src/hygiene/scan.ts` for the 106-hit measurement that replaced the old floors.
const KEY_SHAPE = ["sk", "abcdefghijklmnopqrstuvwxabcdefghijklmnopqrstuvwx"].join("-");
const SLACK_SHAPE = ["xoxb", "1234567890", "0987654321abcdef"].join("-");
// The IDENTIFIER shapes are assembled for the same reason, and the reason is worth stating twice: these two
// are exactly what the corpus scanner must NOT gate on, while the repository gate still flags them on a
// tracked file. Both gates are right, and a literal here would be a repository hit in this very test.
const WORKSPACE_ID_SHAPE = ["C0", "1234567"].join("");
const HOME_PATH_SHAPE = ["/ho", "me/buildbot/ci"].join("");

describe("fileMatchesSource", () => {
  it("matches on the whole first path segment, never a prefix of it", () => {
    expect(fileMatchesSource({ file: "gmail/w.jsonl", source: "gmail" })).toBe(true);
    expect(fileMatchesSource({ file: "gmailx/w.jsonl", source: "gmail" })).toBe(false);
    expect(fileMatchesSource({ file: "slack/w.jsonl", source: "gmail" })).toBe(false);
  });

  it("takes every source when none is named", () => {
    expect(fileMatchesSource({ file: "slack/w.jsonl", source: undefined })).toBe(true);
  });

  it("ignores anything that is not JSONL", () => {
    expect(fileMatchesSource({ file: "gmail/.DS_Store", source: undefined })).toBe(false);
  });
});

describe("scanCorpusHygiene", () => {
  it("finds a credential shape that survived the redaction pass, and puts it in the FAILING arm", () => {
    const bronze = fakeBronze({
      tree: { "gmail/w.jsonl": record({ id: "m1", text: `the key is ${KEY_SHAPE}` }) },
    });
    const result = scanned({ home: HOME, source: "gmail", ...bronze });

    expect(result.leaks.length).toBe(1);
    expect(result.leaks[0]!.label).toBe("openai-style-key");
    expect(result.leaks[0]!.sourceId).toBe("m1");
    expect(result.identifiers.total).toBe(0);
  });

  it("puts a raw workspace id in the REPORT-ONLY arm, so an ordinary corpus does not fail the gate", () => {
    const bronze = fakeBronze({
      tree: { "gmail/w.jsonl": record({ id: "m1", text: `your order ${WORKSPACE_ID_SHAPE} has shipped` }) },
    });
    const result = scanned({ home: HOME, source: "gmail", ...bronze });

    expect(result.leaks).toEqual([]);
    expect(result.identifiers.total).toBe(1);
    expect(result.identifiers.sample[0]!.label).toBe("raw-workspace-id");
    expect(result.identifiers.sample[0]!.sourceId).toBe("m1");
  });

  it("puts an absolute home path in the REPORT-ONLY arm — a path in a mail body is content, not a secret", () => {
    const bronze = fakeBronze({
      tree: { "gmail/w.jsonl": record({ id: "m1", text: `the build failed under ${HOME_PATH_SHAPE}` }) },
    });
    const result = scanned({ home: HOME, source: "gmail", ...bronze });

    expect(result.leaks).toEqual([]);
    expect(result.identifiers.total).toBe(1);
    expect(result.identifiers.sample[0]!.label).toBe("absolute-home-path");
  });

  it("splits a record carrying both: the credential fails, the identifier beside it does not", () => {
    const bronze = fakeBronze({
      tree: { "gmail/w.jsonl": record({ id: "m1", text: `ticket ${WORKSPACE_ID_SHAPE}, key ${KEY_SHAPE}` }) },
    });
    const result = scanned({ home: HOME, source: "gmail", ...bronze });

    expect(result.leaks.length).toBe(1);
    expect(result.leaks[0]!.label).toBe("openai-style-key");
    expect(result.identifiers.total).toBe(1);
    expect(result.identifiers.sample[0]!.label).toBe("raw-workspace-id");
  });

  it("NEVER carries the matched text, because on a mail record the match is the content", () => {
    const bronze = fakeBronze({
      tree: { "gmail/w.jsonl": record({ id: "m1", text: SLACK_SHAPE }) },
    });
    const result = scanned({ home: HOME, source: "gmail", ...bronze });

    expect(JSON.stringify(result)).not.toContain(SLACK_SHAPE);
  });

  it("scans only the named source", () => {
    const bronze = fakeBronze({
      tree: {
        "gmail/w.jsonl": record({ id: "m1", text: "clean" }),
        "slack/w.jsonl": record({ id: "s1", text: KEY_SHAPE }),
      },
    });

    expect(scanned({ home: HOME, source: "gmail", ...bronze }).leaks).toEqual([]);
    expect(scanned({ home: HOME, source: undefined, ...bronze }).leaks.length).toBe(1);
  });

  it("counts the records it checked", () => {
    const bronze = fakeBronze({
      tree: { "gmail/w.jsonl": record({ id: "m1", text: "a" }) + record({ id: "m2", text: "b" }) },
    });
    const result = scanned({ home: HOME, source: "gmail", ...bronze });

    expect(result.filesScanned).toBe(1);
    expect(result.linesScanned).toBe(2);
  });

  it("records a file it could not read rather than reporting clean over it", () => {
    const bronze = fakeBronze({ tree: { "gmail/w.jsonl": record({ id: "m1", text: "a" }) } });
    const result = scanned({
      home: HOME,
      listFiles: bronze.listFiles,
      readLines: () => {
        throw new Error("permission denied");
      },
      source: "gmail",
    });

    expect(result.unreadable).toEqual(["gmail/w.jsonl"]);
    expect(result.filesScanned).toBe(0);
  });

  it("reports a file that throws PART WAY through as unreadable, not as half-scanned", () => {
    const bronze = fakeBronze({ tree: { "gmail/w.jsonl": record({ id: "m1", text: `key ${KEY_SHAPE}` }) } });
    const result = scanned({
      home: HOME,
      listFiles: bronze.listFiles,
      readLines: ({ onLine }) => {
        onLine({ index: 0, line: JSON.stringify({ sourceId: "m1", text: `key ${KEY_SHAPE}` }) });
        throw new Error("EIO");
      },
      source: "gmail",
    });

    expect(result.unreadable).toEqual(["gmail/w.jsonl"]);
    expect(result.filesScanned).toBe(0);
    expect(result.linesScanned).toBe(0);
    expect(result.leaks.length).toBe(1);
    expect(result.leaks[0]!.sourceId).toBe("m1");
  });

  it("numbers a hit by the reader's own line index, so a 6 GB file needs no whole-file string", () => {
    const bronze = fakeBronze({
      tree: {
        "gmail/w.jsonl":
          record({ id: "m1", text: "clean" }) +
          record({ id: "m2", text: "clean" }) +
          record({ id: "m3", text: `key ${KEY_SHAPE}` }),
      },
    });
    const result = scanned({ home: HOME, source: "gmail", ...bronze });

    expect(result.leaks.length).toBe(1);
    expect(result.leaks[0]!.line).toBe(3);
    expect(result.leaks[0]!.sourceId).toBe("m3");
  });

  it("reports an absent bronze root as an empty scan rather than throwing", () => {
    const result = scanned({
      home: HOME,
      listFiles: () => {
        throw new Error("ENOENT");
      },
      source: "gmail",
    });

    expect(result.filesScanned).toBe(0);
    expect(result.leaks).toEqual([]);
  });

  it("skips and names a no-access source, never listing or opening it, and scans every other", () => {
    const opened: string[] = [];
    const listed: string[] = [];
    const bronze = fakeBronze({
      tree: {
        "gmail/w.jsonl": record({ id: "m1", text: `key ${KEY_SHAPE}` }),
        "slack/w.jsonl": record({ id: "s1", text: "clean" }),
      },
    });
    const [entry] = unwrap(GMAIL_NO_ACCESS());
    const result = unwrap(
      scanCorpusHygiene({
        home: HOME,
        listFiles: (args) => {
          listed.push(args.dir);
          return bronze.listFiles(args);
        },
        protection: GMAIL_NO_ACCESS,
        readLines: (args) => {
          opened.push(args.path);
          bronze.readLines(args);
        },
        source: undefined,
      }),
    );

    expect(result.protectedSkipped).toEqual([{ entry: entry!, path: `${HOME}/corpus/bronze/gmail` }]);
    expect(result.leaks).toEqual([]);
    expect(result.filesScanned).toBe(1);
    expect(listed).toEqual([`${HOME}/corpus/bronze`, `${HOME}/corpus/bronze/slack`]);
    expect(opened).toEqual([`${HOME}/corpus/bronze/slack/w.jsonl`]);
    expect(protectedSkipLines({ result })).toEqual([
      `  NOT CHECKED, protected by the owner's list: ${HOME}/corpus/bronze/gmail [no-access]`,
    ]);
  });

  it("refuses when the bronze root itself is covered, rather than reading it as an empty corpus", () => {
    const bronze = fakeBronze({ tree: { "gmail/w.jsonl": record({ id: "m1", text: "a" }) } });
    const root = `${HOME}/corpus`;
    const entry = { addedIso: "2026-01-01T00:00:00.000Z", mode: "no-access" as const, path: root, why: "fixture" };
    const refusal = unwrapErr(
      scanCorpusHygiene({ home: HOME, ...bronze, protection: () => ok([entry]), source: "gmail" }),
    );

    expect(refusal).toEqual([
      `refusing to scan the corpus: it would list ${HOME}/corpus/bronze, which the owner's protect list marks ` +
        `no-access at ${root} (fixture)`,
    ]);
  });

  it("skips a source symlinked into a protected tree BEFORE listing it, never after", () => {
    // Real directories, because the judge resolves a symlink to its real path; the entry is recorded at that real
    // path, as the owner's registry reader resolves one (`/var` is `/private/var`).
    const home = mkdtempSync(join(tmpdir(), "hygiene-scan-"));
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "hygiene-protected-")));
    try {
      writeFileSync(join(outside, "secret.jsonl"), record({ id: "m1", text: "a" }), "utf8");
      const bronze = join(home, "corpus", "bronze");
      mkdirSync(bronze, { recursive: true });
      const link = join(bronze, "slack");
      symlinkSync(outside, link);
      const listed: string[] = [];
      const entry = { addedIso: "2026-01-01T00:00:00.000Z", mode: "no-access" as const, path: outside, why: "fixture" };

      const result = unwrap(
        scanCorpusHygiene({
          home,
          listFiles: ({ dir }) => {
            listed.push(dir);
            return readdirSync(dir);
          },
          protection: () => ok([entry]),
          readLines: () => {
            throw new Error("nothing may be opened");
          },
          source: undefined,
        }),
      );

      expect(result.protectedSkipped).toEqual([{ entry, path: link }]);
      expect(result.filesScanned).toBe(0);
      expect(result.unreadable).toEqual([]);
      expect(listed).toEqual([bronze]);
    } finally {
      rmSync(home, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it("refuses when the protect list itself cannot be read, rather than scanning as if it were empty", () => {
    const bronze = fakeBronze({ tree: { "gmail/w.jsonl": record({ id: "m1", text: "a" }) } });
    const refusal = unwrapErr(
      scanCorpusHygiene({
        home: HOME,
        ...bronze,
        protection: () => err(OwnerProtectionErrors.unknown({ reason: "the registry is not JSON" })),
        source: "gmail",
      }),
    );

    expect(refusal).toEqual([
      "refusing to scan the corpus: the owner's protect list could not be read, so nothing it might cover is " +
        "touched: the registry is not JSON",
    ]);
  });
});

describe("renderCorpusScan", () => {
  it("says the denylist was NOT loaded rather than printing a clean line over words it never had", () => {
    const lines = renderCorpusScan({
      result: {
        denylistLoaded: false,
        denylistWords: 0,
        filesScanned: 1,
        identifiers: EMPTY_ARM,
        leaks: [],
        linesScanned: 3,
        protectedSkipped: [],
        unreadable: [],
      },
      source: "gmail",
    });

    expect(lines.join("\n")).toContain("private denylist: NOT LOADED");
  });

  it("puts a denylist word in the FAILING arm, because the list now holds literal secrets", () => {
    const lines = renderCorpusScan({
      result: {
        denylistLoaded: true,
        denylistWords: 8,
        filesScanned: 1,
        identifiers: EMPTY_ARM,
        leaks: [{ file: "gmail/w.jsonl", label: "denylist", line: 8, sourceId: "m8" }],
        linesScanned: 8,
        protectedSkipped: [],
        unreadable: [],
      },
      source: "gmail",
    });
    const text = lines.join("\n");

    expect(text).toContain("FAIL — secrets: 1");
    expect(text).toContain("gmail/w.jsonl:8  denylist  m8");
  });

  it("marks a leak class as a FAIL and groups the counts by class", () => {
    const lines = renderCorpusScan({
      result: {
        denylistLoaded: true,
        denylistWords: 1,
        filesScanned: 1,
        identifiers: EMPTY_ARM,
        leaks: [
          { file: "gmail/w.jsonl", label: "openai-style-key", line: 2, sourceId: "m2" },
          { file: "gmail/w.jsonl", label: "openai-style-key", line: 5, sourceId: "m5" },
        ],
        linesScanned: 9,
        protectedSkipped: [],
        unreadable: [],
      },
      source: "gmail",
    });
    const text = lines.join("\n");

    expect(text).toContain("FAIL — secrets: 2");
    expect(text).toContain("openai-style-key: 2");
  });

  it("says in the identifier section itself that it is NOT a failure, and still exits through a clean arm", () => {
    const lines = renderCorpusScan({
      result: {
        denylistLoaded: true,
        denylistWords: 8,
        filesScanned: 1,
        identifiers: arm({ hits: [{ file: "gmail/w.jsonl", label: "raw-workspace-id", line: 4, sourceId: "m4" }] }),
        leaks: [],
        linesScanned: 9,
        protectedSkipped: [],
        unreadable: [],
      },
      source: "gmail",
    });
    const text = lines.join("\n");

    expect(text).toContain("identifiers: 1 hit(s) — reported, NOT a failure.");
    expect(text).toContain("raw-workspace-id: 1");
    expect(text).toContain("gmail/w.jsonl:4  raw-workspace-id  m4");
    expect(text).toContain("secrets: none");
  });
});
