import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { partialReadReasons, unreadableSubReads } from "../../../cli/commands/sweep/boardPartialRead.js";
import { boardSupersessions, readRowTexts } from "../../../cli/commands/sweep/rowTexts.js";
import type { RunEvent } from "../../../handover/ledger.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("partialReadReasons", () => {
  it("reads a whole board as no reasons, so the publish arm is not the default refusal", () => {
    expect(
      partialReadReasons({ elsewhere: false, filtered: false, subReads: [], unreadable: [], unresolved: 0 }),
    ).toEqual([]);
  });

  it("names every way a read was partial, in the order a reader meets them", () => {
    expect(
      partialReadReasons({
        elsewhere: true,
        filtered: true,
        subReads: ["1 run journal(s) held a line that could not be read: row-a"],
        unreadable: ["broken.md"],
        unresolved: 2,
      }),
    ).toEqual([
      "1 handover file(s) could not be read: broken.md",
      "1 run journal(s) held a line that could not be read: row-a",
      "the deadline left 2 row(s)' probes unevaluated",
      "--verdict or --priority narrowed the selection, and the document is the whole board",
      "--dir read a directory other than this home's handovers, and the document is this home's board",
    ]);
  });
});

describe("readRowTexts", () => {
  it("returns the slug of a row whose file went between the scan and this read", () => {
    const dir = mkdtempSync(join(tmpdir(), "row-texts-"));
    dirs.push(dir);
    writeFileSync(join(dir, "kept.md"), "kept text");
    const read = readRowTexts({
      models: [
        { doc: { askedIso: "2026-09-26T00:00:00.000Z", path: join(dir, "kept.md"), slug: "kept" } },
        { doc: { askedIso: "2026-09-26T00:00:00.000Z", path: join(dir, "gone.md"), slug: "gone" } },
      ],
    });
    expect(read.inputs.map((input) => input.slug)).toEqual(["kept"]);
    expect(read.unreadable).toEqual(["gone"]);
  });
});

describe("boardSupersessions", () => {
  const OLD = "vulnerability-fix-topup-acme-api-1790000000000";
  const NEW = "vulnerability-fix-topup-acme-api-1790100000000";
  // A one-member batch as `topupAsk` writes it; on the board the line break stays the YAML escape.
  const BATCH = [
    "Raise 1 vulnerability-fix pull request(s) in acme/api as bot, to bring the open set back to 10.",
    "",
    "The batch, worst CVSS first:",
    "  - handlebars (npm, yarn.lock) — critical CVSS 9.8, GHSA-8r5x-fm3f-whwj, alert https://github.com/acme/api/security/dependabot/1089, first patched 4.7.10",
  ];
  const brief = ({ slug, askedIso }: { slug: string; askedIso: string }) =>
    [
      "---",
      `slug: ${slug}`,
      "kind: ask",
      `summary: "${BATCH.join("\\n")}"`,
      "status: ready",
      `askedIso: ${askedIso}`,
      "blockedBy: []",
      "artifact: null",
      "doneWhen: []",
      "settlement: answered",
      "settlementWitness: raised",
      "---",
      "",
    ].join("\n");

  it("reads a later generation the archive holds as overtaking a live one", () => {
    const dir = mkdtempSync(join(tmpdir(), "board-supersessions-"));
    dirs.push(dir);
    mkdirSync(join(dir, "archive"));
    writeFileSync(join(dir, "archive", `${NEW}.md`), brief({ askedIso: "2026-10-02T00:00:00.000Z", slug: NEW }));
    const old = { askedIso: "2026-10-01T00:00:00.000Z", path: join(dir, `${OLD}.md`), slug: OLD };
    writeFileSync(old.path, "a live row");
    const read = boardSupersessions({
      docs: [{ ...old, problems: [], summary: BATCH.join("\n") }],
      handoverDir: dir,
      journals: new Map(),
      live: [{ doc: old }],
    });
    expect([...read.edges]).toEqual([
      [
        OLD,
        {
          kind: "generation",
          newerSlug: NEW,
          recipe: "vulnerability-fix-topup-api",
          registeredIso: "2026-09-22T18:00:00.000Z",
        },
      ],
    ]);
    expect(read.unreadable).toEqual([]);
    expect(read.archiveUnreadable).toEqual([]);
  });

  it("gives a row a seat was dispatched to and has not started no generation edge, until something answers it", () => {
    const dir = mkdtempSync(join(tmpdir(), "board-supersessions-"));
    dirs.push(dir);
    mkdirSync(join(dir, "archive"));
    writeFileSync(join(dir, "archive", `${NEW}.md`), brief({ askedIso: "2026-10-02T00:00:00.000Z", slug: NEW }));
    const old = { askedIso: "2026-10-01T00:00:00.000Z", path: join(dir, `${OLD}.md`), slug: OLD };
    writeFileSync(old.path, "a live row");
    const dispatched = {
      atIso: "2026-10-03T00:00:00.000Z",
      by: "supervisor",
      kind: "dispatched",
      target: "workspace:7",
    } as const;
    const read = ({ events }: { events: readonly RunEvent[] }) =>
      boardSupersessions({
        docs: [{ ...old, problems: [], summary: BATCH.join("\n") }],
        handoverDir: dir,
        journals: new Map([[OLD, { events }]]),
        live: [{ doc: old }],
      }).edges;
    expect([...read({ events: [dispatched] })]).toEqual([]);
    const abandoned = { atIso: "2026-10-04T00:00:00.000Z", kind: "abandoned", why: "no-show" } as const;
    expect([...read({ events: [dispatched, abandoned] }).keys()]).toEqual([OLD]);
  });

  it("never reads an archived generation whose front matter has problems, which the board trusts none of", () => {
    const dir = mkdtempSync(join(tmpdir(), "board-supersessions-"));
    dirs.push(dir);
    mkdirSync(join(dir, "archive"));
    // A key declared twice: the first value is kept and a problem recorded, so the doc still parses.
    const malformed = brief({ askedIso: "2026-10-02T00:00:00.000Z", slug: NEW }).replace(
      "blockedBy: []",
      "blockedBy: []\nblockedBy: []",
    );
    writeFileSync(join(dir, "archive", `${NEW}.md`), malformed);
    const old = { askedIso: "2026-10-01T00:00:00.000Z", path: join(dir, `${OLD}.md`), slug: OLD };
    writeFileSync(old.path, "a live row");
    const read = boardSupersessions({
      docs: [{ ...old, problems: [], summary: BATCH.join("\n") }],
      handoverDir: dir,
      journals: new Map(),
      live: [{ doc: old }],
    });
    expect([...read.edges]).toEqual([]);
    expect(read.archiveUnreadable).toEqual([]);
  });

  it("never lets a live row whose front matter has problems be superseded", () => {
    const dir = mkdtempSync(join(tmpdir(), "board-supersessions-"));
    dirs.push(dir);
    mkdirSync(join(dir, "archive"));
    writeFileSync(join(dir, "archive", `${NEW}.md`), brief({ askedIso: "2026-10-02T00:00:00.000Z", slug: NEW }));
    const old = { askedIso: "2026-10-01T00:00:00.000Z", path: join(dir, `${OLD}.md`), slug: OLD };
    writeFileSync(old.path, "a live row");
    const read = boardSupersessions({
      docs: [{ ...old, problems: ["duplicate front-matter key: status"], summary: BATCH.join("\n") }],
      handoverDir: dir,
      journals: new Map(),
      live: [{ doc: old }],
    });
    expect([...read.edges]).toEqual([]);
  });

  it("lets a malformed second copy of a slug quarantine the clean one, rather than vanish from the count", () => {
    const dir = mkdtempSync(join(tmpdir(), "board-supersessions-"));
    dirs.push(dir);
    mkdirSync(join(dir, "archive"));
    writeFileSync(join(dir, "archive", `${NEW}.md`), brief({ askedIso: "2026-10-02T00:00:00.000Z", slug: NEW }));
    const old = { askedIso: "2026-10-01T00:00:00.000Z", path: join(dir, `${OLD}.md`), slug: OLD };
    writeFileSync(old.path, "a live row");
    const copy = { ...old, path: join(dir, "a-copy.md") };
    writeFileSync(copy.path, "a malformed copy");
    const read = boardSupersessions({
      docs: [
        { ...old, problems: [], summary: BATCH.join("\n") },
        { ...copy, problems: ["duplicate front-matter key: status"], summary: BATCH.join("\n") },
      ],
      handoverDir: dir,
      journals: new Map(),
      live: [{ doc: old }, { doc: copy }],
    });
    expect([...read.edges]).toEqual([]);
  });

  it("lets an archived copy filed under another name quarantine a live slug it shares", () => {
    const dir = mkdtempSync(join(tmpdir(), "board-supersessions-"));
    dirs.push(dir);
    mkdirSync(join(dir, "archive"));
    writeFileSync(join(dir, "archive", `${NEW}.md`), brief({ askedIso: "2026-10-02T00:00:00.000Z", slug: NEW }));
    writeFileSync(join(dir, "archive", "renamed.md"), brief({ askedIso: "2026-10-01T00:00:00.000Z", slug: OLD }));
    const old = { askedIso: "2026-10-01T00:00:00.000Z", path: join(dir, `${OLD}.md`), slug: OLD };
    writeFileSync(old.path, "a live row");
    const read = boardSupersessions({
      docs: [{ ...old, problems: [], summary: BATCH.join("\n") }],
      handoverDir: dir,
      journals: new Map(),
      live: [{ doc: old }],
    });
    expect([...read.edges]).toEqual([]);
  });

  it("never reads an archived generation filed under another name, which the settle could not resolve", () => {
    const dir = mkdtempSync(join(tmpdir(), "board-supersessions-"));
    dirs.push(dir);
    mkdirSync(join(dir, "archive"));
    writeFileSync(join(dir, "archive", "renamed.md"), brief({ askedIso: "2026-10-02T00:00:00.000Z", slug: NEW }));
    const old = { askedIso: "2026-10-01T00:00:00.000Z", path: join(dir, `${OLD}.md`), slug: OLD };
    writeFileSync(old.path, "a live row");
    const read = boardSupersessions({
      docs: [{ ...old, problems: [], summary: BATCH.join("\n") }],
      handoverDir: dir,
      journals: new Map(),
      live: [{ doc: old }],
    });
    expect([...read.edges]).toEqual([]);
    expect(read.archiveUnreadable).toEqual([]);
  });

  it("reports an archive file that would not read, rather than reading it as absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "board-supersessions-"));
    dirs.push(dir);
    mkdirSync(join(dir, "archive"));
    // A directory named like a doc is not a regular file, so the scan reports it rather than reading it.
    mkdirSync(join(dir, "archive", "broken.md"));
    const read = boardSupersessions({ docs: [], handoverDir: dir, journals: new Map(), live: [] });
    expect(read.archiveUnreadable).toEqual(["broken.md"]);
    expect(read.unreadable).toEqual([]);
  });
});

describe("unreadableSubReads", () => {
  it("names a row whose text did not read a second time", () => {
    expect(
      unreadableSubReads({
        archived: [],
        docs: [],
        generations: [],
        handoverDir: "/nowhere",
        journals: new Map(),
        texts: ["gone"],
      }),
    ).toEqual(["1 row(s) did not read a second time for supersession: gone"]);
  });

  it("names an archive file the top-up generation pass could not read", () => {
    expect(
      unreadableSubReads({
        archived: [],
        docs: [],
        generations: ["broken.md"],
        handoverDir: "/nowhere",
        journals: new Map(),
        texts: [],
      }),
    ).toEqual(["1 archive read(s) failed for the top-up generation pass: broken.md"]);
  });
});
