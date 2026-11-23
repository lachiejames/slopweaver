/**
 * `handover reconfirm`, `correct` and `withdraw` over the SHIPPED verbs, on a row `handover register` wrote and
 * no run ever opened. Measured: all three refused every such card with "no run is open — start it
 * first", and starting a run is what takes the card off the owner's Queue — so a refresh pass could neither re-date,
 * re-word nor retire one. Each edit lands in the row's own file, opens no journal, and the board reads it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { ASK_SHAPE } from "./askShapeArgs.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SLUG = "a-registered-ask";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function run({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(BIN, args, {
    encoding: "utf8",
    env: { HOME: process.env["HOME"]!, PATH: process.env["PATH"]!, TMPDIR: process.env["TMPDIR"]! },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status === null) {
    throw new Error(`slopweaver ${args.join(" ")} exited on signal ${String(result.signal)}, with no status`);
  }
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

/** A throwaway home holding one registered ask, whole-shaped, with no run. */
function registered(): string {
  const home = mkdtempSync(join(tmpdir(), "registered-ask-"));
  homes.push(home);
  mkdirSync(join(home, "handovers"));
  mkdirSync(join(home, "runs"));
  const args = ["handover", "register", "--home", home, "--ask", "Should the base be main?", ...ASK_SHAPE];
  expect(run({ args: [...args, "--slug", SLUG, "--asked-iso", "2026-10-10T00:00:00Z"] }).status).toBe(0);
  return home;
}

/** One line past the still-real cap of 30 words, in one sentence, so the word cap is the only one it breaks. */
const OVER_CAP = Array.from({ length: 31 }, (_, index) => `word${String(index)}`).join(" ");

/**
 * A registered ask whose still-real line was hand-edited past the cap — the measured row, read
 * CONTRADICTION and blocked every push while reconfirm and correct answered "no run is open".
 */
function overCap(): string {
  const home = registered();
  const path = join(home, "handovers", `${SLUG}.md`);
  const text = readFileSync(path, "utf8");
  // Both copies, the way a row registered with an over-cap line carries it: the front-matter key and the body bullet.
  const edited = text
    .replace('stillReal: "the doc still cites both branches"', `stillReal: "${OVER_CAP}"`)
    .replace("- **Still real** — the doc still cites both branches\n", `- **Still real** — ${OVER_CAP}\n`);
  expect(edited).toContain(`stillReal: "${OVER_CAP}"`);
  expect(edited).toContain(`- **Still real** — ${OVER_CAP}\n`);
  writeFileSync(path, edited);
  return home;
}

/** The row's file as it reads now. */
function rowText({ home }: { home: string }): string {
  return readFileSync(join(home, "handovers", `${SLUG}.md`), "utf8");
}

/** The row as `handover list --json` publishes it. */
function listed({ home }: { home: string }): { section: string; ownerWait: string; run: string } {
  const out = run({ args: ["handover", "list", "--json", "--home", home] });
  const rows = (JSON.parse(out.stdout) as { rows: { slug: string; section: string; ownerWait: string; run: string }[] })
    .rows;
  const { section, ownerWait, run: disposition } = rows.find((row) => row.slug === SLUG)!;
  return { ownerWait, run: disposition, section };
}

describe("a registered ask no run has opened", () => {
  it("is reconfirmed in its own front matter, opens no journal, and stays the owner's", () => {
    const home = registered();

    const result = run({
      args: ["handover", "reconfirm", SLUG, "--home", home, "--still-real", "the doc cites both at a8ecbd09"],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`handover reconfirm: ${SLUG} still stands as of`);
    expect(rowText({ home })).toContain('stillReal: "the doc cites both at a8ecbd09"\n');
    expect(existsSync(join(home, "runs", `${SLUG}.jsonl`))).toBe(false);
    expect(listed({ home })).toEqual({ ownerWait: "owner", run: "never-started", section: "WAITING ON OWNER" });
  });

  it("is corrected in place — summary, heading and brief — and stays the owner's", () => {
    const home = registered();

    const result = run({
      args: [
        "handover",
        "correct",
        SLUG,
        "--home",
        home,
        "--question",
        "Should the base be main, now the release branch is gone?",
        "--why",
        "the release branch was deleted",
        "--still-real",
        "the doc still cites the deleted branch",
      ],
    });

    expect(result.status).toBe(0);
    expect(rowText({ home })).toContain('summary: "Should the base be main, now the release branch is gone?"\n');
    expect(rowText({ home })).toContain("\n# Should the base be main, now the release branch is gone?\n");
    expect(rowText({ home })).not.toContain("\n# Should the base be main?\n");
    expect(rowText({ home })).toContain('statusSummary: "Question corrected: the release branch was deleted"\n');
    expect(existsSync(join(home, "runs", `${SLUG}.jsonl`))).toBe(false);
    expect(listed({ home })).toEqual({ ownerWait: "owner", run: "never-started", section: "WAITING ON OWNER" });
  });

  it("refuses a correction that leaves the card's check unrestated, writing nothing", () => {
    const home = registered();
    const before = rowText({ home });

    const result = run({
      args: ["handover", "correct", SLUG, "--home", home, "--question", "Base on main?", "--why", "shorter"],
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--still-real is required");
    expect(rowText({ home })).toBe(before);
  });

  it("is withdrawn as cancelled with its reason, by any session, never as the owner's answer", () => {
    const home = registered();

    const result = run({ args: ["handover", "withdraw", SLUG, "--home", home, "--why", "superseded by a newer row"] });

    expect(result.status).toBe(0);
    expect(rowText({ home })).toContain("\nstatus: cancelled\n");
    expect(rowText({ home })).toContain(
      'statusSummary: "Withdrawn, not the owner\'s answer: superseded by a newer row"\n',
    );
    expect(rowText({ home })).not.toContain("settlement:");
    expect(existsSync(join(home, "runs", `${SLUG}.jsonl`))).toBe(false);
    expect(listed({ home }).section).toBe("CLOSED — NOT SHIPPED");
  });

  it("is repaired by a reconfirm when its own still-real line is what breaks the cap", () => {
    const home = overCap();
    expect(listed({ home }).section).toBe("CONTRADICTION");

    const result = run({ args: ["handover", "reconfirm", SLUG, "--home", home, "--still-real", "still cited"] });

    expect(result.status).toBe(0);
    expect(rowText({ home })).toContain('stillReal: "still cited"\n');
    expect(rowText({ home })).toContain("- **Still real** — still cited\n");
    expect(rowText({ home })).not.toContain(OVER_CAP);
    expect(existsSync(join(home, "runs", `${SLUG}.jsonl`))).toBe(false);
    expect(listed({ home })).toEqual({ ownerWait: "owner", run: "never-started", section: "WAITING ON OWNER" });
  });

  it("is repaired by a correction that restates the over-cap still-real line", () => {
    const home = overCap();

    const result = run({
      args: [
        "handover",
        "correct",
        SLUG,
        "--home",
        home,
        "--question",
        "Base on main?",
        "--why",
        "shorter",
        "--still-real",
        "still cited",
      ],
    });

    expect(result.status).toBe(0);
    expect(rowText({ home })).toContain('summary: "Base on main?"\n');
    expect(rowText({ home })).toContain("- **Still real** — still cited\n");
    expect(rowText({ home })).not.toContain(OVER_CAP);
    expect(listed({ home })).toEqual({ ownerWait: "owner", run: "never-started", section: "WAITING ON OWNER" });
  });

  it("refuses a reconfirm whose own line breaks the cap, writing nothing", () => {
    const home = registered();
    const before = rowText({ home });

    const result = run({ args: ["handover", "reconfirm", SLUG, "--home", home, "--still-real", OVER_CAP] });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("still-real check runs 31 words against a cap of 30");
    expect(rowText({ home })).toBe(before);
  });

  it("goes back to the run path once a run opens, which still refuses with no question waiting", () => {
    const home = registered();
    expect(run({ args: ["handover", "start", SLUG, "--home", home] }).status).toBe(0);

    const result = run({ args: ["handover", "reconfirm", SLUG, "--home", home, "--still-real", "still cited"] });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no open question to re-confirm");
    expect(rowText({ home })).not.toContain('stillReal: "still cited"');
  });
});
