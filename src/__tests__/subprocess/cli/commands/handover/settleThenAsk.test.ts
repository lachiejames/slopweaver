/**
 * A question recorded on an ask row AFTER it was settled is on no surface: the board, reconcile and the Queue all skip
 * a settled row. The shipped `handover ask` refuses one, and `handover list` names any a journal already holds.
 * The pure halves are `unit/handover/settledAsk.test.ts`; this proves the CLI reaches them.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";
import { ASK_SHAPE } from "./askShapeArgs.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

/** A throwaway state home with the two directories the board and the journals live in, removed in `afterAll`. */
function throwawayHome(): string {
  const home = mkdtempSync(join(tmpdir(), "settle-then-ask-"));
  mkdirSync(join(home, "handovers"));
  mkdirSync(join(home, "runs"));
  return home;
}

/**
 * A user home whose Claude Code session registry is empty, so no verb here reads this machine's real one. Every call
 * runs as {@link SEAT}, which therefore HOLDS the run it starts — the seat a settle leaves open and a withdraw needs.
 */
let userHome = "";

beforeAll(() => {
  userHome = mkdtempSync(join(tmpdir(), "settle-then-ask-user-"));
  mkdirSync(join(userHome, ".claude", "sessions"), { recursive: true });
});

afterAll(() => {
  rmSync(userHome, { force: true, recursive: true });
});

const SEAT = "seat-under-test";

function run({ args }: { args: readonly string[] }): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(BIN, args, {
    encoding: "utf8",
    env: {
      ...accountSandboxChildEnv(),
      CLAUDE_CODE_SESSION_ID: SEAT,
      HOME: userHome,
      PATH: process.env["PATH"]!,
      // The lesson gate reads the memories table and this lane has no database — `settleLeavesRunOpen.test.ts`'s
      // `run` carries the whole reason.
      SLOPWEAVER_ALLOW_NO_LESSONS: "1",
      TMPDIR: process.env["TMPDIR"]!,
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return {
    // `null` when a signal killed the child: no exit status, so no assertion on one can pass.
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

/** Register one ask row and open a run on it, as a seat does before it works the row. */
function startedRow({ home, slug }: { home: string; slug: string }): void {
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
  expect(run({ args: ["handover", "start", slug, "--home", home] }).status).toBe(0);
}

function settle({ home, slug }: { home: string; slug: string }): number | null {
  return run({
    args: ["handover", "settle", slug, "--home", home, "--as", "answered", "--witness", "w", "--lessons", "none"],
  }).status;
}

function ask({ home, slug }: { home: string; slug: string }): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  return run({ args: ["handover", "ask", slug, "--home", home, "--question", "which base?", ...ASK_SHAPE] });
}

/** An archived ask settled before `settledIso` existed, whose journal holds a question — the board's recovery drops it. */
function archivedAsk({ home }: { home: string }): void {
  mkdirSync(join(home, "handovers", "archive"));
  const doc = [
    "---",
    "slug: archived-ask",
    "kind: ask",
    "summary: an archived ask settled before settledIso existed",
    "status: ready",
    "settlement: answered",
    "settlementWitness: w",
    "---",
    "",
  ];
  writeFileSync(join(home, "handovers", "archive", "archived-ask.md"), doc.join("\n"));
  const events = [
    { atIso: "2026-10-08T00:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
    { atIso: "2026-10-08T01:00:00.000Z", kind: "question", question: "still on main?" },
  ];
  writeFileSync(join(home, "runs", "archived-ask.jsonl"), events.map((event) => `${JSON.stringify(event)}\n`).join(""));
}

/**
 * ONE board, built once through the real verbs, because every spawn here is a cold CLI start and the lane's wall
 * time is a ratcheted budget. It holds a row asked then settled (`early-row`), a row settled then refused an ask
 * (`settled-row`), a row settled whose journal then gained a question (`late-row`, the line a checkout predating
 * the refusal leaves) and an archived one (`archived-ask`). Every read below runs over that same board, so each
 * assertion that a row is named is also one that its neighbours are not; the withdraw case mutates it and runs last.
 */
let board = "";

function buildBoard({ home }: { home: string }): void {
  startedRow({ home, slug: "early-row" });
  expect(ask({ home, slug: "early-row" }).status).toBe(0);
  expect(settle({ home, slug: "early-row" })).toBe(0);
  startedRow({ home, slug: "settled-row" });
  expect(settle({ home, slug: "settled-row" })).toBe(0);
  startedRow({ home, slug: "late-row" });
  expect(settle({ home, slug: "late-row" })).toBe(0);
  const late = { atIso: "2099-01-01T00:00:00.000Z", kind: "question", question: "which base, now?" };
  appendFileSync(join(home, "runs", "late-row.jsonl"), `${JSON.stringify(late)}\n`);
  archivedAsk({ home });
}

beforeAll(() => {
  board = throwawayHome();
  buildBoard({ home: board });
  // Eleven cold CLI starts in one hook: the lane's 60s `hookTimeout` budgets a hook that does one.
}, 240_000);

afterAll(() => {
  rmSync(board, { force: true, recursive: true });
});

describe("handover ask on a settled ask row", () => {
  it("recorded the question on the row while it was unsettled — the witness that the refusal below is the settlement's", () => {
    expect(readFileSync(join(board, "runs", "early-row.jsonl"), "utf8")).toContain('"kind":"question"');
  });

  it("refuses once the row is settled, naming the settlement, and journals nothing", () => {
    const result = ask({ home: board, slug: "settled-row" });

    expect(result.status).toBe(1);
    expect(result.stderr.split("\n")).toContain(
      "handover ask: settled-row is an ask row already settled answered (witness: w), so a question recorded on",
    );
    const journal = readFileSync(join(board, "runs", "settled-row.jsonl"), "utf8");
    expect(journal).toContain('"kind":"started"');
    expect(journal).not.toContain('"kind":"question"');
  });
});

describe("handover list over a question journalled after its row was settled", () => {
  it("names the late and the archived row under the board, and not the row asked BEFORE it was settled", () => {
    const result = run({ args: ["handover", "list", "--home", board] });
    const lines = result.stdout.split("\n");

    expect(result.status).toBe(0);
    expect(lines).toContain("⚠ ASKED AFTER ITS ROW WAS SETTLED, ON NO SURFACE (2)");
    expect(lines.some((line) => line.startsWith("  late-row — settled answered "))).toBe(true);
    expect(lines).toContain("    which base, now?");
    expect(lines.some((line) => line.startsWith("  early-row — "))).toBe(false);
  });

  it("publishes them on --json whatever --tag narrows the rows to, the archived one with no settledIso unordered", () => {
    const result = run({
      args: ["handover", "list", "--home", board, "--json", "--tag", "workstream=nothing-matches"],
    });

    expect(result.status).toBe(0);
    const document = JSON.parse(result.stdout) as {
      readonly rows: readonly unknown[];
      readonly settledThenAsked: readonly {
        readonly slug: string;
        readonly question: string;
        readonly order: string;
      }[];
    };
    expect(document.rows).toEqual([]);
    const bySlug = document.settledThenAsked.toSorted((a, b) => a.slug.localeCompare(b.slug));
    expect(bySlug.map((row) => [row.slug, row.question])).toEqual([
      ["archived-ask", "still on main?"],
      ["late-row", "which base, now?"],
    ]);
    expect(document.settledThenAsked.find((row) => row.slug === "archived-ask")!.order).toBe("unordered");
  });

  it("stops naming a row once the route it prints, `handover withdraw`, is taken", () => {
    const withdrawn = run({ args: ["handover", "withdraw", "late-row", "--home", board, "--why", "the base is main"] });

    expect(withdrawn.status).toBe(0);
    const lines = run({ args: ["handover", "list", "--home", board] }).stdout.split("\n");
    expect(lines).toContain("⚠ ASKED AFTER ITS ROW WAS SETTLED, ON NO SURFACE (1)");
    expect(lines.some((line) => line.startsWith("  late-row — "))).toBe(false);
  });
});
