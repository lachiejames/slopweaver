/**
 * `handover correct` restates a waiting run's question, and every reader of the run then sees the new text.
 *
 * Measured on `the-vanta-walk-is-the-only-atlas-browser`: a recorded question quoted one run's 10-of-12 as the
 * outcome when four runs gave 9/8/9/10, and `ask` refuses a second question. The pure reducer is unit-tested;
 * this runs the SHIPPED verb over a throwaway home, because only that proves the CLI reaches it and that
 * `resume` reads the corrected text back.
 *
 * Neither `ask` nor `correct` posts anything (a blocked-on-you row never DMs the owner). Before
 * that rule, this same throwaway home — no `profile.json`, so no owner — made both verbs print a
 * `NOT DELIVERED` line on stderr; its absence below is therefore a witness that the send path is gone, not
 * silence that would pass either way.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { ASK_SHAPE } from "./askShapeArgs.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SLUG = "stale-question-row";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home with the two directories the board and the journals live in. */
function throwawayHome(): string {
  const home = mkdtempSync(join(tmpdir(), "correct-question-"));
  homes.push(home);
  mkdirSync(join(home, "handovers"));
  mkdirSync(join(home, "runs"));
  return home;
}

function run({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(BIN, args, {
    encoding: "utf8",
    env: { HOME: process.env["HOME"]!, PATH: process.env["PATH"]!, TMPDIR: process.env["TMPDIR"]! },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status === null) {
    throw new Error(`slopweaver ${args.join(" ")} ended on a signal (${String(result.signal)}), with no exit status`);
  }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

/** Register the row and open a run cycle on it. */
function openRun({ home }: { home: string }): void {
  expect(
    run({
      args: [
        "handover",
        "register",
        "--home",
        home,
        "--ask",
        `Should ${SLUG} be done?`,
        ...ASK_SHAPE,
        "--slug",
        SLUG,
        "--asked-iso",
        "2026-09-07T00:00:00Z",
      ],
    }).status,
  ).toBe(0);
  expect(run({ args: ["handover", "start", SLUG, "--home", home] }).status).toBe(0);
}

function correct({
  home,
  stillReal = ["--still-real", "four runs read 9/8/9/10 of 12"],
}: {
  home: string;
  stillReal?: readonly string[];
}): { status: number; stdout: string; stderr: string } {
  return run({
    args: [
      "handover",
      "correct",
      SLUG,
      "--home",
      home,
      "--question",
      "9/8/9/10 of 12 — ship it?",
      "--why",
      "quoted one run as the outcome",
      ...stillReal,
    ],
  });
}

/** The row's one published entry off `handover list --json`, which is what the Queue card reads. */
function listedRow({ home }: { home: string }): { stillReal: string; question: string } {
  const listed = run({ args: ["handover", "list", "--json", "--home", home] });
  expect(listed.status).toBe(0);
  const { rows } = JSON.parse(listed.stdout) as {
    rows: readonly { slug: string; stillReal: string; question: string }[];
  };
  return rows.find((row) => row.slug === SLUG)!;
}

describe("handover correct", () => {
  it("refuses a run with no question waiting, and journals nothing", () => {
    const home = throwawayHome();
    openRun({ home });

    const result = correct({ home });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("this run has no open question to correct");
    const journal = readFileSync(join(home, "runs", `${SLUG}.jsonl`), "utf8");
    expect(journal).toContain('"kind":"started"');
    expect(journal).not.toContain('"kind":"question-corrected"');
  });

  it("journals the corrected text, attempts no Slack delivery, and resume reads the new question", () => {
    const home = throwawayHome();
    openRun({ home });
    const asked = run({
      args: ["handover", "ask", SLUG, "--home", home, "--question", "10 of 12 — ship it?", ...ASK_SHAPE],
    });
    expect(asked.status).toBe(0);
    expect(asked.stderr).not.toContain("DELIVERED");

    const result = correct({ home });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`handover correct: recorded the corrected question for ${SLUG}`);
    expect(result.stderr).not.toContain("DELIVERED");
    const journal = readFileSync(join(home, "runs", `${SLUG}.jsonl`), "utf8");
    expect(journal).toContain('"kind":"question-corrected"');
    expect(journal).not.toContain('"kind":"question-posted"');
    const resumed = run({ args: ["handover", "resume", SLUG, "--home", home] });
    expect(resumed.stdout).toContain("9/8/9/10 of 12 — ship it?");
    expect(resumed.stdout).not.toContain("    10 of 12 — ship it?");
  });

  it("restates the still-real line with the text, so the card no longer prints the check the ask was recorded with", () => {
    const home = throwawayHome();
    openRun({ home });
    expect(
      run({ args: ["handover", "ask", SLUG, "--home", home, "--question", "10 of 12 — ship it?", ...ASK_SHAPE] })
        .status,
    ).toBe(0);
    // The witness that the line below MOVED: before the correction the card prints the ask's own check.
    expect(listedRow({ home }).stillReal).toBe("the doc still cites both branches");

    const result = correct({ home });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("four runs read 9/8/9/10 of 12");
    const row = listedRow({ home });
    expect(row.question).toBe("9/8/9/10 of 12 — ship it?");
    expect(row.stillReal).toBe("four runs read 9/8/9/10 of 12");
  });

  it("refuses a correction with no --still-real while the card prints one, quotes that line, and journals nothing", () => {
    const home = throwawayHome();
    openRun({ home });
    expect(
      run({ args: ["handover", "ask", SLUG, "--home", home, "--question", "10 of 12 — ship it?", ...ASK_SHAPE] })
        .status,
    ).toBe(0);

    const result = correct({ home, stillReal: [] });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      'handover correct: --still-real is required — the card prints "the doc still cites both branches"',
    );
    const journal = readFileSync(join(home, "runs", `${SLUG}.jsonl`), "utf8");
    expect(journal).not.toContain('"kind":"question-corrected"');
    expect(journal).not.toContain('"kind":"question-reconfirmed"');
  });

  it("holds --still-real to reconfirm's prose gates: a draft the register does not hold is refused before either line", () => {
    const home = throwawayHome();
    openRun({ home });
    expect(
      run({ args: ["handover", "ask", SLUG, "--home", home, "--question", "10 of 12 — ship it?", ...ASK_SHAPE] })
        .status,
    ).toBe(0);

    const result = correct({ home, stillReal: ["--still-real", "draft sd-deadbeef is held and unsent"] });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("sd-deadbeef is not in the drafts register");
    const journal = readFileSync(join(home, "runs", `${SLUG}.jsonl`), "utf8");
    expect(journal).not.toContain('"kind":"question-corrected"');
    expect(journal).not.toContain('"kind":"question-reconfirmed"');
  });

  it("refuses a blank --still-real, and journals nothing", () => {
    const home = throwawayHome();
    openRun({ home });
    expect(
      run({ args: ["handover", "ask", SLUG, "--home", home, "--question", "10 of 12 — ship it?", ...ASK_SHAPE] })
        .status,
    ).toBe(0);

    const result = correct({ home, stillReal: ["--still-real", "   "] });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("handover correct: --still-real must be one non-empty line");
    const journal = readFileSync(join(home, "runs", `${SLUG}.jsonl`), "utf8");
    expect(journal).not.toContain('"kind":"question-corrected"');
  });

  it("refuses a correction that leads with a statement and names a PR with no link, and journals nothing", () => {
    const home = throwawayHome();
    openRun({ home });
    expect(
      run({ args: ["handover", "ask", SLUG, "--home", home, "--question", "10 of 12 — ship it?", ...ASK_SHAPE] })
        .status,
    ).toBe(0);

    const result = run({
      args: [
        "handover",
        "correct",
        SLUG,
        "--home",
        home,
        "--question",
        "The slopweaver half has LANDED — #1085 merged. Say A or B.",
        "--why",
        "the row said queued",
      ],
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("slopweaver handover correct blocked because the question does not line up");
    expect(result.stderr).toContain('it names "#1085" with no link');
    const journal = readFileSync(join(home, "runs", `${SLUG}.jsonl`), "utf8");
    expect(journal).not.toContain('"kind":"question-corrected"');
  });
});
