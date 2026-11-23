/**
 * `slopweaver supervisor state-amend` and `state-archive` end to end over a real temporary directory, with the
 * production filesystem seams — and, where a failure has to happen on purpose, one seam swapped for a plain
 * function that throws. No mocks.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import {
  parseStateAmendArgs,
  parseStateArchiveArgs,
  STATE_AMEND_USAGE,
} from "../../../../../cli/commands/supervisor/stateDocEditCore.js";
import {
  productionStateDocEditDeps,
  type StateDocEditDeps,
} from "../../../../../cli/commands/supervisor/stateDocEditPublication.js";
import { runStateAmend, runStateArchive } from "../../../../../cli/commands/supervisor/stateDocEditRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { sealSummary } from "../../../../../supervisor/outcomes/summaryMarker.js";

/** handoff-9008's doc, with the note handoff-9008 wrote when it archived handoff-9007 in the preamble. */
const DOC =
  "# State\n\nNotes (archived by handoff-9008). Nothing was deleted. RESTORE by handoff-9001: kept.\n\n" +
  "## handoff-9008 boot — Sep 13\n- 08:00 BOOTED.\n### RULINGS\n";

/** handoff-9009's block. */
const BLOCK = "## handoff-9009 boot — Sep 13\n- 09:00 BOOTED.\n### RULINGS\n";

/** A derived successor summary's body — the real verb's output shape, cut to what the seal check reads. */
const SUMMARY_BODY = "# Successor summary — derived 2026-09-13T00:00:00.000Z\n\nnobody is on gcp-backups.";

let dir: string;
let doc: string;
let blockFile: string;
let summaryFile: string;
/** Where the archive really lands: the verb puts it beside the RESOLVED doc, and `/tmp` is itself a link here. */
let archiveFile: string;
const out: string[] = [];
const diagnostics: string[] = [];

/**
 * The production seams with output captured, and any seam overridden.
 *
 * @param over the seams to replace
 * @returns the deps
 */
const deps = (over: Partial<StateDocEditDeps> = {}): StateDocEditDeps => ({
  ...productionStateDocEditDeps(),
  writeDiagnostic: (line) => diagnostics.push(line),
  writeOut: (line) => out.push(line),
  ...over,
});

/** The archive verb's argv, overridable. */
const archiveArgv = (): readonly string[] => [
  "--doc",
  doc,
  "--predecessor",
  "9008",
  "--successor",
  "9009",
  "--archive",
  "state-8.md",
  "--description",
  "the eighth seat",
  "--block-file",
  blockFile,
  "--successor-summary",
  summaryFile,
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sw-state-doc-"));
  doc = join(dir, "state.md");
  blockFile = join(dir, "block.md");
  summaryFile = join(dir, "summary.md");
  mkdirSync(join(dir, "archive"));
  archiveFile = join(realpathSync(dir), "archive", "state-8.md");
  writeFileSync(doc, DOC);
  writeFileSync(blockFile, BLOCK);
  writeFileSync(summaryFile, sealSummary({ body: SUMMARY_BODY, outcomes: 12, ready: 3 }));
  out.length = 0;
  diagnostics.length = 0;
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("parseStateAmendArgs", () => {
  it("keeps a row that opens with a bullet verbatim, in order with the other spelling", () => {
    const args = unwrap(
      parseStateAmendArgs({
        rest: ["--doc", "d.md", "--handoff", "9008", "--row", "- a", "--row=b", "--after-rulings"],
      }),
    );
    expect(args.rows).toEqual(["- a", "b"]);
    expect(args.afterRulings).toBe(true);
  });

  it("names every missing requirement at once", () => {
    expect(parseStateAmendArgs({ rest: [] })._unsafeUnwrapErr()).toEqual([
      "--doc is required",
      "--handoff is required",
      "at least one --row is required",
    ]);
  });

  it("refuses a handoff that is not a number and a trailing --row with no value", () => {
    expect(parseStateAmendArgs({ rest: ["--doc", "d", "--handoff", "8x", "--row", "a"] })._unsafeUnwrapErr()).toEqual([
      '--handoff must be a handoff number like 249, not "8x"',
    ]);
    expect(parseStateAmendArgs({ rest: ["--doc", "d", "--handoff", "9008", "--row"] })._unsafeUnwrapErr()).toEqual([
      "--row needs a value",
    ]);
  });
});

describe("parseStateArchiveArgs", () => {
  it("refuses an archive name that could leave the archive directory", () => {
    const rest = [
      "--doc",
      "d",
      "--predecessor",
      "9008",
      "--successor",
      "9009",
      "--description",
      "x",
      "--block-file",
      "b",
      "--successor-summary",
      "s",
    ];
    expect(parseStateArchiveArgs({ rest: [...rest, "--archive", "../x.md"] })._unsafeUnwrapErr()).toEqual([
      '--archive must be a plain file name ending .md, placed under the doc\'s archive/ directory — not "../x.md"',
    ]);
  });
});

describe("runStateAmend", () => {
  it("writes the rows into the doc", () => {
    const code = runStateAmend({ deps: deps(), rest: ["--doc", doc, "--handoff", "9008", "--row", "08:10 TICK."] });
    expect(code).toBe(EXIT_OK);
    expect(readFileSync(doc, "utf8")).toBe(DOC.replace("### RULINGS", "- 08:10 TICK.\n### RULINGS"));
    expect(out).toEqual(["supervisor state-amend: 1 row(s) into handoff-9008's block — doc 8 lines, block 4"]);
  });

  it("leaves the doc byte-identical when the edit is refused", () => {
    const code = runStateAmend({ deps: deps(), rest: ["--doc", doc, "--handoff", "9007", "--row", "x"] });
    expect(code).toBe(EXIT_ERROR);
    expect(readFileSync(doc, "utf8")).toBe(DOC);
  });

  it("refuses to overwrite a doc that changed while the edit was prepared", () => {
    let reads = 0;
    const replaced: string[] = [];
    const racing = deps({
      readFile: ({ path }) => {
        reads += 1;
        return reads === 1 ? readFileSync(path, "utf8") : `${DOC}- another writer\n`;
      },
      replaceFile: ({ path }) => {
        replaced.push(path);
      },
    });
    const code = runStateAmend({ deps: racing, rest: ["--doc", doc, "--handoff", "9008", "--row", "x"] });
    expect(code).toBe(EXIT_ERROR);
    expect(replaced).toEqual([]);
    expect(diagnostics).toEqual([
      `supervisor state-amend: ${doc} changed while this edit was being prepared — nothing was written to it; re-run`,
    ]);
  });

  it("prints usage for --help, and writes a row whose own text is --help", () => {
    expect(runStateAmend({ deps: deps(), rest: ["--help"] })).toBe(EXIT_OK);
    expect(out).toEqual([STATE_AMEND_USAGE]);
    expect(readFileSync(doc, "utf8")).toBe(DOC);

    out.length = 0;
    expect(runStateAmend({ deps: deps(), rest: ["--doc", doc, "--handoff", "9008", "--row", "--help"] })).toBe(EXIT_OK);
    expect(readFileSync(doc, "utf8")).toBe(DOC.replace("### RULINGS", "- --help\n### RULINGS"));
  });

  it("exits with the usage code on a bad invocation", () => {
    expect(runStateAmend({ deps: deps(), rest: ["--handoff", "9008"] })).toBe(EXIT_USAGE);
  });
});

describe("runStateArchive", () => {
  it("publishes the archive and installs the successor's block", () => {
    const code = runStateArchive({ deps: deps(), rest: archiveArgv() });
    expect(code).toBe(EXIT_OK);
    expect(readFileSync(archiveFile, "utf8")).toBe(
      "# Archived from state.md by handoff-9009 at boot: the eighth seat. Nothing was deleted.\n\n" +
        "## handoff-9008 boot — Sep 13\n- 08:00 BOOTED.\n### RULINGS\n",
    );
    expect(readFileSync(doc, "utf8")).toBe(
      "# State\n\nNotes (archived by handoff-9008). Nothing was deleted. The handoff-9008 block (lines 5-7, the eighth seat) " +
        `is in \`${archiveFile}\` (archived by handoff-9009). Nothing was deleted. RESTORE by handoff-9001: kept.\n\n` +
        BLOCK,
    );
    expect(out.at(-1)).toContain("successor summary sealed over 12 outcome(s) and 3 ready row(s)");
  });

  it("seeds the note chain on a doc no seat has archived, and the next archive chains after it", () => {
    writeFileSync(doc, "# State\n\nA rolling window.\n\n## handoff-9008 boot — Sep 13\n- 08:00 BOOTED.\n### RULINGS\n");

    expect(runStateArchive({ deps: deps(), rest: archiveArgv() })).toBe(EXIT_OK);

    const seedNote =
      `The handoff-9008 block (lines 5-7, the eighth seat) is in \`${archiveFile}\` (archived by handoff-9009). ` +
      "Nothing was deleted.";
    expect(readFileSync(doc, "utf8")).toBe(`# State\n\nA rolling window.\n\n${seedNote}\n\n${BLOCK}`);
    expect(readFileSync(archiveFile, "utf8")).toBe(
      "# Archived from state.md by handoff-9009 at boot: the eighth seat. Nothing was deleted.\n\n" +
        "## handoff-9008 boot — Sep 13\n- 08:00 BOOTED.\n### RULINGS\n",
    );
    expect(diagnostics).toEqual([]);

    writeFileSync(blockFile, "## handoff-9010 boot\n### RULINGS\n");
    const next = [
      "--doc",
      doc,
      "--predecessor",
      "9009",
      "--successor",
      "9010",
      "--archive",
      "state-9.md",
      "--description",
      "the eighth seat",
      "--block-file",
      blockFile,
      "--successor-summary",
      summaryFile,
    ];
    expect(runStateArchive({ deps: deps(), rest: next })).toBe(EXIT_OK);
    expect(readFileSync(doc, "utf8")).toBe(
      `# State\n\nA rolling window.\n\n${seedNote} The handoff-9009 block (lines 7-9, the eighth seat) is in ` +
        `\`${join(realpathSync(dir), "archive", "state-9.md")}\` (archived by handoff-9010). Nothing was deleted.\n\n` +
        "## handoff-9010 boot\n### RULINGS\n",
    );
    expect(diagnostics).toEqual([]);
  });

  it("refuses a boot block whose successor summary was hand-written rather than derived", () => {
    writeFileSync(summaryFile, "# Successor summary\n\nI typed this myself.\n");

    expect(runStateArchive({ deps: deps(), rest: archiveArgv() })).toBe(EXIT_ERROR);

    expect(readFileSync(doc, "utf8")).toBe(DOC);
    expect(existsSync(archiveFile)).toBe(false);
    expect(diagnostics[0]).toContain("is not a derived successor summary");
    expect(diagnostics.at(-1)).toContain("slopweaver supervisor successor-summary");
  });

  it("refuses a derived summary somebody edited after it was derived", () => {
    writeFileSync(
      summaryFile,
      sealSummary({ body: SUMMARY_BODY, outcomes: 12, ready: 3 }).replace("nobody is on", "everybody is on"),
    );

    expect(runStateArchive({ deps: deps(), rest: archiveArgv() })).toBe(EXIT_ERROR);

    expect(readFileSync(doc, "utf8")).toBe(DOC);
    expect(diagnostics[0]).toContain("does not hash to the digest on its marker");
  });

  it("refuses when no successor summary was named at all", () => {
    const rest = archiveArgv().filter((token) => token !== "--successor-summary" && token !== summaryFile);

    expect(runStateArchive({ deps: deps(), rest })).toBe(EXIT_USAGE);

    expect(diagnostics[0]).toBe("supervisor state-archive: --successor-summary is required");
  });

  it("refuses an existing archive with different contents and leaves the doc alone", () => {
    writeFileSync(archiveFile, "someone else's archive\n");
    const code = runStateArchive({ deps: deps(), rest: archiveArgv() });
    expect(code).toBe(EXIT_ERROR);
    expect(readFileSync(doc, "utf8")).toBe(DOC);
    expect(readFileSync(archiveFile, "utf8")).toBe("someone else's archive\n");
  });

  it("refuses an archive path that resolves onto the state doc through a symlinked archive directory", () => {
    rmSync(join(dir, "archive"), { recursive: true });
    symlinkSync(".", join(dir, "archive"));
    const rest = archiveArgv().map((token) => (token === "state-8.md" ? "state.md" : token));
    expect(runStateArchive({ deps: deps(), rest })).toBe(EXIT_ERROR);
    expect(readFileSync(doc, "utf8")).toBe(DOC);
    expect(diagnostics.at(-1)).toContain("resolves to the state doc itself");
  });

  it("refuses an archive name that is a symlink rather than a file of its own", () => {
    symlinkSync("../block.md", archiveFile);
    const code = runStateArchive({ deps: deps(), rest: archiveArgv() });
    expect(code).toBe(EXIT_ERROR);
    expect(readFileSync(doc, "utf8")).toBe(DOC);
    expect(diagnostics.at(-1)).toBe(
      `supervisor state-archive: ${archiveFile} is a symlink, not a regular file — nothing was written; pick another --archive name`,
    );
  });

  it("finishes a run that published the archive but failed to write the doc, when re-run", () => {
    const failing = deps({
      replaceFile: () => {
        throw new Error("disk full");
      },
    });
    expect(runStateArchive({ deps: failing, rest: archiveArgv() })).toBe(EXIT_ERROR);
    expect(existsSync(archiveFile)).toBe(true);
    expect(readFileSync(doc, "utf8")).toBe(DOC);
    expect(diagnostics.at(-1)).toBe(
      `supervisor state-archive: the archive IS published at ${archiveFile}; re-running this same command reuses it while the doc still holds what it held, and if another writer has changed the doc since, re-run with a new --archive name`,
    );

    out.length = 0;
    expect(runStateArchive({ deps: deps(), rest: [...archiveArgv(), "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!).archiveReused).toBe(true);
    expect(readFileSync(doc, "utf8").endsWith(BLOCK)).toBe(true);
  });
});
