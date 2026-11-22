/**
 * `handover rule` records what the owner DECIDED as a journal event, and every reader then derives it — with
 * the row document untouched.
 *
 * The behavioural proof for the owner's ruling to derive from state the way the board derives everything
 * else, and it has to be a subprocess test rather than a unit one. What the ruling
 * closes is that **the owner's word never reached the surfaces a reader reads**, so nothing short of running the
 * SHIPPED verbs over a throwaway board can show that it now does: the derivation is unit-tested in
 * `unit/handover/derivedRowState.test.ts` and `unit/handover/ruling.test.ts`, and a pure test cannot show
 * that `handover list` and `handover resume` reach it.
 *
 * The falsifiable witness is the assertion on the document's own BYTES. A `rule` that quietly spliced
 * `ruling:` into the front-matter would satisfy every "the board prints the owner's ruling" assertion here while
 * being exactly the doc write the ruling removed, so the file is read back and asserted byte-identical.
 *
 * `SLOPWEAVER_CLI_DIR` is set deliberately: `bin/slopweaver` otherwise resolves its checkout from an ambient
 * `PLUGIN_ROOT`, and a proof run from a worktree would silently exercise the main checkout instead.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { absentAsNumber } from "#lib/absent.js";
import { readAttachUploadStanding } from "../../../../../handover/attachUploadRulingStore.js";
import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";
import { ASK_SHAPE } from "./askShapeArgs.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home with the two directories the board and the journals live in. */
function throwawayHome(): string {
  const home = mkdtempSync(join(tmpdir(), "rule-derives-"));
  homes.push(home);
  mkdirSync(join(home, "handovers"));
  mkdirSync(join(home, "runs"));
  return home;
}

function run({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(BIN, args, {
    encoding: "utf8",
    env: {
      ...accountSandboxChildEnv(),
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_CLI_DIR: repoRoot,
      TMPDIR: process.env["TMPDIR"]!,
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return {
    status: absentAsNumber({ value: result.status, whenAbsent: -1 }),
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

/** Register one ordinary ask row — the owner's own ask, which the old finding-only verb would have refused. */
function rowOn({ home, slug }: { home: string; slug: string }): string {
  const registered = run({
    args: [
      "handover",
      "register",
      "--home",
      home,
      "--ask",
      `Should ${slug} be done?`,
      ...ASK_SHAPE,
      "--slug",
      slug,
      "--asked-iso",
      "2026-09-07T00:00:00Z",
    ],
  });
  expect(registered.status).toBe(0);
  return join(home, "handovers", `${slug}.md`);
}

describe("handover rule", () => {
  it("records the owner's ruling on THEIR OWN ask, writes no document, and the board reads it back", () => {
    const home = throwawayHome();
    const path = rowOn({ home, slug: "an-ordinary-ask" });
    const before = readFileSync(path, "utf8");

    const ruled = run({
      args: [
        "handover",
        "rule",
        "an-ordinary-ask",
        "--home",
        home,
        "--anchor",
        "https://example.invalid/p9",
        "--words",
        "yes, do the narrow one first",
      ],
    });

    expect(ruled.status).toBe(0);
    expect(ruled.stdout).toContain("now carries the owner's ruling (https://example.invalid/p9)");
    // The falsifiable half: the document the verb was pointed at is byte-identical. If `rule` ever starts
    // writing front-matter again, this fails before any board assertion below does.
    expect(readFileSync(path, "utf8")).toBe(before);

    const journal = readFileSync(join(home, "runs", "an-ordinary-ask.jsonl"), "utf8");
    expect(journal).toContain('"kind":"ruling"');
    expect(journal).toContain('"ruling":"yes, do the narrow one first"');

    const board = run({ args: ["handover", "list", "--home", home, "--all"] });
    expect(board.status).toBe(0);
    expect(board.stdout).toContain("ruling: yes, do the narrow one first (https://example.invalid/p9)");
    expect(board.stdout).toContain("recorded when the owner ruled, decided");
  });

  // A `parked` line from an unmerged branch made this verb refuse the owner's read of a briefing, from a
  // chair whose checkout predated that kind. A word no build has stands in for it here.
  it("records the owner's ruling beside a line this checkout cannot decode, and names the line and the word", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "an-ordinary-ask" });
    const journalPath = join(home, "runs", "an-ordinary-ask.jsonl");
    writeFileSync(journalPath, `${JSON.stringify({ atIso: "2026-09-07T00:01:00Z", kind: "some-future-kind" })}\n`);

    const ruled = run({
      args: ["handover", "rule", "an-ordinary-ask", "--home", home, "--anchor", "p-skip", "--words", "go ahead"],
    });

    expect(ruled.status).toBe(0);
    expect(ruled.stdout).toContain("now carries the owner's ruling (p-skip)");
    expect(ruled.stdout).toContain("1 line(s) of this journal (1) did not decode and were skipped");
    expect(ruled.stdout).toContain("the word(s) `some-future-kind` are ones THIS checkout's decoder has no case for");
    expect(readFileSync(journalPath, "utf8")).toContain('"ruling":"go ahead"');
  });

  it("puts the owner's ruling on `resume`, above the journal tail that would have aged it out", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "an-ordinary-ask" });
    expect(run({ args: ["handover", "start", "an-ordinary-ask", "--home", home] }).status).toBe(0);
    expect(
      run({
        args: [
          "handover",
          "rule",
          "an-ordinary-ask",
          "--home",
          home,
          "--anchor",
          "p9",
          "--words",
          "ship the narrow one",
        ],
      }).status,
    ).toBe(0);

    const resumed = run({ args: ["handover", "resume", "an-ordinary-ask", "--home", home] });

    expect(resumed.status).toBe(0);
    expect(resumed.stdout).toContain("ruling:  ship the narrow one");
    expect(resumed.stdout).toContain("           p9");
  });

  it("reads the LATER decision when an older ruling is recorded afterwards", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "an-ordinary-ask" });
    const rule = ({ anchor, decided, words }: { anchor: string; decided: string; words: string }): number =>
      run({
        args: [
          "handover",
          "rule",
          "an-ordinary-ask",
          "--home",
          home,
          "--anchor",
          anchor,
          "--words",
          words,
          "--decided-iso",
          decided,
        ],
      }).status;

    expect(rule({ anchor: "a2", decided: "2026-09-05T10:00:00.000Z", words: "actually, production" })).toBe(0);
    expect(rule({ anchor: "a1", decided: "2026-09-01T10:00:00.000Z", words: "start with staging" })).toBe(0);

    const board = run({ args: ["handover", "list", "--home", home, "--all"] });
    expect(board.stdout).toContain("ruling: actually, production (a2)");
    expect(board.stdout).not.toContain("ruling: start with staging");
  });

  it("records a ruling on an ARCHIVED row, whose journal is live even when its document is filed away", () => {
    const home = throwawayHome();
    const path = rowOn({ home, slug: "an-old-row" });
    const archive = join(home, "handovers", "archive");
    mkdirSync(archive);
    writeFileSync(join(archive, "an-old-row.md"), readFileSync(path, "utf8"), "utf8");
    rmSync(path);

    const ruled = run({
      args: ["handover", "rule", "an-old-row", "--home", home, "--anchor", "p9", "--words", "yes"],
    });

    expect(ruled.status).toBe(0);
    expect(readFileSync(join(home, "runs", "an-old-row.jsonl"), "utf8")).toContain('"kind":"ruling"');
  });

  it("records --attach-upload permitted and a later refused, and the upload reader follows each in turn", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "an-ordinary-ask" });
    const runsDir = join(home, "runs");
    const ruleWith = ({ verdict, decided }: { verdict: string; decided: string }) =>
      run({
        args: [
          "handover",
          "rule",
          "an-ordinary-ask",
          "--home",
          home,
          "--anchor",
          `p-${verdict}`,
          "--words",
          `pictures ${verdict}`,
          "--decided-iso",
          decided,
          "--attach-upload",
          verdict,
        ],
      });

    const before = readAttachUploadStanding({ runsDir }).kind;
    const permitted = ruleWith({ decided: "2026-11-20T01:00:00.000Z", verdict: "permitted" });
    const afterPermit = readAttachUploadStanding({ runsDir }).kind;
    const refused = ruleWith({ decided: "2026-11-21T01:00:00.000Z", verdict: "refused" });
    const afterRefusal = readAttachUploadStanding({ runsDir });

    expect([before, permitted.status, afterPermit, refused.status]).toEqual(["refused", 0, "permitted", 0]);
    expect(permitted.stdout).toContain("it PERMITS `github attach upload` on this install");
    expect(refused.stdout).toContain("it REFUSES `github attach upload` on this install");
    expect(afterRefusal).toMatchObject({ because: "ruled", by: { ruling: { anchor: "p-refused" } }, kind: "refused" });
  });

  it("refuses an --attach-upload value that is no verdict, and records nothing", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "an-ordinary-ask" });
    const args = ["handover", "rule", "an-ordinary-ask", "--home", home, "--anchor", "p9", "--words", "yes"];
    const refused = run({ args: [...args, "--attach-upload", "yes"] });
    expect([refused.status, readAttachUploadStanding({ runsDir: join(home, "runs") }).kind]).toEqual([2, "refused"]);
    expect(refused.stderr).toContain('--attach-upload "yes" is not a verdict — pass permitted or refused');
  });

  it("refuses without an anchor, and without the owner's words", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "an-ordinary-ask" });

    expect(run({ args: ["handover", "rule", "an-ordinary-ask", "--home", home, "--words", "yes"] }).status).toBe(2);
    expect(run({ args: ["handover", "rule", "an-ordinary-ask", "--home", home, "--anchor", "p9"] }).status).toBe(2);
  });

  it("records the instant the owner DECIDED it when --decided-iso says the relay came later", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "an-ordinary-ask" });

    expect(
      run({
        args: [
          "handover",
          "rule",
          "an-ordinary-ask",
          "--home",
          home,
          "--anchor",
          "p9",
          "--words",
          "yes",
          "--decided-iso",
          "2026-09-01T10:00:00.000Z",
        ],
      }).status,
    ).toBe(0);

    const journal = readFileSync(join(home, "runs", "an-ordinary-ask.jsonl"), "utf8");
    expect(journal).toContain('"decidedIso":"2026-09-01T10:00:00.000Z"');
  });

  it("refuses an unparseable --decided-iso rather than recording a decision nothing can order", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "an-ordinary-ask" });

    const refused = run({
      args: [
        "handover",
        "rule",
        "an-ordinary-ask",
        "--home",
        home,
        "--anchor",
        "p9",
        "--words",
        "yes",
        "--decided-iso",
        "last tuesday",
      ],
    });

    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("is not a canonical UTC instant");
  });

  it("refuses a loose --decided-iso spelling Date.parse would read as the wrong year", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "an-ordinary-ask" });

    const refused = run({
      args: [
        "handover",
        "rule",
        "an-ordinary-ask",
        "--home",
        home,
        "--anchor",
        "p9",
        "--words",
        "yes",
        "--decided-iso",
        "0001-01-01 00:00:00.000Z",
      ],
    });

    expect(Date.parse("0001-01-01 00:00:00.000Z")).toBe(Date.parse("2001-01-01T00:00:00.000Z"));
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('--decided-iso "0001-01-01 00:00:00.000Z" is not a canonical UTC instant');
    expect(run({ args: ["handover", "list", "--home", home, "--all"] }).stdout).not.toContain("ruling: yes (p9)");
  });

  it("refuses recording one decision twice", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "an-ordinary-ask" });
    const args = [
      "handover",
      "rule",
      "an-ordinary-ask",
      "--home",
      home,
      "--anchor",
      "p9",
      "--words",
      "yes",
      "--decided-iso",
      "2026-09-01T10:00:00.000Z",
    ];
    expect(run({ args }).status).toBe(0);

    const again = run({ args });

    expect(again.status).toBe(1);
    expect(again.stderr).toContain("already records that exact ruling");
  });

  it("leaves `handover answer` recording an answer and nothing else — no heuristic promotes one to a ruling", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "an-ordinary-ask" });
    expect(run({ args: ["handover", "start", "an-ordinary-ask", "--home", home] }).status).toBe(0);
    expect(
      run({ args: ["handover", "ask", "an-ordinary-ask", "--home", home, "--question", "which base?", ...ASK_SHAPE] })
        .status,
    ).toBe(0);
    expect(
      run({ args: ["handover", "answer", "an-ordinary-ask", "--home", home, "--answer", "OWNER RULED: main"] }).status,
    ).toBe(0);

    const journal = readFileSync(join(home, "runs", "an-ordinary-ask.jsonl"), "utf8");
    expect(journal).toContain('"kind":"answered"');
    expect(journal).not.toContain('"kind":"ruling"');

    const board = run({ args: ["handover", "list", "--home", home, "--all"] });
    expect(board.stdout).not.toContain("ruling: OWNER RULED: main");
  });
});
