import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { countLessonFileLines, lessonsDriftLines, lessonsDriftNotice } from "../../../knowledge/lessonsDrift.js";
import { unwrap } from "../../../lib/result.js";

const dirs: string[] = [];

/** A throwaway directory, removed after the test that minted it. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "lessons-drift-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("lessonsDriftNotice", () => {
  it("says nothing when the table holds every line of the file", () => {
    expect(
      lessonsDriftNotice({
        fileLines: 1125,
        filePath: "/home/knowledge/lessons.jsonl",
        importedCount: 1125,
        prunedCount: 0,
      }),
    ).toEqual([]);
  });

  it("says nothing when the table has outrun the file, which is the ordinary post-cutover state", () => {
    expect(
      lessonsDriftNotice({
        fileLines: 1125,
        filePath: "/home/knowledge/lessons.jsonl",
        importedCount: 1739,
        prunedCount: 0,
      }),
    ).toEqual([]);
  });

  it("says nothing when there is no file at all", () => {
    expect(
      lessonsDriftNotice({ fileLines: 0, filePath: "/home/knowledge/lessons.jsonl", importedCount: 0, prunedCount: 0 }),
    ).toEqual([]);
  });

  it("names the exact shortfall and the apply that clears it", () => {
    expect(
      lessonsDriftNotice({
        fileLines: 1125,
        filePath: "/home/knowledge/lessons.jsonl",
        importedCount: 1123,
        prunedCount: 0,
      }),
    ).toEqual([
      "  note: 2 line(s) of the retired register are not in the memories table —" +
        " a checkout predating the cutover is still appending to /home/knowledge/lessons.jsonl",
      "  fix:  slopweaver knowledge import-lessons --file /home/knowledge/lessons.jsonl --apply",
    ]);
  });

  it("says nothing when a prune retired exactly the lines the table no longer holds", () => {
    // MEASURED: 449 imported rows left in the table, 676 retired into the prune archive, 1,125 lines.
    expect(
      lessonsDriftNotice({
        fileLines: 1125,
        filePath: "/home/knowledge/lessons.jsonl",
        importedCount: 449,
        prunedCount: 676,
      }),
    ).toEqual([]);
  });

  it("still names a line appended past both the table and the prune archive", () => {
    expect(
      lessonsDriftNotice({ fileLines: 1126, filePath: "/h/l.jsonl", importedCount: 449, prunedCount: 676 }),
    ).toEqual([
      "  note: 1 line(s) of the retired register are not in the memories table —" +
        " a checkout predating the cutover is still appending to /h/l.jsonl",
      "  fix:  slopweaver knowledge import-lessons --file /h/l.jsonl --apply",
    ]);
  });

  it("fires on a single orphaned line, the boundary an off-by-one would swallow", () => {
    expect(lessonsDriftNotice({ fileLines: 1, filePath: "/h/l.jsonl", importedCount: 0, prunedCount: 0 })).toEqual([
      "  note: 1 line(s) of the retired register are not in the memories table —" +
        " a checkout predating the cutover is still appending to /h/l.jsonl",
      "  fix:  slopweaver knowledge import-lessons --file /h/l.jsonl --apply",
    ]);
  });
});

describe("countLessonFileLines", () => {
  it("reads zero for a file that was never created", () => {
    expect(unwrap(countLessonFileLines({ path: join(scratch(), "lessons.jsonl") }))).toBe(0);
  });

  it("counts one per record, ignoring the trailing newline", () => {
    const path = join(scratch(), "lessons.jsonl");
    writeFileSync(path, '{"id":"a"}\n{"id":"b"}\n{"id":"c"}\n');
    expect(unwrap(countLessonFileLines({ path }))).toBe(3);
  });

  it("counts a final record that carries no trailing newline", () => {
    const path = join(scratch(), "lessons.jsonl");
    writeFileSync(path, '{"id":"a"}\n{"id":"b"}');
    expect(unwrap(countLessonFileLines({ path }))).toBe(2);
  });

  it("skips blank lines, because the import keys only the non-blank ones", () => {
    const path = join(scratch(), "lessons.jsonl");
    writeFileSync(path, '{"id":"a"}\n\n   \n{"id":"b"}\n');
    expect(unwrap(countLessonFileLines({ path }))).toBe(2);
  });

  it("reads zero for an empty file", () => {
    const path = join(scratch(), "lessons.jsonl");
    writeFileSync(path, "");
    expect(unwrap(countLessonFileLines({ path }))).toBe(0);
  });
});

describe("lessonsDriftLines", () => {
  it("says nothing when the table count cannot be taken, rather than calling every line an orphan", async () => {
    const home = scratch();
    mkdirSync(join(home, "knowledge"));
    writeFileSync(join(home, "knowledge", "lessons.jsonl"), '{"id":"a"}\n{"id":"b"}\n');
    expect(await lessonsDriftLines({ countImported: async () => null, home })).toEqual([]);
  });

  it("says nothing when the register is absent, whatever the table holds", async () => {
    expect(await lessonsDriftLines({ countImported: async () => 1739, home: scratch() })).toEqual([]);
  });

  it("names the shortfall against the resolved home's own register", async () => {
    const home = scratch();
    mkdirSync(join(home, "knowledge"));
    const path = join(home, "knowledge", "lessons.jsonl");
    writeFileSync(path, '{"id":"a"}\n{"id":"b"}\n{"id":"c"}\n');
    expect(await lessonsDriftLines({ countImported: async () => 1, home })).toEqual([
      "  note: 2 line(s) of the retired register are not in the memories table —" +
        ` a checkout predating the cutover is still appending to ${path}`,
      `  fix:  slopweaver knowledge import-lessons --file ${path} --apply`,
    ]);
  });

  it("subtracts the lines a prune archive retired, read from the resolved home", async () => {
    const home = scratch();
    mkdirSync(join(home, "knowledge", "pruned"), { recursive: true });
    const path = join(home, "knowledge", "lessons.jsonl");
    writeFileSync(path, '{"id":"a"}\n{"id":"b"}\n{"id":"c"}\n');
    writeFileSync(
      join(home, "knowledge", "pruned", "2026-09-29T03-09-08.732Z.jsonl"),
      `${JSON.stringify({
        behaviourChange: null,
        caveat: null,
        claim: "c",
        createdAt: "2026-09-12T11:00:00.000Z",
        domain: "datadog",
        evidence: "e",
        id: "l-1",
        importKey: "aaa:0000000001",
        kind: "lesson",
        learner: null,
        recordedAt: "2026-09-12T10:00:00.000Z",
        recordingId: "r",
        repro: null,
        retrievalCue: null,
        run: "ad-hoc",
        seq: 1,
        surface: null,
        tier: null,
        verdict: "confirmed",
      })}\n`,
    );
    expect(await lessonsDriftLines({ countImported: async () => 1, home })).toEqual([
      "  note: 1 line(s) of the retired register are not in the memories table —" +
        ` a checkout predating the cutover is still appending to ${path}`,
      `  fix:  slopweaver knowledge import-lessons --file ${path} --apply`,
    ]);
  });

  it("hands the table read the archived keys, so a row restored from an archive is not subtracted twice", async () => {
    // Three lines imported, line 1 pruned and then restored from its archive, line 4 appended by a straggler.
    // The table holds keys 1-3 and the archive still holds key 1: counted on both sides, 4 - 3 - 1 is zero
    // and the appended line would vanish from the notice.
    const home = scratch();
    mkdirSync(join(home, "knowledge", "pruned"), { recursive: true });
    const path = join(home, "knowledge", "lessons.jsonl");
    writeFileSync(path, '{"id":"a"}\n{"id":"b"}\n{"id":"c"}\n{"id":"d"}\n');
    writeFileSync(
      join(home, "knowledge", "pruned", "2026-09-29T03-09-08.732Z.jsonl"),
      `${JSON.stringify({
        behaviourChange: null,
        caveat: null,
        claim: "c",
        createdAt: "2026-09-12T11:00:00.000Z",
        domain: "datadog",
        evidence: "e",
        id: "l-1",
        importKey: "key:0000000001",
        kind: "lesson",
        learner: null,
        recordedAt: "2026-09-12T10:00:00.000Z",
        recordingId: "r",
        repro: null,
        retrievalCue: null,
        run: "ad-hoc",
        seq: 1,
        surface: null,
        tier: null,
        verdict: "confirmed",
      })}\n`,
    );
    const tableKeys = ["key:0000000001", "key:0000000002", "key:0000000003"];
    expect(
      await lessonsDriftLines({
        countImported: async ({ excluding }) => tableKeys.filter((key) => !excluding.has(key)).length,
        home,
      }),
    ).toEqual([
      "  note: 1 line(s) of the retired register are not in the memories table —" +
        ` a checkout predating the cutover is still appending to ${path}`,
      `  fix:  slopweaver knowledge import-lessons --file ${path} --apply`,
    ]);
  });

  it("says nothing when a prune archive cannot be read, rather than calling its lines orphans", async () => {
    const home = scratch();
    mkdirSync(join(home, "knowledge", "pruned"), { recursive: true });
    writeFileSync(join(home, "knowledge", "lessons.jsonl"), '{"id":"a"}\n{"id":"b"}\n');
    writeFileSync(join(home, "knowledge", "pruned", "2026-09-29T03-09-08.732Z.jsonl"), "{not json\n");
    expect(await lessonsDriftLines({ countImported: async () => 0, home })).toEqual([]);
  });

  it("stays silent once the table has caught up with the file", async () => {
    const home = scratch();
    mkdirSync(join(home, "knowledge"));
    writeFileSync(join(home, "knowledge", "lessons.jsonl"), '{"id":"a"}\n{"id":"b"}\n');
    expect(await lessonsDriftLines({ countImported: async () => 2, home })).toEqual([]);
  });
});
