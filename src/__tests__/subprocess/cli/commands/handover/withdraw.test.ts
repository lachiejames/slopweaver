/**
 * `handover withdraw` over the SHIPPED verb and a throwaway home: the holder takes its own waiting question back
 * with no `answered` line written, and a session that does not hold the run is refused before anything is journalled.
 *
 * Why a subprocess test: the ownership guard reads the calling session from the environment, and a spawned verb with
 * an env this test controls runs end to end, against a throwaway home, as the shipped binary would.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { ASK_SHAPE } from "./askShapeArgs.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

const HOLDER = "a0000006-0000-4000-8000-000000000007";
const PEER = "a0000008-0000-4000-8000-000000000009";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home carrying one handover doc under the given slug. */
function homeWithDoc({ slug }: { slug: string }): string {
  const home = mkdtempSync(join(tmpdir(), "withdraw-"));
  homes.push(home);
  mkdirSync(join(home, "handovers"));
  mkdirSync(join(home, "runs"));
  writeFileSync(
    join(home, "handovers", `${slug}.md`),
    ["---", `slug: ${slug}`, "summary: a row", "status: ready", "---", "", "# A row", ""].join("\n"),
  );
  return home;
}

/** Run the shipped CLI as one session, or as none when `session` is `undefined`. */
function run({ args, session }: { args: readonly string[]; session: string | undefined }): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(BIN, args, {
    encoding: "utf8",
    env: {
      ...(session === undefined ? {} : { CLAUDE_CODE_SESSION_ID: session }),
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      TMPDIR: process.env["TMPDIR"]!,
    },
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

/** Open a run on the doc as the holder (or as no session, leaving it unowned), then ask it a question. */
function asked({ slug, unowned = false }: { slug: string; unowned?: boolean }): string {
  const home = homeWithDoc({ slug });
  const session = unowned ? undefined : HOLDER;
  expect(run({ args: ["handover", "start", slug, "--home", home], session }).status).toBe(0);
  const ask = run({
    args: ["handover", "ask", slug, "--home", home, "--question", "OK to ship?", ...ASK_SHAPE],
    session,
  });
  expect(ask.status).toBe(0);
  return home;
}

/** The kinds on a row's journal, in order. */
function kinds({ home, slug }: { home: string; slug: string }): readonly string[] {
  return readFileSync(join(home, "runs", `${slug}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((line) => (JSON.parse(line) as { kind: string }).kind);
}

describe("handover withdraw", () => {
  it("journals a withdrawal of the open question, and no answer, for the holder", () => {
    const home = asked({ slug: "a-withdrawn-row" });

    const result = run({
      args: ["handover", "withdraw", "a-withdrawn-row", "--home", home, "--why", "CI went green on its own"],
      session: HOLDER,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("withdrew the question for a-withdrawn-row");
    expect(kinds({ home, slug: "a-withdrawn-row" }).slice(-2)).toEqual(["question", "question-withdrawn"]);
    expect(kinds({ home, slug: "a-withdrawn-row" })).not.toContain("answered");
  });

  it("refuses a second withdrawal once nothing is waiting", () => {
    const home = asked({ slug: "a-twice-row" });
    const args = ["handover", "withdraw", "a-twice-row", "--home", home, "--why", "resolved"];
    expect(run({ args, session: HOLDER }).status).toBe(0);

    const again = run({ args, session: HOLDER });

    expect(again.status).toBe(1);
    expect(again.stderr).toContain("no open question to withdraw");
  });

  it("refuses a session that does not hold the run, and journals nothing", () => {
    const home = asked({ slug: "a-held-row" });

    const result = run({
      args: ["handover", "withdraw", "a-held-row", "--home", home, "--why", "a peer thinks so"],
      session: PEER,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`held by session ${HOLDER}`);
    expect(kinds({ home, slug: "a-held-row" })).not.toContain("question-withdrawn");
  });

  it("refuses every session on a run with no recorded holder, naming the claim to take first", () => {
    const home = asked({ slug: "an-unowned-row", unowned: true });

    const result = run({
      args: ["handover", "withdraw", "an-unowned-row", "--home", home, "--why", "a stranger thinks so"],
      session: PEER,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("has no recorded holder");
    expect(result.stderr).toContain("handover claim an-unowned-row");
    expect(kinds({ home, slug: "an-unowned-row" }).slice(-1)).toEqual(["question"]);
  });
});
