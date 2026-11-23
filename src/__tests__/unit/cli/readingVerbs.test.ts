import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  documentObservedAt,
  READING_LAST_FLAG_NAMES,
  READING_LIST_FLAG_NAMES,
  READING_RECORD_FLAG_NAMES,
} from "../../../cli/commands/reading/core.js";
import { type ReadingLastDeps, runReadingLast } from "../../../cli/commands/reading/last.js";
import { type ReadingListDeps, runReadingList } from "../../../cli/commands/reading/list.js";
import { type ReadingRecordDeps, runReadingRecord } from "../../../cli/commands/reading/record.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

/** A throwaway state home these verbs may write into — never the ambient one. */
function home(): string {
  const root = mkdtempSync(join(tmpdir(), "sw-reading-cli-"));
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  return root;
}

/** What one verb run wrote to each channel, and what it exited with. */
interface Recorded {
  readonly exit: number;
  readonly out: readonly string[];
  readonly diagnostics: readonly string[];
}

/** The clock every verb in this file runs against. */
const NOW = "2026-09-20T02:30:00.000Z";

const LANDING = '{"rows":[],"tally":{"total":0,"ready":0,"byAction":[]},"residue":[]}';

/** Run `reading record` with recording seams; stdin answers `stdin`. */
async function record({ rest, stdin = "" }: { rest: readonly string[]; stdin?: string }): Promise<Recorded> {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: ReadingRecordDeps = {
    now: () => NOW,
    readStdin: () => Promise.resolve(stdin),
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
  return { diagnostics, exit: await runReadingRecord({ deps, rest }), out };
}

/** Run `reading last` with recording seams. */
function last({ rest }: { rest: readonly string[] }): Recorded {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: ReadingLastDeps = {
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
  return { diagnostics, exit: runReadingLast({ deps, rest }), out };
}

/** Run `reading list` with recording seams. */
function list({ rest }: { rest: readonly string[] }): Recorded {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: ReadingListDeps = {
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
  return { diagnostics, exit: runReadingList({ deps, rest }), out };
}

/** A landing document written to a file under `dir`. */
function landingFile({ dir, text = LANDING }: { dir: string; text?: string }): string {
  const path = join(dir, "landing.json");
  writeFileSync(path, text);
  return path;
}

describe("reading record", () => {
  it("records a file's bytes and prints where both writes landed, the instant being the recording one", async () => {
    const dir = home();
    const ran = await record({
      rest: ["--producer", "github landing", "--from", landingFile({ dir }), "--by", "tick-12", "--home", dir],
    });
    expect(ran.exit).toBe(EXIT_OK);
    expect(ran.out).toEqual([
      "reading record: 2026-09-20T02:30:00.000Z-github-landing — github landing by tick-12, 68 bytes",
      "  true as of 2026-09-20T02:30:00.000Z (the recording instant), recorded 2026-09-20T02:30:00.000Z",
      `  ${join(dir, "readings", "github-landing", "2026-09-20T023000.000Z.json")}`,
      `  ${join(dir, "readings", "index.jsonl")}`,
    ]);
  });

  it("believes the document's own observedAtIso when it carries one", async () => {
    const dir = home();
    const path = landingFile({ dir, text: '{"observedAtIso":"2026-09-20T02:00:00.000Z","rows":[]}' });
    const ran = await record({
      rest: ["--producer", "claude gauge", "--from", path, "--by", "tick-12", "--home", dir, "--json"],
    });
    expect(ran.exit).toBe(EXIT_OK);
    const receipt = JSON.parse(ran.out[0]!) as { record: { observedAtIso: string }; observedFrom: string };
    expect(receipt.record.observedAtIso).toBe("2026-09-20T02:00:00.000Z");
    expect(receipt.observedFrom).toBe("the document's own observedAtIso");
  });

  it("takes --observed-at over the document's own instant", async () => {
    const dir = home();
    const path = landingFile({ dir, text: '{"observedAtIso":"2026-09-20T02:00:00.000Z"}' });
    const ran = await record({
      rest: ["--producer", "p", "--from", path, "--by", "b", "--home", dir, "--observed-at", "2026-09-20T01:00:00Z"],
    });
    expect(ran.exit).toBe(EXIT_OK);
    expect(ran.out[1]).toBe("  true as of 2026-09-20T01:00:00Z (--observed-at), recorded 2026-09-20T02:30:00.000Z");
  });

  it("reads the document from stdin when --from is -", async () => {
    const dir = home();
    const ran = await record({
      rest: ["--producer", "github landing", "--from", "-", "--by", "sync-now", "--home", dir],
      stdin: LANDING,
    });
    expect(ran.exit).toBe(EXIT_OK);
    const read = last({ rest: ["--producer", "github landing", "--home", dir, "--json"] });
    expect(JSON.parse(read.out[0]!)).toEqual({
      by: "sync-now",
      bytes: 68,
      document: JSON.parse(LANDING),
      observedAtIso: NOW,
      producer: "github landing",
      readingId: "2026-09-20T02:30:00.000Z-github-landing",
      recordedAtIso: NOW,
    });
  });

  it("refuses a file that is not JSON before writing anything", async () => {
    const dir = home();
    const ran = await record({
      rest: ["--producer", "p", "--from", landingFile({ dir, text: "not json" }), "--by", "b", "--home", dir],
    });
    expect(ran.exit).toBe(EXIT_ERROR);
    expect(ran.diagnostics[0]).toContain("is not a JSON document");
    expect(list({ rest: ["--home", dir] }).out).toEqual(["reading list: the ledger holds no readings that match"]);
  });

  it.each([
    [
      "every author — the 2 Oct bump seat's shape",
      "github landing",
      '{"rows":[],"selection":{"includeDrafts":true,"repos":["a/b"]}}',
    ],
    [
      "a colleague's login",
      "github landing",
      '{"rows":[],"selection":{"author":"user1-acme","includeDrafts":true,"repos":[]}}',
    ],
    ["every author, the producer spelled to the same slug", "GitHub_Landing", '{"rows":[],"selection":{"repos":[]}}'],
    ["a selection that is not an object", "github landing", '{"rows":[],"selection":null}'],
  ])("refuses a landing document read over %s, writing nothing", async (_shape, producer, text) => {
    const dir = home();
    const ran = await record({
      rest: ["--producer", producer, "--from", landingFile({ dir, text }), "--by", "bump", "--home", dir],
    });
    expect(ran.exit).toBe(EXIT_ERROR);
    expect(ran.diagnostics).toEqual([
      `reading record: a "${producer}" document must be read with --author @me — the landing ledger is the ` +
        "Queue's reading of the owner's pull requests, so anybody else's is never recorded",
    ]);
    expect(list({ rest: ["--home", dir] }).out).toEqual(["reading list: the ledger holds no readings that match"]);
  });

  it("refuses a landing document that is not an object at all", async () => {
    const dir = home();
    const ran = await record({
      rest: ["--producer", "github landing", "--from", landingFile({ dir, text: "[]" }), "--by", "b", "--home", dir],
    });
    expect(ran.exit).toBe(EXIT_ERROR);
    expect(ran.diagnostics).toEqual([
      'reading record: a "github landing" document must be a JSON object — the page and the Queue draw nothing ' +
        "from any other shape",
    ]);
  });

  it("records a github landing document read as @ME, and any other producer's selection untouched", async () => {
    const dir = home();
    const mine = landingFile({ dir, text: '{"rows":[],"selection":{"author":"@ME","includeDrafts":true,"repos":[]}}' });
    const other = join(dir, "other.json");
    writeFileSync(other, '{"selection":{"author":"someone"}}');
    const ran = await record({ rest: ["--producer", "github landing", "--from", mine, "--by", "b", "--home", dir] });
    const elsewhere = await record({ rest: ["--producer", "p", "--from", other, "--by", "b", "--home", dir] });
    expect([ran.exit, elsewhere.exit]).toEqual([EXIT_OK, EXIT_OK]);
  });

  it("refuses a missing flag as a usage mistake", async () => {
    const ran = await record({ rest: ["--producer", "p"] });
    expect(ran.exit).toBe(EXIT_USAGE);
    expect(ran.diagnostics[0]).toBe("reading record: --producer, --from and --by are all required");
  });
});

describe("reading last", () => {
  it("exits 3 and says so when the producer has no reading yet", () => {
    const ran = last({ rest: ["--producer", "github landing", "--home", home()] });
    expect(ran.exit).toBe(EXIT_EXPECTED_EMPTY);
    expect(ran.diagnostics).toEqual([
      "reading last: the readings ledger holds no reading by `github landing` yet — record one with `slopweaver reading record`",
    ]);
  });

  it("prints the latest reading in the human view", async () => {
    const dir = home();
    await record({
      rest: ["--producer", "github landing", "--from", landingFile({ dir }), "--by", "tick-12", "--home", dir],
    });
    const ran = last({ rest: ["--producer", "github landing", "--home", dir] });
    expect(ran.exit).toBe(EXIT_OK);
    expect(ran.out).toEqual([
      "reading last: 2026-09-20T02:30:00.000Z-github-landing — github landing by tick-12, 68 bytes",
      "  true as of 2026-09-20T02:30:00.000Z, recorded 2026-09-20T02:30:00.000Z",
    ]);
  });

  it("serves the console's landing channel the landing, never a cadence skip recorded after it", async () => {
    // The argv the site's `landing-reading` row runs (`site/lib/liveVerbs.ts`); both sidebar badges read it.
    const dir = home();
    await record({
      rest: ["--producer", "github landing", "--from", landingFile({ dir }), "--by", "tick-864", "--home", dir],
    });
    const skip = '{"cadenceMinutes":30,"kind":"skipped","selection":"o/r@@me","why":"not due"}';
    const skipped = await record({
      rest: ["--producer", "github landing", "--from", "-", "--by", "tick-865", "--home", dir],
      stdin: skip,
    });
    expect(skipped.exit).toBe(EXIT_OK);
    expect(list({ rest: ["--producer", "github landing", "--home", dir] }).out.length).toBe(2);
    const read = last({ rest: ["--producer", "github landing", "--home", dir, "--json"] });
    expect(read.exit).toBe(EXIT_OK);
    const served = JSON.parse(read.out[0]!) as { by: string; document: unknown };
    expect(served.by).toBe("tick-864");
    expect(served.document).toEqual(JSON.parse(LANDING));
  });

  it("requires --producer", () => {
    const ran = last({ rest: [] });
    expect(ran.exit).toBe(EXIT_USAGE);
    expect(ran.diagnostics[0]).toBe("reading last: --producer is required");
  });
});

describe("reading list", () => {
  it("prints every row oldest first, and filters by producer slug", async () => {
    const dir = home();
    await record({
      rest: ["--producer", "github landing", "--from", landingFile({ dir }), "--by", "tick-12", "--home", dir],
    });
    const all = list({ rest: ["--home", dir] });
    expect(all.exit).toBe(EXIT_OK);
    expect(all.out).toEqual([
      "2026-09-20T02:30:00.000Z  tick-12  github landing  68 bytes  2026-09-20T02:30:00.000Z-github-landing",
    ]);
    expect(list({ rest: ["--home", dir, "--producer", "Github Landing"] }).out.length).toBe(1);
    expect(list({ rest: ["--home", dir, "--producer", "velocity"] }).out).toEqual([
      "reading list: the ledger holds no readings that match",
    ]);
  });
});

describe("documentObservedAt", () => {
  it("answers the top-level string, and nothing for any other shape", () => {
    expect(documentObservedAt({ document: { observedAtIso: "2026-09-20T02:00:00Z" } })).toBe("2026-09-20T02:00:00Z");
    expect(documentObservedAt({ document: { observedAtIso: 5 } })).toBeUndefined();
    expect(documentObservedAt({ document: [] })).toBeUndefined();
    expect(documentObservedAt({ document: null })).toBeUndefined();
  });
});

describe("the flag lists the help-truth ratchet reads", () => {
  it("are sorted and complete", () => {
    expect(READING_RECORD_FLAG_NAMES).toEqual(["--by", "--from", "--home", "--json", "--observed-at", "--producer"]);
    expect(READING_LAST_FLAG_NAMES).toEqual(["--home", "--json", "--producer"]);
    expect(READING_LIST_FLAG_NAMES).toEqual(["--home", "--json", "--producer"]);
  });
});
