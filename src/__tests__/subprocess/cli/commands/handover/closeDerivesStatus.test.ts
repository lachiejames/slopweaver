/**
 * `handover close` records that a row's work SHIPPED, and every reader then DERIVES `done` from that one
 * event — with the row's `status:` line untouched.
 *
 * This is the behavioural proof for the owner's ruling to derive the state and delete
 * the second copy, and it has to be a subprocess test rather than a unit one. What the ruling closes is
 * that **two readers of one row gave different answers**, so nothing short of running the SHIPPED verbs over
 * a throwaway board can show that they now agree: the derivation is unit-tested in
 * `unit/handover/derivedRowState.test.ts`, and a pure test cannot show that `handover list` reaches it.
 *
 * The falsifiable witness is the pair of assertions on the `status:` LINE. A `close` that quietly spliced
 * `status: done` into the file would satisfy every "the board says DONE" assertion here while being exactly
 * the second copy the ruling deletes, so the file's own text is read back and asserted unchanged.
 *
 * `SLOPWEAVER_CLI_DIR` is set deliberately: `bin/slopweaver` otherwise resolves its checkout from an ambient
 * `PLUGIN_ROOT`, and a proof run from a worktree would silently exercise the main checkout instead.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { absentAsNumber } from "#lib/absent.js";
import { unwrap } from "#lib/result.js";

import { acquireClosingLock } from "../../../../../cli/commands/handover/closingLock.js";
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
  const home = mkdtempSync(join(tmpdir(), "close-derives-"));
  homes.push(home);
  mkdirSync(join(home, "handovers"));
  mkdirSync(join(home, "runs"));
  return home;
}

function run({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(BIN, args, {
    encoding: "utf8",
    env: {
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

/** Register one ask row on a fresh home. */
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

/** The row's own `status:` line, so a splice into front-matter is visible rather than inferred. */
function statusLineOf({ path }: { path: string }): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .find((line) => line.startsWith("status:"))!;
}

describe("handover close", () => {
  it("records the shipment, leaves `status:` alone, and the board reads DONE", () => {
    const home = throwawayHome();
    const path = rowOn({ home, slug: "a-shipped-row" });
    expect(statusLineOf({ path })).toBe("status: ready");

    const closed = run({
      args: ["handover", "close", "a-shipped-row", "--home", home, "--summary", "landed as #445"],
    });

    expect(closed.status).toBe(0);
    expect(closed.stdout).toContain("a-shipped-row shipped — landed as #445");
    // The falsifiable half: the file the verb was pointed at is byte-identical on the line that used to be
    // hand-edited. If `close` ever starts writing it, this fails before any board assertion below does.
    expect(statusLineOf({ path })).toBe("status: ready");

    const journal = readFileSync(join(home, "runs", "a-shipped-row.jsonl"), "utf8");
    expect(journal).toContain('"kind":"closed"');
    expect(journal).toContain('"summary":"landed as #445"');

    // The row now reads DONE on the composed board while its own file still says `ready`, which is the two
    // readers agreeing. Before the derivation existed this row printed under `RUN NOW`.
    const board = run({ args: ["handover", "list", "--home", home, "--all"] });
    expect(board.status).toBe(0);
    expect(board.stdout).toContain("DONE: a-shipped-row");
    expect(board.stdout).toContain("Nothing is runnable right now.");
  });

  it("refuses a SECOND close, because work cannot ship twice", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "a-shipped-row" });
    expect(run({ args: ["handover", "close", "a-shipped-row", "--home", home, "--summary", "one"] }).status).toBe(0);

    const again = run({ args: ["handover", "close", "a-shipped-row", "--home", home, "--summary", "two"] });

    expect(again.status).toBe(1);
    expect(again.stderr).toContain("already recorded that it shipped");
  });

  it("closes the execution doors on the row it just closed", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "a-shipped-row" });
    expect(run({ args: ["handover", "close", "a-shipped-row", "--home", home, "--summary", "landed"] }).status).toBe(0);

    const started = run({ args: ["handover", "start", "a-shipped-row", "--home", home] });

    expect(started.status).toBe(1);
    expect(started.stderr).toContain("recorded that its work SHIPPED");
  });

  it("refuses a blank summary rather than recording a shipment nobody can read", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "a-shipped-row" });

    const closed = run({ args: ["handover", "close", "a-shipped-row", "--home", home, "--summary", "  "] });

    expect(closed.status).toBe(2);
    expect(closed.stderr).toContain("--summary are both required");
  });
});

describe("handover artifact", () => {
  it("supersedes the recorded pointer by append, naming what it replaced", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "a-published-row" });

    const first = run({
      args: ["handover", "artifact", "a-published-row", "--home", home, "--url", "https://old.invalid/p"],
    });
    expect(first.status).toBe(0);

    const second = run({
      args: ["handover", "artifact", "a-published-row", "--home", home, "--url", "https://new.invalid/p"],
    });

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("a-published-row's artifact is https://new.invalid/p");
    // Both survive, in order: superseding is an append, so the earlier pointer stays queryable.
    const urls = readFileSync(join(home, "runs", "a-published-row.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { kind: string; url?: string })
      .filter((event) => event.kind === "artifact")
      .map((event) => event.url);
    expect(urls).toEqual(["https://old.invalid/p", "https://new.invalid/p"]);
  });

  it("refuses a slug no row on the board claims", () => {
    const home = throwawayHome();

    const missing = run({
      args: ["handover", "artifact", "nobody-claims-this", "--home", home, "--url", "https://e.invalid/p"],
    });

    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('no row on the board claims the slug "nobody-claims-this"');
  });

  it("writes nothing while a settle or finish holds the row's closing lock", () => {
    // An artifact landing between a closer's page-gate read and its terminal write closes it uncarded.
    const home = throwawayHome();
    rowOn({ home, slug: "a-closing-row" });
    const held = unwrap(acquireClosingLock({ home, nowIso: new Date().toISOString(), slug: "a-closing-row" }));
    try {
      const blocked = run({
        args: ["handover", "artifact", "a-closing-row", "--home", home, "--url", "page:a-closing-page"],
      });
      expect(blocked.status).toBe(1);
      expect(blocked.stderr).toContain("handover artifact: a-closing-row is being closed, so nothing was written");
      expect(existsSync(join(home, "runs", "a-closing-row.jsonl"))).toBe(false);
    } finally {
      held.release();
    }
  });
});
