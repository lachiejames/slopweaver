import { describe, expect, it } from "vitest";

import {
  type BaseFileSnapshot,
  type DiffOnBaseFileInput,
  judgeDiffOnBase,
} from "../../../../live/github/diffOnBaseJudge.js";

/** A text snapshot of the base, one line per argument, ending in a newline. */
function base(...lines: string[]): BaseFileSnapshot {
  return { kind: "text", text: `${lines.join("\n")}\n` };
}

/**
 * One modified file. Its head copy is the base's unless a test says otherwise: where a change has landed, that copy
 * holds the post-image exactly once, as a pull request's own head does.
 */
function modified({
  patch,
  on,
  head = on,
}: {
  patch: string;
  on: BaseFileSnapshot;
  head?: BaseFileSnapshot;
}): DiffOnBaseFileInput {
  return { base: on, filename: "a.ts", head, patch, status: "modified" };
}

/** Judge one file with a complete list and a head that held still. */
function judgeOne({ file }: { file: DiffOnBaseFileInput }): ReturnType<typeof judgeDiffOnBase> {
  return judgeDiffOnBase({ fileListComplete: true, files: [file], headMoved: false });
}

/** A one-line patch, which GitHub drew against its merge base. */
const INCIDENT_PATCH = [
  "@@ -187,7 +187,7 @@ import { ensureTestDatabaseRunning } from './src/test/testHelpers'",
  " import './src/models/Task'",
  " ",
  " // Suppress all log output in tests",
  "-logger.level = 'silent'",
  "+logger.level = process.env.EV_TEST_LOG_LEVEL ?? 'silent'",
  " ",
  " // Ensure test database is available before running any tests",
  " beforeAll(async () => {",
].join("\n");

describe("judgeDiffOnBase", () => {
  it("says the incident's one-line change is on staging, where it sits five lines lower than the patch said", () => {
    const staging = base(
      "l1",
      "l2",
      "l3",
      "l4",
      "l5",
      "import './src/models/Task'",
      "",
      "// Suppress all log output in tests",
      "logger.level = process.env.EV_TEST_LOG_LEVEL ?? 'silent'",
      "",
      "// Ensure test database is available before running any tests",
      "beforeAll(async () => {",
    );

    // The pull request's own copy holds the change where the patch's header says: line 187.
    const head = base(
      ...Array.from({ length: 186 }, (_, index) => `h${String(index)}`),
      "import './src/models/Task'",
      "",
      "// Suppress all log output in tests",
      "logger.level = process.env.EV_TEST_LOG_LEVEL ?? 'silent'",
      "",
      "// Ensure test database is available before running any tests",
      "beforeAll(async () => {",
    );

    const judged = judgeOne({ file: modified({ head, on: staging, patch: INCIDENT_PATCH }) });

    expect(judged).toEqual({ files: [{ filename: "a.ts", verdict: "on-base" }], verdict: "on-base" });
  });

  it("says a change whose old lines are still there is not on the base", () => {
    const judged = judgeOne({
      file: modified({ on: base("a", "old", "b"), patch: "@@ -1,3 +1,3 @@\n a\n-old\n+new\n b" }),
    });

    expect(judged.verdict).toBe("not-on-base");
  });

  it("says partly when one hunk landed and the other did not", () => {
    const patch = "@@ -1,3 +1,3 @@\n a\n-x\n+y\n b\n@@ -10,3 +10,3 @@\n c\n-p\n+q\n d";

    const judged = judgeOne({ file: modified({ on: base("a", "y", "b", "c", "p", "d"), patch }) });

    expect(judged.verdict).toBe("partly");
  });

  it("refuses to certify two landed hunks that sit in the opposite order on the base", () => {
    const patch = "@@ -1,3 +1,3 @@\n a\n-x\n+y\n b\n@@ -10,3 +10,3 @@\n c\n-p\n+q\n d";

    const head = base("a", "y", "b", "4", "5", "6", "7", "8", "9", "c", "q", "d");

    const judged = judgeOne({ file: modified({ head, on: base("c", "q", "d", "a", "y", "b"), patch }) });

    expect(judged).toEqual({
      files: [{ filename: "a.ts", reason: "its changes sit in a different order on the base", verdict: "unknown" }],
      reason: "a.ts: its changes sit in a different order on the base",
      verdict: "unknown",
    });
  });

  it("answers unknown when the changed block appears more than once on the base", () => {
    const judged = judgeOne({
      file: modified({ on: base("a", "new", "b", "a", "new", "b"), patch: "@@ -1,3 +1,3 @@\n a\n-old\n+new\n b" }),
    });

    expect(judged.reason).toBe("a.ts: the changed lines appear more than once in the file");
  });

  it("answers unknown when the added line is there but the lines around it changed", () => {
    const judged = judgeOne({
      file: modified({ on: base("A", "new", "b"), patch: "@@ -1,3 +1,3 @@\n a\n-old\n+new\n b" }),
    });

    expect(judged.reason).toBe("a.ts: the lines around the change are different on the base");
  });

  it("answers unknown when both the old and the new block are on the base", () => {
    const judged = judgeOne({
      file: modified({ on: base("a", "new", "b", "a", "old", "b"), patch: "@@ -1,3 +1,3 @@\n a\n-old\n+new\n b" }),
    });

    expect(judged.reason).toBe("a.ts: both the old and the new lines appear in the file");
  });

  it("answers unknown when the deleted line is still in place and only a neighbour changed", () => {
    const judged = judgeOne({
      file: modified({ on: base("a", "old", "B", "x", "a", "b"), patch: "@@ -1,3 +1,2 @@\n a\n-old\n b" }),
    });

    expect([judged.verdict, judged.reason]).toEqual(["unknown", "a.ts: a line it deletes is still in the file"]);
  });

  it("answers unknown when a deleted blank line may still be in place beside a changed neighbour", () => {
    const judged = judgeOne({
      file: modified({ on: base("a", "", "B", "x", "a", "b"), patch: "@@ -1,3 +1,2 @@\n a\n-\n b" }),
    });

    expect([judged.verdict, judged.reason]).toEqual(["unknown", "a.ts: a line it deletes is still in the file"]);
  });

  it("answers unknown when a deleted last line survives with a newline after it", () => {
    const judged = judgeOne({
      file: modified({ on: base("a", "old"), patch: "@@ -1,2 +1 @@\n a\n-old\n\\ No newline at end of file" }),
    });

    expect([judged.verdict, judged.reason]).toEqual(["unknown", "a.ts: a line it deletes is still in the file"]);
  });

  it("certifies a deletion when no line it deletes is left anywhere in the file", () => {
    const judged = judgeOne({
      file: modified({ on: base("a", "b"), patch: "@@ -1,4 +1,2 @@\n a\n-old\n-\n b" }),
    });

    expect(judged.verdict).toBe("on-base");
  });

  it("answers unknown when an insertion's old lines are still in place and its new block exists elsewhere", () => {
    const judged = judgeOne({
      file: modified({
        on: base("a", "b", "c", "d", "separator", "a", "new", "b", "c", "d"),
        patch: "@@ -1,4 +1,5 @@\n a\n+new\n b\n c\n d",
      }),
    });

    expect([judged.verdict, judged.reason]).toEqual([
      "unknown",
      "a.ts: both the old and the new lines appear in the file",
    ]);
  });

  it("answers unknown for a context-free insertion, whose text says nothing about where it sits", () => {
    const judged = judgeOne({ file: modified({ on: base("a", "b", "x"), patch: "@@ -1,0 +2 @@ a\n+x" }) });

    expect(judged.reason).toBe("a.ts: it inserts lines with no surrounding lines to place them by");
  });

  it("answers unknown when the pull request's own copy holds the changed block twice", () => {
    const patch = "@@ -1,2 +1,3 @@\n a\n+new\n b";

    const judged = judgeOne({
      file: modified({
        head: base("a", "new", "b", "separator", "a", "new", "b"),
        on: base("A", "b", "separator", "a", "new", "b"),
        patch,
      }),
    });
    const sameBaseOneCopy = judgeOne({
      file: modified({ head: base("a", "new", "b"), on: base("A", "b", "separator", "a", "new", "b"), patch }),
    });

    expect(judged.reason).toBe("a.ts: the changed lines appear more than once in the pull request's own copy");
    expect(sameBaseOneCopy.verdict).toBe("on-base");
  });

  it("answers unknown when the head's own copy did not read", () => {
    const judged = judgeOne({
      file: modified({
        head: { kind: "unread", reason: "GitHub cut the head's copy short" },
        on: base("a", "new", "b"),
        patch: "@@ -1,3 +1,3 @@\n a\n-old\n+new\n b",
      }),
    });

    expect(judged.reason).toBe("a.ts: GitHub cut the head's copy short");
  });

  it("certifies an insertion at a file's end, whose old lines sit whole inside the landed block", () => {
    const judged = judgeOne({
      file: modified({ on: base("x", "y", "z", "new"), patch: "@@ -1,3 +1,4 @@\n x\n y\n z\n+new" }),
    });

    expect(judged.verdict).toBe("on-base");
  });

  it("keeps whitespace inside a line significant", () => {
    const judged = judgeOne({
      file: modified({ on: base("a", "new ", "b"), patch: "@@ -1,3 +1,3 @@\n a\n-old\n+new\n b" }),
    });

    expect(judged.verdict).toBe("unknown");
  });

  it("answers unknown when the base and the head end the file's lines differently", () => {
    const patch = "@@ -1 +1 @@\n-a\n+b";
    const judged = [
      judgeOne({ file: modified({ head: { kind: "text", text: "b\r\n" }, on: { kind: "text", text: "b\n" }, patch }) }),
      judgeOne({
        file: modified({ head: { kind: "text", text: "b\r\nc\n" }, on: { kind: "text", text: "b\r\nc\n" }, patch }),
      }),
    ];

    expect(judged.map((one) => one.reason)).toEqual([
      "a.ts: the base and the head end its lines differently",
      "a.ts: the base and the head end its lines differently",
    ]);
  });

  it("matches an LF patch against a CRLF base", () => {
    const judged = judgeOne({
      file: modified({ on: { kind: "text", text: "a\r\nnew\r\nb\r\n" }, patch: "@@ -1,3 +1,3 @@\n a\n-old\n+new\n b" }),
    });

    expect(judged.verdict).toBe("on-base");
  });

  it("holds the no-newline-at-end marker to the base's own last line", () => {
    const patch = "@@ -1,2 +1,2 @@\n a\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file";

    const without = judgeOne({ file: modified({ on: { kind: "text", text: "a\nnew" }, patch }) });
    const withNewline = judgeOne({ file: modified({ on: { kind: "text", text: "a\nnew\n" }, patch }) });

    expect(without.verdict).toBe("on-base");
    expect(withNewline.verdict).toBe("unknown");
  });

  it("judges a context-free deletion: gone is on, still at its line is not, elsewhere is unknown", () => {
    const patch = "@@ -2,1 +1,0 @@\n-gone";
    const head = base("a");

    expect(judgeOne({ file: modified({ head, on: base("a", "b"), patch }) }).verdict).toBe("on-base");
    expect(judgeOne({ file: modified({ head, on: base("a", "gone"), patch }) }).verdict).toBe("not-on-base");
    expect(judgeOne({ file: modified({ head, on: base("gone", "a"), patch }) }).verdict).toBe("unknown");
  });

  it("answers unknown for a context-free deletion with part of its block left", () => {
    const judged = judgeOne({
      file: modified({ head: base("x"), on: base("a", "x"), patch: "@@ -1,2 +0,0 @@\n-a\n-b" }),
    });

    expect(judged.reason).toBe("a.ts: a line it deletes is still in the file");
  });

  it("answers unknown for a context-free deletion the head's own copy still holds", () => {
    const patch = "@@ -1 +0,0 @@\n-old";
    const contradicted = judgeOne({ file: modified({ head: base("old"), on: base("x"), patch }) });
    const consistent = judgeOne({ file: modified({ head: base("x"), on: base("x"), patch }) });

    expect(contradicted.reason).toBe("a.ts: the pull request's own copy still holds a line it deletes");
    expect(consistent.verdict).toBe("on-base");
  });

  it("answers unknown for a context-free deletion placed past the head's own end", () => {
    const at = ({ patch }: { patch: string }): ReturnType<typeof judgeOne> =>
      judgeOne({ file: modified({ head: base("keep"), on: base("keep"), patch }) });

    expect(at({ patch: "@@ -100 +99,0 @@\n-gone" }).reason).toBe(
      "a.ts: GitHub's patch does not place the change where the pull request's own copy has it",
    );
    expect(at({ patch: "@@ -2 +1,0 @@\n-gone" }).verdict).toBe("on-base");
  });

  it("answers unknown when the head's own copy holds the change away from where the patch puts it", () => {
    const patch = "@@ -1,3 +1,3 @@\n a\n-old\n+new\n b";
    const on = base("prefix", "a", "new", "b");
    const misplaced = judgeOne({ file: modified({ head: base("prefix", "a", "new", "b"), on, patch }) });
    const placed = judgeOne({ file: modified({ head: base("a", "new", "b"), on, patch }) });

    expect(misplaced.reason).toBe(
      "a.ts: GitHub's patch does not place the change where the pull request's own copy has it",
    );
    expect(placed.verdict).toBe("on-base");
  });

  it("judges an added file by its whole text", () => {
    const added = ({ on }: { on: BaseFileSnapshot }): DiffOnBaseFileInput => ({
      base: on,
      filename: "n.ts",
      head: base("one", "two"),
      patch: "@@ -0,0 +1,2 @@\n+one\n+two",
      status: "added",
    });

    expect(judgeOne({ file: added({ on: base("one", "two") }) }).verdict).toBe("on-base");
    expect(judgeOne({ file: added({ on: { kind: "missing" } }) }).verdict).toBe("not-on-base");
    expect(judgeOne({ file: added({ on: base("one", "three") }) }).reason).toBe(
      "n.ts: the base has a different file at that path",
    );
  });

  it("answers unknown for an added file whose one hunk does not start the file", () => {
    const judged = judgeOne({
      file: {
        base: base("one", "two"),
        filename: "n.ts",
        head: base("one", "two"),
        patch: "@@ -5,0 +6,2 @@\n+one\n+two",
        status: "added",
      },
    });

    expect(judged.reason).toBe("n.ts: GitHub's patch for it is not one whole new file");
  });

  it("answers unknown for an added file whose patch is not the head's own copy", () => {
    const judged = judgeOne({
      file: {
        base: base("claimed"),
        filename: "n.ts",
        head: base("actual"),
        patch: "@@ -0,0 +1 @@\n+claimed",
        status: "added",
      },
    });

    expect(judged.reason).toBe("n.ts: GitHub's patch for it is not the pull request's own copy");
  });

  it("judges a removed file by whether the path is still there, whatever it holds", () => {
    const removed = ({ on }: { on: BaseFileSnapshot }): DiffOnBaseFileInput => ({
      base: on,
      filename: "r.png",
      head: { kind: "missing" },
      patch: undefined,
      status: "removed",
    });

    expect(judgeOne({ file: removed({ on: { kind: "missing" } }) }).verdict).toBe("on-base");
    expect(judgeOne({ file: removed({ on: { kind: "unread", reason: "the base's copy is binary" } }) }).verdict).toBe(
      "not-on-base",
    );
  });

  it("answers unknown for a removed file whose patch is not one whole deleted file", () => {
    const removed = ({ patch }: { patch: string }): DiffOnBaseFileInput => ({
      base: { kind: "missing" },
      filename: "gone.ts",
      head: { kind: "missing" },
      patch,
      status: "removed",
    });

    expect([
      judgeOne({ file: removed({ patch: "@@ -1 +0,0 @@\n-old\n+unexpected" }) }).reason,
      judgeOne({ file: removed({ patch: "@@ -1,2 +1 @@\n-old\n keep" }) }).reason,
    ]).toEqual([
      "gone.ts: GitHub's patch for it is not one whole deleted file",
      "gone.ts: GitHub's patch for it is not one whole deleted file",
    ]);
    expect(judgeOne({ file: removed({ patch: "@@ -1,2 +0,0 @@\n-old\n-older" }) }).verdict).toBe("on-base");
  });

  it("judges an empty file's deletion, whose patch has no hunk, by whether the path is still there", () => {
    const removed = ({ on }: { on: BaseFileSnapshot }): DiffOnBaseFileInput => ({
      base: on,
      filename: "empty.ts",
      head: { kind: "missing" },
      patch: "",
      status: "removed",
    });

    expect([
      judgeOne({ file: removed({ on: { kind: "missing" } }) }).verdict,
      judgeOne({ file: removed({ on: { kind: "text", text: "" } }) }).verdict,
    ]).toEqual(["on-base", "not-on-base"]);
  });

  it("answers unknown, with the reason, for what it does not judge", () => {
    const renamed: DiffOnBaseFileInput = {
      base: base("x"),
      filename: "b.ts",
      head: base("y"),
      patch: "@@ -1 +1 @@\n-x\n+y",
      status: "renamed",
    };
    const binary = { ...modified({ on: base("x"), patch: "" }), filename: "c.png", patch: undefined };
    const truncated = modified({
      on: { kind: "unread", reason: "GitHub cut the base's copy short" },
      patch: "@@ -1 +1 @@\n-x\n+y",
    });

    expect(judgeOne({ file: renamed }).reason).toBe("b.ts: GitHub calls it renamed, which this check does not judge");
    expect(judgeOne({ file: binary }).reason).toBe("c.png: GitHub gave no patch for it (binary, or too large)");
    expect(judgeOne({ file: truncated }).reason).toBe("a.ts: GitHub cut the base's copy short");
  });

  it("answers unknown for a line on a side a no-newline marker already ended", () => {
    const marker = "\\ No newline at end of file";
    const judge = ({ patch }: { patch: string }): ReturnType<typeof judgeOne> =>
      judgeOne({ file: modified({ head: base("tail"), on: base("tail"), patch }) });

    expect(judge({ patch: `@@ -1,2 +1 @@\n-old\n${marker}\n tail` }).reason).toBe(
      "a.ts: GitHub's patch for it did not parse",
    );
    // git's own shape: the old side ends without a newline, the new side carries on to add one.
    expect(judge({ patch: `@@ -1 +1 @@\n-tail\n${marker}\n+tail` }).verdict).toBe("on-base");
  });

  it("answers unknown for a no-newline marker that follows no line, or follows another marker", () => {
    const leading = judgeOne({ file: modified({ on: base("new"), patch: "@@ -1 +1 @@\n\\ garbage\n-old\n+new" }) });
    const marker = "\\ No newline at end of file";
    const doubled = judgeOne({
      file: modified({ on: { kind: "text", text: "new" }, patch: `@@ -1 +1 @@\n-old\n+new\n${marker}\n${marker}` }),
    });
    const garbage = judgeOne({
      file: modified({ on: { kind: "text", text: "new" }, patch: "@@ -1 +1 @@\n-old\n+new\n\\ garbage" }),
    });

    expect([leading.reason, doubled.reason, garbage.reason]).toEqual([
      "a.ts: GitHub's patch for it did not parse",
      "a.ts: GitHub's patch for it did not parse",
      "a.ts: GitHub's patch for it did not parse",
    ]);
  });

  it("answers unknown for headers that cannot describe one edit of one file", () => {
    const judge = ({ patch }: { patch: string }): ReturnType<typeof judgeOne> =>
      judgeOne({ file: modified({ head: base("keep", "x", "a", "new", "b"), on: base("keep"), patch }) });

    expect([
      judge({ patch: "@@ -0,2 +1 @@\n-old\n keep" }).reason,
      judge({ patch: "@@ -2,2 +1 @@\n-old\n keep" }).reason,
      judge({ patch: "@@ -3,3 +3,3 @@\n a\n-old\n+new\n b\n@@ -1 +1 @@\n keep" }).reason,
    ]).toEqual([
      "a.ts: GitHub's patch for it did not parse",
      "a.ts: GitHub's patch for it did not parse",
      "a.ts: GitHub's patch for it did not parse",
    ]);
    expect(judge({ patch: "@@ -1,2 +1 @@\n keep\n-old" }).verdict).toBe("on-base");
  });

  it("answers unknown for a patch whose lines do not add up to its header", () => {
    const judged = judgeOne({ file: modified({ on: base("a", "new"), patch: "@@ -1,3 +1,3 @@\n a\n-old\n+new" }) });

    expect(judged.reason).toBe("a.ts: GitHub's patch for it did not parse");
  });

  it("never certifies a list GitHub cut short, a head that moved, or a pull request with no files", () => {
    const landed = modified({ on: base("a", "new", "b"), patch: "@@ -1,3 +1,3 @@\n a\n-old\n+new\n b" });

    const cut = judgeDiffOnBase({ fileListComplete: false, files: [landed], headMoved: false });
    const moved = judgeDiffOnBase({ fileListComplete: true, files: [landed], headMoved: true });
    const empty = judgeDiffOnBase({ fileListComplete: true, files: [], headMoved: false });

    expect([cut.verdict, cut.reason]).toEqual(["unknown", "GitHub listed only part of its changed files"]);
    expect([moved.verdict, moved.reason]).toEqual(["unknown", "the head moved while it was read — read it again"]);
    expect([empty.verdict, empty.reason]).toEqual(["unknown", "the pull request reports no changed files"]);
  });
});
