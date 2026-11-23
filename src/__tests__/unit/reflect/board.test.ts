import { describe, expect, it } from "vitest";

import { episodicPrefixOf, readBoardHygiene, renderBoardHygieneLines } from "../../../reflect/board.js";
import type { SubstrateReader } from "../../../reflect/substrate.js";

const HANDOVER_DIR = "/board/handovers";
const RUNS_DIR = "/board/runs";
const NOW = "2026-09-01T00:00:00.000Z";

/** An in-memory filesystem, the same fake shape every other `reflect` test shares — not a mock. */
const fakeReader = ({ files }: { files: Readonly<Record<string, string>> }): SubstrateReader => ({
  listNames: (dir) =>
    [
      ...new Set(
        Object.keys(files)
          .filter((path) => path.startsWith(`${dir}/`))
          .map((path) => path.slice(dir.length + 1).split("/")[0]!),
      ),
    ].toSorted((a, b) => a.localeCompare(b)),
  readText: (path) => files[path],
});

const doc = ({
  slug,
  status = "ready",
  blockedBy,
  doneWhenBlock,
}: {
  slug: string;
  status?: string;
  blockedBy?: string;
  doneWhenBlock?: string;
}): string =>
  [
    "---",
    `slug: ${slug}`,
    `status: ${status}`,
    ...(blockedBy !== undefined ? [`blockedBy: ${blockedBy}`] : []),
    ...(doneWhenBlock !== undefined ? [doneWhenBlock] : []),
    "---",
    "",
    `# ${slug}`,
    "",
  ].join("\n");

const started = ({ atIso }: { atIso: string }): string =>
  JSON.stringify({ atIso, branch: "x", docHash: "x", kind: "started" });
const finished = ({ atIso }: { atIso: string }): string =>
  `${started({ atIso })}\n${JSON.stringify({ atIso, kind: "finished", residue: [] })}`;

const noMtime = (): string | undefined => undefined;

describe("episodicPrefixOf", () => {
  it("strips a dated cut with a letter suffix", () => {
    expect(episodicPrefixOf({ slug: "standing-loop-29aug-p" })).toBe("standing-loop");
  });

  it("strips a dated cut with a word suffix", () => {
    expect(episodicPrefixOf({ slug: "standing-loop-22aug-weekend" })).toBe("standing-loop");
  });

  it("strips a bare numbered cut", () => {
    expect(episodicPrefixOf({ slug: "acme-standing-loop-12" })).toBe("acme-standing-loop");
  });

  it("leaves a slug with no episodic-cut suffix unchanged", () => {
    expect(episodicPrefixOf({ slug: "board-grooming-is-a-standing-practice" })).toBe(
      "board-grooming-is-a-standing-practice",
    );
  });
});

describe("readBoardHygiene: episodic families", () => {
  const familyDocs = ({ count }: { count: number }): Readonly<Record<string, string>> =>
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `${HANDOVER_DIR}/live-x-loop-${String(index)}.md`,
        doc({ slug: `live-x-loop-${String(index)}` }),
      ]),
    );

  it("reports a family at or above the threshold, none with a run open", () => {
    const report = readBoardHygiene({
      episodicThreshold: 6,
      handoverDir: HANDOVER_DIR,
      mtimeIso: noMtime,
      nowIso: NOW,
      reader: fakeReader({ files: familyDocs({ count: 6 }) }),
      runsDir: RUNS_DIR,
    });
    expect(report.episodicGroups).toHaveLength(1);
    expect(report.episodicGroups[0]!.prefix).toBe("live-x-loop");
    expect(report.episodicGroups[0]!.count).toBe(6);
  });

  it("does not report a family below the threshold", () => {
    const report = readBoardHygiene({
      episodicThreshold: 6,
      handoverDir: HANDOVER_DIR,
      mtimeIso: noMtime,
      nowIso: NOW,
      reader: fakeReader({ files: familyDocs({ count: 5 }) }),
      runsDir: RUNS_DIR,
    });
    expect(report.episodicGroups).toEqual([]);
  });

  it("does not report a family with any run open right now", () => {
    const files = {
      ...familyDocs({ count: 6 }),
      [`${RUNS_DIR}/live-x-loop-0.jsonl`]: started({ atIso: NOW }),
    };
    const report = readBoardHygiene({
      episodicThreshold: 6,
      handoverDir: HANDOVER_DIR,
      mtimeIso: noMtime,
      nowIso: NOW,
      reader: fakeReader({ files }),
      runsDir: RUNS_DIR,
    });
    expect(report.episodicGroups).toEqual([]);
  });

  it("never groups a doc whose status is terminal", () => {
    const files = {
      ...familyDocs({ count: 5 }),
      [`${HANDOVER_DIR}/live-x-loop-5.md`]: doc({ slug: "live-x-loop-5", status: "done" }),
    };
    const report = readBoardHygiene({
      episodicThreshold: 6,
      handoverDir: HANDOVER_DIR,
      mtimeIso: noMtime,
      nowIso: NOW,
      reader: fakeReader({ files }),
      runsDir: RUNS_DIR,
    });
    expect(report.episodicGroups).toEqual([]);
  });
});

describe("readBoardHygiene: no doneWhen or outputs", () => {
  it("counts a live doc declaring neither", () => {
    const report = readBoardHygiene({
      handoverDir: HANDOVER_DIR,
      mtimeIso: noMtime,
      nowIso: NOW,
      reader: fakeReader({ files: { [`${HANDOVER_DIR}/a.md`]: doc({ slug: "a" }) } }),
      runsDir: RUNS_DIR,
    });
    expect(report.noProbeTotal).toBe(1);
    expect(report.noProbeSlugs).toEqual(["a"]);
  });

  it("does not count a done doc", () => {
    const report = readBoardHygiene({
      handoverDir: HANDOVER_DIR,
      mtimeIso: noMtime,
      nowIso: NOW,
      reader: fakeReader({ files: { [`${HANDOVER_DIR}/a.md`]: doc({ slug: "a", status: "done" }) } }),
      runsDir: RUNS_DIR,
    });
    expect(report.noProbeTotal).toBe(0);
  });

  it("does not count a doc that declares doneWhen", () => {
    const report = readBoardHygiene({
      handoverDir: HANDOVER_DIR,
      mtimeIso: noMtime,
      nowIso: NOW,
      reader: fakeReader({
        files: { [`${HANDOVER_DIR}/a.md`]: doc({ doneWhenBlock: "doneWhen:\n  - path: x", slug: "a" }) },
      }),
      runsDir: RUNS_DIR,
    });
    expect(report.noProbeTotal).toBe(0);
  });
});

describe("readBoardHygiene: malformed doneWhen", () => {
  it("reports a doc whose doneWhen entry declares two keys", () => {
    const report = readBoardHygiene({
      handoverDir: HANDOVER_DIR,
      mtimeIso: noMtime,
      nowIso: NOW,
      reader: fakeReader({
        files: {
          [`${HANDOVER_DIR}/a.md`]: doc({
            doneWhenBlock: "doneWhen:\n  - command: grep x\n    expect: match",
            slug: "a",
          }),
        },
      }),
      runsDir: RUNS_DIR,
    });
    expect(report.malformed).toHaveLength(1);
    expect(report.malformed[0]!.slug).toBe("a");
    expect(report.malformed[0]!.problems[0]).toContain("must declare exactly one of");
  });
});

describe("readBoardHygiene: dead blockedBy", () => {
  it("reports a slug resolving against neither the board nor the archive", () => {
    const report = readBoardHygiene({
      handoverDir: HANDOVER_DIR,
      mtimeIso: noMtime,
      nowIso: NOW,
      reader: fakeReader({ files: { [`${HANDOVER_DIR}/a.md`]: doc({ blockedBy: "nowhere", slug: "a" }) } }),
      runsDir: RUNS_DIR,
    });
    expect(report.deadBlockedBy).toEqual([{ missing: ["nowhere"], slug: "a" }]);
  });

  it("does not report a slug resolving against a live board doc", () => {
    const report = readBoardHygiene({
      handoverDir: HANDOVER_DIR,
      mtimeIso: noMtime,
      nowIso: NOW,
      reader: fakeReader({
        files: {
          [`${HANDOVER_DIR}/a.md`]: doc({ blockedBy: "b", slug: "a" }),
          [`${HANDOVER_DIR}/b.md`]: doc({ slug: "b" }),
        },
      }),
      runsDir: RUNS_DIR,
    });
    expect(report.deadBlockedBy).toEqual([]);
  });

  it("does not report a slug resolving against an archived doc", () => {
    const report = readBoardHygiene({
      handoverDir: HANDOVER_DIR,
      mtimeIso: noMtime,
      nowIso: NOW,
      reader: fakeReader({
        files: {
          [`${HANDOVER_DIR}/a.md`]: doc({ blockedBy: "b", slug: "a" }),
          [`${HANDOVER_DIR}/archive/b.md`]: doc({ slug: "b", status: "done" }),
        },
      }),
      runsDir: RUNS_DIR,
    });
    expect(report.deadBlockedBy).toEqual([]);
  });
});

describe("readBoardHygiene: stale ready docs", () => {
  it("reports a ready, never-started, unblocked doc past the threshold", () => {
    const report = readBoardHygiene({
      handoverDir: HANDOVER_DIR,
      mtimeIso: () => "2026-08-01T00:00:00.000Z",
      nowIso: NOW,
      reader: fakeReader({ files: { [`${HANDOVER_DIR}/a.md`]: doc({ slug: "a" }) } }),
      runsDir: RUNS_DIR,
      staleDays: 7,
    });
    expect(report.staleReadyDocs).toHaveLength(1);
    expect(report.staleReadyDocs[0]!.slug).toBe("a");
    expect(report.staleReadyDocs[0]!.ageDays).toBe(31);
  });

  it("does not report a doc that already opened a run", () => {
    const report = readBoardHygiene({
      handoverDir: HANDOVER_DIR,
      mtimeIso: () => "2026-08-01T00:00:00.000Z",
      nowIso: NOW,
      reader: fakeReader({
        files: {
          [`${HANDOVER_DIR}/a.md`]: doc({ slug: "a" }),
          [`${RUNS_DIR}/a.jsonl`]: finished({ atIso: "2026-08-02T00:00:00.000Z" }),
        },
      }),
      runsDir: RUNS_DIR,
      staleDays: 7,
    });
    expect(report.staleReadyDocs).toEqual([]);
  });

  it("does not report a blocked doc, only its unblocked prerequisite", () => {
    const report = readBoardHygiene({
      handoverDir: HANDOVER_DIR,
      mtimeIso: () => "2026-08-01T00:00:00.000Z",
      nowIso: NOW,
      reader: fakeReader({
        files: {
          [`${HANDOVER_DIR}/a.md`]: doc({ blockedBy: "b", slug: "a" }),
          [`${HANDOVER_DIR}/b.md`]: doc({ slug: "b" }),
        },
      }),
      runsDir: RUNS_DIR,
      staleDays: 7,
    });
    expect(report.staleReadyDocs.map((entry) => entry.slug)).toEqual(["b"]);
  });

  it("does not report a doc younger than the threshold", () => {
    const report = readBoardHygiene({
      handoverDir: HANDOVER_DIR,
      mtimeIso: () => "2026-08-30T00:00:00.000Z",
      nowIso: NOW,
      reader: fakeReader({ files: { [`${HANDOVER_DIR}/a.md`]: doc({ slug: "a" }) } }),
      runsDir: RUNS_DIR,
      staleDays: 7,
    });
    expect(report.staleReadyDocs).toEqual([]);
  });

  it("records residue rather than dropping a doc whose mtime could not be read", () => {
    const report = readBoardHygiene({
      handoverDir: HANDOVER_DIR,
      mtimeIso: noMtime,
      nowIso: NOW,
      reader: fakeReader({ files: { [`${HANDOVER_DIR}/a.md`]: doc({ slug: "a" }) } }),
      runsDir: RUNS_DIR,
      staleDays: 7,
    });
    expect(report.staleReadyDocs).toEqual([]);
    expect(report.residue).toContain("a: file modification time unreadable, so its age is unknown rather than fresh");
  });
});

describe("readBoardHygiene: unreadable doc", () => {
  it("records residue instead of dropping the doc silently", () => {
    const reader: SubstrateReader = {
      listNames: () => ["a.md"],
      readText: () => undefined,
    };
    const report = readBoardHygiene({
      handoverDir: HANDOVER_DIR,
      mtimeIso: noMtime,
      nowIso: NOW,
      reader,
      runsDir: RUNS_DIR,
    });
    expect(report.docsScanned).toBe(0);
    expect(report.residue).toContain("a.md could not be read, so its hygiene is unknown rather than clean");
  });
});

describe("renderBoardHygieneLines", () => {
  it("prints the scanned count and a per-category zero line for a clean board", () => {
    const report = readBoardHygiene({
      handoverDir: HANDOVER_DIR,
      mtimeIso: () => NOW,
      nowIso: NOW,
      reader: fakeReader({ files: { [`${HANDOVER_DIR}/a.md`]: doc({ slug: "a", status: "done" }) } }),
      runsDir: RUNS_DIR,
    });
    const lines = renderBoardHygieneLines({ report });
    expect(lines[0]).toBe("reflect board: 1 doc(s) scanned");
    expect(lines).toContain("  no doneWhen/outputs declared: 0 doc(s)");
    expect(lines).toContain("  malformed front-matter: 0 doc(s)");
    expect(lines).toContain("  blockedBy names nothing: 0 doc(s)");
  });
});
