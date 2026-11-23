/**
 * `slopweaver supervisor state-fold` — the pure fold over a doc text, and the verb end to end over a real
 * temporary directory with the production filesystem seams. No mocks.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { parseStateFoldArgs } from "../../../../../cli/commands/supervisor/stateDocEditCore.js";
import {
  productionStateDocEditDeps,
  type StateDocEditDeps,
} from "../../../../../cli/commands/supervisor/stateDocEditPublication.js";
import { runStateAmend, runStateFold } from "../../../../../cli/commands/supervisor/stateDocEditRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { MAX_BOOT_BLOCK_LINES } from "../../../../../supervisor/stateDoc.js";
import { foldBootBlock } from "../../../../../supervisor/stateDocFold.js";

const PREAMBLE = "# State\n\nNotes (archived by handoff-9008). Nothing was deleted.\n\n";

/** A block with a sub-heading, a continued row and a ruling under the rulings line. */
const BLOCK =
  "## handoff-9009 boot — Sep 13\n" +
  "- 09:00 BOOTED.\n" +
  "- 09:10 TICK one.\n" +
  "  continued under the tick.\n" +
  "### IN FLIGHT\n" +
  "- 09:20 TICK two.\n" +
  "- 09:30 TICK three.\n" +
  "### RULINGS\n" +
  "- https://github.com/acme/acme-admin/pull/1 — no asks (deferred, 13 Sep)\n";

const DOC = `${PREAMBLE}${BLOCK}`;

/** The fold's fixed inputs, overridable per case. */
const fold = (over: Partial<Parameters<typeof foldBootBlock>[0]> = {}): ReturnType<typeof foldBootBlock> =>
  foldBootBlock({
    archiveDisplayPath: "~/h/archive/fold-1.md",
    description: "ticks to 09:20",
    docName: "state.md",
    handoff: "9009",
    keep: 1,
    text: DOC,
    when: undefined,
    ...over,
  });

describe("foldBootBlock", () => {
  it("moves every row but the newest kept one, leaves one note row where the first sat, and keeps the rulings", () => {
    const folded = unwrap(fold());
    expect(folded.docText).toBe(
      `${PREAMBLE}## handoff-9009 boot — Sep 13\n` +
        "- FOLDED 3 row(s) (ticks to 09:20) to `~/h/archive/fold-1.md` (folded by handoff-9009). Nothing was deleted.\n" +
        "### IN FLIGHT\n" +
        "- 09:30 TICK three.\n" +
        "### RULINGS\n" +
        "- https://github.com/acme/acme-admin/pull/1 — no asks (deferred, 13 Sep)\n",
    );
    expect(folded.archiveText).toBe(
      "# Folded from state.md's handoff-9009 block mid-shift: ticks to 09:20. Nothing was deleted.\n\n" +
        "## handoff-9009 boot — Sep 13\n" +
        "- 09:00 BOOTED.\n" +
        "- 09:10 TICK one.\n" +
        "  continued under the tick.\n" +
        "### IN FLIGHT\n" +
        "- 09:20 TICK two.\n",
    );
    expect([folded.folded, folded.kept, folded.blockLines, folded.docLines]).toEqual([3, 1, 6, 10]);
  });

  it("carries an earlier fold's note row into the next archive, so the chain stays walkable", () => {
    const first = unwrap(fold());
    const second = unwrap(
      fold({
        archiveDisplayPath: "~/h/archive/fold-2.md",
        description: "to 09:30",
        keep: 0,
        text: first.docText,
        when: "13 Sep 10:0x",
      }),
    );
    expect(second.archiveText).toContain("mid-shift (13 Sep 10:0x): to 09:30.");
    expect(second.archiveText).toContain("- FOLDED 3 row(s) (ticks to 09:20) to `~/h/archive/fold-1.md`");
    expect(second.docText).toContain("- FOLDED 2 row(s) (to 09:30) to `~/h/archive/fold-2.md`");
    expect(second.kept).toBe(0);
  });

  it("refuses a fold that would free no line", () => {
    expect(fold({ keep: 3 })._unsafeUnwrapErr().message).toBe(
      "the block holds 4 shift row(s) above ### RULINGS; keeping 3 folds 1 line(s), which frees none — lower --keep",
    );
    expect(fold({ keep: 4 })._unsafeUnwrapErr().code).toBe("INPUT_REJECTED");
  });

  it("refuses another seat's block and a description carrying a backtick", () => {
    expect(fold({ handoff: "9008" })._unsafeUnwrapErr().code).toBe("BLOCK_NOT_FOUND");
    expect(fold({ description: "a `b`" })._unsafeUnwrapErr().message).toBe(
      "--description must not carry a backtick or a NUL",
    );
  });

  it("refuses a block with no rulings line", () => {
    expect(fold({ text: DOC.replace("### RULINGS\n", "") })._unsafeUnwrapErr().code).toBe("RULINGS_NOT_FOUND");
  });
});

describe("parseStateFoldArgs", () => {
  it("names every missing requirement and refuses a keep that is not a whole number", () => {
    expect(parseStateFoldArgs({ rest: ["--keep", "-1"] })._unsafeUnwrapErr()).toEqual([
      "--doc is required",
      "--handoff is required",
      '--keep must be how many of the newest rows stay, a whole number like 10, not "-1"',
      "--archive is required",
      "--description is required",
    ]);
  });

  it("parses a complete invocation", () => {
    const args = unwrap(
      parseStateFoldArgs({
        rest: ["--doc", "d.md", "--handoff", "9009", "--keep", "0", "--archive", "f.md", "--description", "x"],
      }),
    );
    expect(args).toEqual({
      archive: "f.md",
      description: "x",
      doc: "d.md",
      handoff: "9009",
      json: false,
      keep: 0,
      when: undefined,
    });
  });
});

describe("runStateFold", () => {
  let dir: string;
  let doc: string;
  let archiveFile: string;
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps = (over: Partial<StateDocEditDeps> = {}): StateDocEditDeps => ({
    ...productionStateDocEditDeps(),
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
    ...over,
  });
  const argv = (): readonly string[] => [
    "--doc",
    doc,
    "--handoff",
    "9009",
    "--keep",
    "2",
    "--archive",
    "fold-1.md",
    "--description",
    "the morning",
  ];

  /** A doc whose block sits exactly at the cap, so an amend is refused until a fold runs. */
  const fullDoc = (): string => {
    const rows = Array.from({ length: MAX_BOOT_BLOCK_LINES - 2 }, (_, index) => `- tick ${String(index)}.`);
    return `${PREAMBLE}## handoff-9009 boot — Sep 13\n${rows.join("\n")}\n### RULINGS\n`;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sw-state-fold-"));
    doc = join(dir, "state.md");
    mkdirSync(join(dir, "archive"));
    archiveFile = join(realpathSync(dir), "archive", "fold-1.md");
    out.length = 0;
    diagnostics.length = 0;
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("unblocks a chair whose block is at the cap: the amend refused before the fold is accepted after it", () => {
    writeFileSync(doc, fullDoc());
    const amend = ["--doc", doc, "--handoff", "9009", "--row", "late tick."];
    expect(runStateAmend({ deps: deps(), rest: amend })).toBe(EXIT_ERROR);
    expect(diagnostics.at(-1)).toContain("`slopweaver supervisor state-fold`");

    expect(runStateFold({ deps: deps(), rest: argv() })).toBe(EXIT_OK);
    expect(out.at(-1)).toBe(
      `supervisor state-fold: 56 row(s) of handoff-9009's block folded to ${archiveFile}, 2 kept — doc 9 lines, block 5`,
    );
    expect(readFileSync(archiveFile, "utf8")).toContain("- tick 0.\n");
    expect(readFileSync(archiveFile, "utf8")).toContain("- tick 55.\n");

    expect(runStateAmend({ deps: deps(), rest: amend })).toBe(EXIT_OK);
    expect(readFileSync(doc, "utf8")).toContain("- tick 57.\n- late tick.\n### RULINGS\n");
  });

  it("leaves the doc byte-identical and publishes nothing when the fold is refused", () => {
    writeFileSync(doc, DOC);
    const rest = argv().map((token) => (token === "2" ? "4" : token));
    expect(runStateFold({ deps: deps(), rest })).toBe(EXIT_ERROR);
    expect(readFileSync(doc, "utf8")).toBe(DOC);
    expect(existsSync(archiveFile)).toBe(false);
  });

  it("refuses an archive name already holding other bytes", () => {
    writeFileSync(doc, DOC);
    writeFileSync(archiveFile, "someone else's archive\n");
    expect(runStateFold({ deps: deps(), rest: argv() })).toBe(EXIT_ERROR);
    expect(readFileSync(doc, "utf8")).toBe(DOC);
    expect(readFileSync(archiveFile, "utf8")).toBe("someone else's archive\n");
  });

  it("finishes a run that published the archive but failed to write the doc, when re-run", () => {
    writeFileSync(doc, DOC);
    const failing = deps({
      replaceFile: () => {
        throw new Error("disk full");
      },
    });
    expect(runStateFold({ deps: failing, rest: argv() })).toBe(EXIT_ERROR);
    expect(readFileSync(doc, "utf8")).toBe(DOC);
    expect(diagnostics.at(-1)).toBe(
      `supervisor state-fold: the archive IS published at ${archiveFile}; re-running this same command reuses it while the doc still holds what it held, and if another writer has changed the doc since, re-run with a new --archive name`,
    );

    expect(runStateFold({ deps: deps(), rest: [...argv(), "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(out.at(-1)!)).toEqual({
      archive: archiveFile,
      archiveReused: true,
      blockLines: 7,
      doc,
      docLines: 11,
      folded: 2,
      kept: 2,
    });
  });

  it("names the published archive when flushing it fails, and a re-run reuses it", () => {
    writeFileSync(doc, DOC);
    const failing = deps({
      flushPublished: () => {
        throw new Error("EIO");
      },
    });
    expect(runStateFold({ deps: failing, rest: argv() })).toBe(EXIT_ERROR);
    expect(readFileSync(doc, "utf8")).toBe(DOC);
    expect(existsSync(archiveFile)).toBe(true);
    expect(diagnostics.at(-1)).toBe(
      `supervisor state-fold: the archive IS published at ${archiveFile}; re-running this same command reuses it while the doc still holds what it held, and if another writer has changed the doc since, re-run with a new --archive name`,
    );

    expect(runStateFold({ deps: deps(), rest: [...argv(), "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(out.at(-1)!).archiveReused).toBe(true);
  });

  it("tells a run whose doc another writer changed after publication to pick a new archive name, not to re-run", () => {
    writeFileSync(doc, DOC);
    let reads = 0;
    const racing = deps({
      readFile: ({ path }) => {
        reads += 1;
        return reads === 1 || path !== doc ? readFileSync(path, "utf8") : `${DOC}- another writer\n`;
      },
    });
    expect(runStateFold({ deps: racing, rest: argv() })).toBe(EXIT_ERROR);
    expect(readFileSync(doc, "utf8")).toBe(DOC);
    expect(diagnostics.slice(-2)).toEqual([
      `supervisor state-fold: ${doc} changed while this edit was being prepared — nothing was written to it; re-run`,
      `supervisor state-fold: the archive IS published at ${archiveFile} from the doc as it was before the other writer's change; the doc still holds every row — re-run with a new --archive name`,
    ]);
  });

  it("exits with the usage code on a bad invocation", () => {
    expect(runStateFold({ deps: deps(), rest: ["--doc", doc] })).toBe(EXIT_USAGE);
  });
});
