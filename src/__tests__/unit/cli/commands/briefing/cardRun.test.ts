/**
 * `briefing card`'s shell: what it parses, what it refuses, what it prints, and the property that matters
 * most — a refusal, a dry run and a failed gate all leave the document exactly as it was.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { PAGE_MARKS_REQUIRED_FROM_ISO } from "../../../../../briefing/openPageCards.js";
import {
  mapPageReader,
  type PrefetchedPage,
  PublishedPageReadErrors,
} from "../../../../../briefing/publishedPageRead.js";
import { boardRowOnDisk } from "../../../../../cli/commands/briefing/cardDropRun.js";
import { type BriefingCardDeps, runBriefingCard } from "../../../../../cli/commands/briefing/cardRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { readExactVoiceRules } from "../../../../../profileStore.js";
import { lockInLedgerPath, readLockInLedgerExact } from "../../../../../sessionStart/lockIn.js";
import {
  type PublishedPagesReadError,
  PublishedPagesReadErrors,
} from "../../../../../store/publishedPages/readErrors.js";

const NOW = "2026-09-16T20:00:00Z";
const HOME = "/Users/owner/.slopweaver";
const PAGES = `${HOME}/pages`;
const FIRST = `file://${PAGES}/first/index.html`;
const SECOND = `file://${PAGES}/second/index.html`;
const DOC = "/scratch/open-pages.json";
const ROW = "/scratch/row.json";

/** One row carrying every field a card needs, under every cap. */
function row({ url = FIRST, over = {} }: { url?: string; over?: Record<string, unknown> } = {}): Record<
  string,
  unknown
> {
  return {
    ask: "Your word on which reader the fleet ships.",
    ifSilent: "The branch waits and a stale seat keeps failing to record a ruling.",
    label: "a stale branch cannot read a journal line newer main wrote",
    landedIso: "2026-09-16T19:30:00Z",
    lean: "C, because A removes the wedge by construction and B makes any surviving refusal self-servicing.",
    options: [
      { letter: "A", text: "Tell the supervisor A and the session ships the tolerant reader alone." },
      { letter: "B", text: "Tell the supervisor B and the session ships the self-servicing refusal alone." },
    ],
    question: "Which journal fix does the fleet ship, the tolerant reader or the self-servicing refusal?",
    url,
    what: "A session on a two-day-old branch tried to record your ruling and was refused. The journal held a line its older parser could not read. A makes an unknown event kind readable. B makes the refusal name the kind and tell the session to pull.",
    whyYou: "Which of two journal readers the fleet trusts across every branch is a preference only you can set.",
    ...over,
  };
}

/** Why the default seams' page cannot supply its pair: it was never frozen, which the line must say, not "unmarked". */
const TYPED_BECAUSE = `its published bytes could not be read (${PublishedPagesReadErrors.neverFrozen({ pageKey: FIRST }).message})`;

/** The line a row reports when its page predates the marks and its question and lean stay typed. */
const TYPED_LINE =
  `briefing card: this row's question and lean are TYPED, because ${TYPED_BECAUSE} and the page landed before ` +
  `${PAGE_MARKS_REQUIRED_FROM_ISO}; republish the page with data-card marks and drop both ` +
  "keys from the row so the card reads them from the page";

/**
 * A prefetch over the home's frozen pages by url, answering only the URLs the verb asks for, so a page it reads
 * without prefetching it refuses. A down store refuses the set, naming the first page, as the adapter does.
 */
function prefetchOver({
  pages,
  storeDown,
}: {
  pages: Record<string, string>;
  storeDown: PublishedPagesReadError | undefined;
}): BriefingCardDeps["prefetchPublishedPages"] {
  return ({ urls }) => {
    const first = urls[0];
    if (storeDown !== undefined && first !== undefined) {
      return Promise.resolve(err(PublishedPageReadErrors.unreadable({ cause: storeDown, url: first })));
    }
    const read = urls.map((url): [string, PrefetchedPage] => {
      const html = pages[url];
      return [url, html === undefined ? err(PublishedPagesReadErrors.neverFrozen({ pageKey: url })) : ok(html)];
    });
    return Promise.resolve(ok(mapPageReader({ pages: new Map(read) })));
  };
}

/**
 * A fake filesystem of named files plus a stdin and the home's frozen pages by url, capturing both output lanes
 * and every write. A page not in `pages` answers as never frozen.
 */
function seams({
  files,
  stdin = "",
  pages = {},
  opens = {},
  lockIns = "",
  readLockInsExact = () => ok(lockIns),
  readBoardRow = ({ slug }) => ({ kind: "unreadable", slug, why: "this fake has no board" }),
  storeDown,
}: {
  files: Record<string, string>;
  stdin?: string;
  pages?: Record<string, string>;
  /** Why the published-page store refuses every prefetch; it answers when this is absent. */
  storeDown?: PublishedPagesReadError;
  /** The pages whose file each path is on disk; a path absent here opens none. */
  opens?: Record<string, readonly string[]>;
  /** The home's raw lock-in ledger. */
  lockIns?: string;
  /** The drop arm's strict read of that ledger; by default it reads `lockIns`. */
  readLockInsExact?: BriefingCardDeps["readLockInsExact"];
  /** The seam onto the home's board, for `--settled-by`. */
  readBoardRow?: BriefingCardDeps["readBoardRow"];
}): {
  deps: BriefingCardDeps;
  out: string[];
  diagnostics: string[];
  writes: { path: string; text: string }[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const writes: { path: string; text: string }[] = [];
  const read = ({ path }: { path: string }): string => {
    const text = files[path];
    if (text === undefined) {
      throw new Error(`ENOENT: ${path}`);
    }
    return text;
  };
  return {
    deps: {
      applyFraming: true,
      applyVoice: () => true,
      now: () => NOW,
      readBoardRow,
      readFile: read,
      readLockIns: () => lockIns,
      readLockInsExact,
      prefetchPublishedPages: prefetchOver({ pages, storeDown }),
      readRow: ({ source }) => (source === "-" ? stdin : read({ path: source })),
      pagesOpened: ({ path }) => (Object.hasOwn(opens, path) ? opens[path]! : []),
      voiceRules: () => ok([]),
      writeDiagnostic: (line) => diagnostics.push(line),
      writeFile: ({ path, text }) => writes.push({ path, text }),
      writeOut: (line) => out.push(line),
    },
    diagnostics,
    out,
    writes,
  };
}

const ARGV: readonly string[] = ["--open-pages", DOC, "--row", ROW, "--home", HOME];

describe("runBriefingCard", () => {
  it("refuses an invocation missing --open-pages or --row with usage, touching nothing", async () => {
    const fake = seams({ files: {} });

    expect(await runBriefingCard({ deps: fake.deps, rest: ["--row", ROW] })).toBe(EXIT_USAGE);
    expect(fake.diagnostics[0]).toBe("briefing card: --open-pages is required");
    expect(fake.diagnostics.at(-1)).toContain(
      "usage: slopweaver briefing card --open-pages <path> (--row <path|-> [--replace] | --drop <url> [--settled-by <slug>])",
    );
    expect(fake.writes).toEqual([]);
  });

  it("appends a row that passes every gate, as two-space JSON with a trailing newline", async () => {
    const existing = row({ url: SECOND });
    const fake = seams({ files: { [DOC]: JSON.stringify([existing]), [ROW]: JSON.stringify(row()) } });

    expect(await runBriefingCard({ deps: fake.deps, rest: ARGV })).toBe(EXIT_OK);
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]!.path).toBe(DOC);
    expect(fake.writes[0]!.text).toBe(`${JSON.stringify([existing, row()], null, 2)}\n`);
    expect(fake.out).toEqual([
      `briefing card: appended ${FIRST} at row 2 of 2; 150 words above the fold; wrote ${DOC}`,
      TYPED_LINE,
    ]);
    expect(fake.diagnostics).toEqual([]);
  });

  it("builds the card from the page's own marks and says nothing about typing when the row types neither", async () => {
    const { question: _question, lean: _lean, ...untyped } = row();
    const page =
      '<p data-card="question">Which journal fix does the fleet ship first?</p>' +
      '<p data-card="lean">A, because it removes the wedge by construction.</p>';
    const fake = seams({ files: { [DOC]: "[]", [ROW]: JSON.stringify(untyped) }, pages: { [FIRST]: page } });

    expect(await runBriefingCard({ deps: fake.deps, rest: [...ARGV, "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(fake.out[0]!)).toMatchObject({ typed: false, typedBecause: null, url: FIRST, written: true });
    expect(fake.writes[0]!.text).toBe(`${JSON.stringify([untyped], null, 2)}\n`);
  });

  it("refuses a row whose url is a symlink opening a page that marks another lean, writing nothing", async () => {
    const { question: _question, lean: _lean, ...untyped } = row();
    const question = '<p data-card="question">Which journal fix does the fleet ship first?</p>';
    const fake = seams({
      files: { [DOC]: "[]", [ROW]: JSON.stringify(untyped) },
      pages: {
        [FIRST]: `${question}<p data-card="lean">B, because the refusal is enough.</p>`,
        [SECOND]: `${question}<p data-card="lean">A, because it removes the wedge by construction.</p>`,
      },
      opens: { [`${PAGES}/first/index.html`]: ["first", "second"] },
    });

    expect(await runBriefingCard({ deps: fake.deps, rest: ARGV })).toBe(EXIT_ERROR);
    expect(fake.diagnostics.join("\n")).toContain('lean "A, because it removes the wedge by construction."');
    expect(fake.writes).toEqual([]);
  });

  it("refuses a row landed after the cutoff whose page was never frozen, writing nothing", async () => {
    const fake = seams({
      files: { [DOC]: "[]", [ROW]: JSON.stringify(row({ over: { landedIso: "2026-10-02T09:00:00Z" } })) },
    });

    expect(await runBriefingCard({ deps: fake.deps, rest: ARGV })).toBe(EXIT_ERROR);
    expect(fake.writes).toEqual([]);
    expect(fake.diagnostics[1]).toContain(TYPED_BECAUSE);
  });

  it("refuses a row whose page the store cannot give, naming it, rather than typing the pair, writing nothing", async () => {
    const down = PublishedPagesReadErrors.unavailable({ cause: new Error("connection refused"), doing: "connect" });
    const fake = seams({ files: { [DOC]: "[]", [ROW]: JSON.stringify(row()) }, storeDown: down });

    expect(await runBriefingCard({ deps: fake.deps, rest: ARGV })).toBe(EXIT_ERROR);
    expect(fake.diagnostics).toEqual([
      `briefing card: ${PublishedPageReadErrors.unreadable({ cause: down, url: FIRST }).message}`,
      `briefing card: nothing was written to ${DOC}`,
    ]);
    expect(fake.writes).toEqual([]);
    expect(fake.out).toEqual([]);
  });

  it("refuses a CORRUPT profile.json with the error code, writing nothing, rather than gating against no voice rules", async () => {
    const home = mkdtempSync(join(tmpdir(), "briefing-card-corrupt-"));
    try {
      writeFileSync(join(home, "profile.json"), "{", "utf8");
      const fake = seams({ files: { [DOC]: "[]", [ROW]: JSON.stringify(row()) } });
      const deps: BriefingCardDeps = { ...fake.deps, voiceRules: ({ home: at }) => readExactVoiceRules({ home: at }) };

      expect(await runBriefingCard({ deps, rest: ["--open-pages", DOC, "--row", ROW, "--home", home] })).toBe(
        EXIT_ERROR,
      );
      expect(fake.writes).toEqual([]);
      expect(fake.out).toEqual([]);
      expect(fake.diagnostics).toHaveLength(2);
      expect(fake.diagnostics[0]).toContain(
        `the profile at ${join(home, "profile.json")} is there but cannot be trusted`,
      );
      expect(fake.diagnostics[1]).toBe(`briefing card: nothing was written to ${DOC}`);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("reads the row off stdin for --row -", async () => {
    const fake = seams({ files: { [DOC]: "[]" }, stdin: JSON.stringify(row()) });

    expect(await runBriefingCard({ deps: fake.deps, rest: ["--open-pages", DOC, "--row", "-", "--home", HOME] })).toBe(
      EXIT_OK,
    );
    expect(fake.writes[0]!.text).toBe(`${JSON.stringify([row()], null, 2)}\n`);
  });

  it("prints one JSON object under --json", async () => {
    const fake = seams({ files: { [DOC]: "[]", [ROW]: JSON.stringify(row()) } });

    expect(await runBriefingCard({ deps: fake.deps, rest: [...ARGV, "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(fake.out[0]!)).toEqual({
      aboveFoldWords: 150,
      action: "appended",
      otherRowRefusals: [],
      path: DOC,
      position: 1,
      rows: 1,
      typed: true,
      typedBecause: TYPED_BECAUSE,
      url: FIRST,
      written: true,
    });
  });

  it("names an UNMARKED page as the reason, when its frozen bytes were read and mark nothing", async () => {
    const fake = seams({ files: { [DOC]: "[]", [ROW]: JSON.stringify(row()) }, pages: { [FIRST]: "<p>A.</p>" } });

    expect(await runBriefingCard({ deps: fake.deps, rest: [...ARGV, "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(fake.out[0]!)).toMatchObject({
      typed: true,
      typedBecause: "the page marks no question and no lean",
    });
  });

  it("validates and reports under --dry-run, writing nothing", async () => {
    const fake = seams({ files: { [DOC]: "[]", [ROW]: JSON.stringify(row()) } });

    expect(await runBriefingCard({ deps: fake.deps, rest: [...ARGV, "--dry-run"] })).toBe(EXIT_OK);
    expect(fake.writes).toEqual([]);
    expect(fake.out).toEqual([
      `briefing card: appended ${FIRST} at row 1 of 1; 150 words above the fold; dry run, nothing written to ${DOC}`,
      TYPED_LINE,
    ]);
  });

  it("refuses a row the card gate refuses, one defect per line, writing nothing", async () => {
    const fake = seams({ files: { [DOC]: "[]", [ROW]: JSON.stringify(row({ over: { lean: undefined } })) } });

    expect(await runBriefingCard({ deps: fake.deps, rest: ARGV })).toBe(EXIT_ERROR);
    expect(fake.writes).toEqual([]);
    expect(fake.diagnostics[0]).toBe(
      "briefing card: the row would render as a card the page gate refuses (1 defect(s))",
    );
    expect(fake.diagnostics[1]).toContain(
      '  open page "a stale branch cannot read a journal line newer main wrote" cannot become a card: it is missing lean',
    );
    expect(fake.diagnostics[2]).toBe(`briefing card: nothing was written to ${DOC}`);
  });

  it("refuses a duplicate url and swaps it in under --replace", async () => {
    const fresh = row({ over: { lean: "B, on reflection, since the refusal already names the kind." } });
    const files = { [DOC]: JSON.stringify([row({ url: SECOND }), row()]), [ROW]: JSON.stringify(fresh) };
    const refused = seams({ files });

    expect(await runBriefingCard({ deps: refused.deps, rest: ARGV })).toBe(EXIT_ERROR);
    expect(refused.writes).toEqual([]);
    expect(refused.diagnostics).toEqual([
      `briefing card: row 2 already names ${FIRST} — pass --replace to swap it in place`,
      `briefing card: nothing was written to ${DOC}`,
    ]);

    const replaced = seams({ files });
    expect(await runBriefingCard({ deps: replaced.deps, rest: [...ARGV, "--replace"] })).toBe(EXIT_OK);
    expect(replaced.writes[0]!.text).toBe(`${JSON.stringify([row({ url: SECOND }), fresh], null, 2)}\n`);
    expect(replaced.out[0]).toBe(
      `briefing card: replaced ${FIRST} at row 2 of 2; 145 words above the fold; wrote ${DOC}`,
    );
  });

  it("reports what --open-page-cards would refuse in the other rows, beside a write it still makes", async () => {
    const stale = row({ url: SECOND, over: { whyYou: undefined } });
    const fake = seams({ files: { [DOC]: JSON.stringify([stale]), [ROW]: JSON.stringify(row()) } });

    expect(await runBriefingCard({ deps: fake.deps, rest: ARGV })).toBe(EXIT_OK);
    expect(fake.writes).toHaveLength(1);
    expect(fake.out[1]).toBe(TYPED_LINE);
    expect(fake.out[2]).toBe("briefing card: 1 other row(s) would be refused by --open-page-cards:");
    expect(fake.out[3]).toContain("it is missing whyYou");
  });

  it("refuses an unreadable row and an unreadable document, writing nothing", async () => {
    const noRow = seams({ files: { [DOC]: "[]" } });
    expect(await runBriefingCard({ deps: noRow.deps, rest: ARGV })).toBe(EXIT_ERROR);
    expect(noRow.diagnostics[0]).toBe(`briefing card: ${ROW}: could not read the row — ENOENT: ${ROW}`);
    expect(noRow.writes).toEqual([]);

    const noDoc = seams({ files: { [ROW]: JSON.stringify(row()) } });
    expect(await runBriefingCard({ deps: noDoc.deps, rest: ARGV })).toBe(EXIT_ERROR);
    expect(noDoc.diagnostics[0]).toBe(`briefing card: ${DOC}: could not read the form — ENOENT: ${DOC}`);
    expect(noDoc.writes).toEqual([]);
  });

  it("refuses a document that is not an array, writing nothing", async () => {
    const fake = seams({ files: { [DOC]: JSON.stringify({ rows: [] }), [ROW]: JSON.stringify(row()) } });

    expect(await runBriefingCard({ deps: fake.deps, rest: ARGV })).toBe(EXIT_ERROR);
    expect(fake.diagnostics[0]).toBe(
      "briefing card: the open-pages document is a JSON array of open pages, one object each",
    );
    expect(fake.writes).toEqual([]);
  });
});

/** A lock-in line settling FIRST, the shape `session-start lock-in` writes. */
const APPROVED = JSON.stringify({
  againstWhenIso: "2026-09-12T20:0xZ",
  identity: FIRST,
  outcome: "approved-as-proposed",
  proposed: "the lean",
  schemaVersion: 1,
  tsIso: "2026-09-12T21:27:58.761Z",
  verb: "do",
});

const DROP_ARGV: readonly string[] = ["--open-pages", DOC, "--drop", FIRST, "--home", HOME];

describe("runBriefingCard --drop", () => {
  const rows = [row({ url: SECOND }), row(), row({ over: { extra: { kept: true } }, url: `${SECOND}?v=2` })];

  it.each([
    [["--open-pages", DOC], "one of --row <path|-> or --drop <url> is required"],
    [
      ["--open-pages", DOC, "--row", ROW, "--drop", FIRST],
      "--row and --drop are exclusive: --row places one row, --drop removes one",
    ],
    [
      ["--open-pages", DOC, "--drop", FIRST, "--replace"],
      "--replace swaps a --row in place, so it is only accepted beside --row",
    ],
    [
      ["--open-pages", DOC, "--row", ROW, "--settled-by", "a-row"],
      "--settled-by names the board row settling a --drop url, so it is only accepted beside --drop",
    ],
    [["--open-pages", DOC, "--drop="], "--drop was given an empty value"],
  ])("refuses %j with usage before reading anything", async (rest, line) => {
    const fake = seams({ files: {} });

    expect(await runBriefingCard({ deps: fake.deps, rest })).toBe(EXIT_USAGE);
    expect(fake.diagnostics[0]).toBe(`briefing card: ${line}`);
    expect(fake.writes).toEqual([]);
  });

  it("validates and reports a settled drop under --dry-run, writing nothing", async () => {
    const fake = seams({ files: { [DOC]: JSON.stringify(rows) }, lockIns: APPROVED });

    expect(await runBriefingCard({ deps: fake.deps, rest: [...DROP_ARGV, "--dry-run"] })).toBe(EXIT_OK);
    expect(fake.writes).toEqual([]);
    expect(fake.out).toEqual([
      `briefing card: dropped ${FIRST} from row 2; 2 row(s) remain; settled by the owner's lock-in approved-as-proposed ` +
        `under ${FIRST} (2026-09-12T21:27:58.761Z); dry run, nothing written to ${DOC}`,
    ]);
    expect(fake.diagnostics).toEqual([]);
  });

  it("writes the document less exactly that row, every other row byte-for-byte, and reports it under --json", async () => {
    const fake = seams({ files: { [DOC]: JSON.stringify(rows) }, lockIns: APPROVED });

    expect(await runBriefingCard({ deps: fake.deps, rest: [...DROP_ARGV, "--json"] })).toBe(EXIT_OK);
    expect(fake.writes).toEqual([{ path: DOC, text: `${JSON.stringify([rows[0], rows[2]], null, 2)}\n` }]);
    expect(JSON.parse(fake.out[0]!)).toEqual({
      action: "dropped",
      evidence: {
        key: FIRST,
        kind: "lock-in",
        outcome: "approved-as-proposed",
        resolvedAtIso: "2026-09-12T21:27:58.761Z",
      },
      path: DOC,
      position: 2,
      rows: 2,
      url: FIRST,
      written: true,
    });
  });

  it("refuses a page nothing settles, one reason per line, writing nothing", async () => {
    const fake = seams({ files: { [DOC]: JSON.stringify(rows) } });

    expect(await runBriefingCard({ deps: fake.deps, rest: [...DROP_ARGV, "--settled-by", "a-row"] })).toBe(EXIT_ERROR);
    expect(fake.diagnostics).toEqual([
      `briefing card: nothing on record settles ${FIRST}, so its row stays — record the owner's ruling with ` +
        "`session-start lock-in`, or name the board row that settled it with --settled-by <slug>",
      `  lock-in: no resolution is recorded under ${FIRST}, page:first`,
      "  --settled-by a-row: this fake has no board",
      `briefing card: nothing was written to ${DOC}`,
    ]);
    expect(fake.writes).toEqual([]);
    expect(fake.out).toEqual([]);
  });

  it("refuses a url no row names and an unreadable document, writing nothing", async () => {
    const missing = seams({ files: { [DOC]: JSON.stringify([rows[0]]) }, lockIns: APPROVED });
    expect(await runBriefingCard({ deps: missing.deps, rest: DROP_ARGV })).toBe(EXIT_ERROR);
    expect(missing.diagnostics).toEqual([
      `briefing card: none of the 1 row(s) names ${FIRST} exactly`,
      `briefing card: nothing was written to ${DOC}`,
    ]);
    expect(missing.writes).toEqual([]);

    const noDoc = seams({ files: {}, lockIns: APPROVED });
    expect(await runBriefingCard({ deps: noDoc.deps, rest: DROP_ARGV })).toBe(EXIT_ERROR);
    expect(noDoc.diagnostics).toEqual([
      `briefing card: ${DOC}: could not read the form — ENOENT: ${DOC}`,
      `briefing card: nothing was written to ${DOC}`,
    ]);
    expect(noDoc.writes).toEqual([]);
  });

  it("refuses a drop, --settled-by and all, when the home's lock-in ledger exists and will not read", async () => {
    const home = mkdtempSync(join(tmpdir(), "card-drop-ledger-"));
    try {
      // A directory where the ledger file belongs: present, and unreadable as a file.
      mkdirSync(lockInLedgerPath({ home }), { recursive: true });
      const fake = seams({
        files: { [DOC]: JSON.stringify(rows) },
        readBoardRow: boardRowOnDisk,
        readLockInsExact: readLockInLedgerExact,
      });
      const argv = ["--open-pages", DOC, "--drop", FIRST, "--home", home, "--settled-by", "a-row"];

      expect(await runBriefingCard({ deps: fake.deps, rest: argv })).toBe(EXIT_ERROR);
      expect(fake.diagnostics[0]).toContain(
        `briefing card: refused: the lock-in ledger at ${lockInLedgerPath({ home })}`,
      );
      expect(fake.diagnostics[0]).toContain("so the owner's last word on the page is unknown");
      expect(fake.diagnostics.at(-1)).toBe(`briefing card: nothing was written to ${DOC}`);
      expect(fake.writes).toEqual([]);
      // Refused before any read, so a FIFO's blocking read is never reached; a directory is the same branch.
      expect(unwrapErr(readLockInLedgerExact({ home }))).toEqual([
        `the lock-in ledger at ${lockInLedgerPath({ home })} is not a regular file, so it was not read`,
      ]);
      expect(unwrap(readLockInLedgerExact({ home: join(home, "absent") }))).toBe("");
      // A dangling link where the ledger belongs exists and will not read, so it is no empty ledger.
      const linked = join(home, "linked");
      mkdirSync(dirname(lockInLedgerPath({ home: linked })), { recursive: true });
      symlinkSync(join(home, "nowhere.jsonl"), lockInLedgerPath({ home: linked }));
      expect(unwrapErr(readLockInLedgerExact({ home: linked }))[0]).toContain(
        `the lock-in ledger at ${lockInLedgerPath({ home: linked })} would not read`,
      );
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("drops on --settled-by against a real home's board row, and refuses a slug no doc carries", async () => {
    const home = mkdtempSync(join(tmpdir(), "card-drop-"));
    try {
      mkdirSync(join(home, "handovers"), { recursive: true });
      mkdirSync(join(home, "runs"), { recursive: true });
      writeFileSync(join(home, "handovers", "a-row.md"), "---\nslug: a-row\nstatus: ready\n---\n# doc\n");
      writeFileSync(
        join(home, "runs", "a-row.jsonl"),
        [
          JSON.stringify({ atIso: "2026-09-12T20:00:00.000Z", kind: "artifact", url: FIRST }),
          JSON.stringify({ atIso: "2026-09-13T20:00:00.000Z", kind: "closed", residue: [], summary: "shipped" }),
          "",
        ].join("\n"),
      );
      const argv = ["--open-pages", DOC, "--drop", FIRST, "--home", home, "--json"];
      const fake = seams({ files: { [DOC]: JSON.stringify(rows) }, readBoardRow: boardRowOnDisk });

      expect(await runBriefingCard({ deps: fake.deps, rest: [...argv, "--settled-by", "a-row"] })).toBe(EXIT_OK);
      expect(JSON.parse(fake.out[0]!)).toMatchObject({
        evidence: {
          artifactFrom: "journal",
          kind: "board-row",
          settledBecause: "status done (from closed-event)",
          slug: "a-row",
        },
        position: 2,
        rows: 2,
        written: true,
      });

      const absent = seams({ files: { [DOC]: JSON.stringify(rows) }, readBoardRow: boardRowOnDisk });
      expect(await runBriefingCard({ deps: absent.deps, rest: [...argv, "--settled-by", "no-such-row"] })).toBe(
        EXIT_ERROR,
      );
      expect(absent.diagnostics[2]).toBe("  --settled-by no-such-row: no doc carries that board row, live or archived");
      expect(absent.writes).toEqual([]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});
