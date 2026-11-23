/**
 * `handover row` prints the row `handover list --json` prints for the same slug, from that doc and its
 * dependencies alone — the parity its whole reason to exist rests on (`src/cli/commands/handover/rowRun.ts`).
 *
 * Real CLI, real files: a sandbox board carrying the target, a live and an archived dependency, an unrelated
 * doc, and a file no scan can read — so parity, the archived-target refusal and the
 * bounded read are each proved against the shipped verb rather than a restatement of it.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A summary past the board's 320-character cap, so the row's whole one is observable. */
const LONG_SUMMARY = `waits on the prerequisite ${"and says so at length ".repeat(20)}end`;

/**
 * One doc's file text.
 *
 * @param slug the doc's slug
 * @param status its authored status
 * @param blockedBy the slugs it waits on
 * @param summary its stable "what is this work" line
 * @returns the Markdown with front matter
 */
function docText({
  slug,
  status,
  blockedBy,
  summary,
}: {
  slug: string;
  status: string;
  blockedBy: readonly string[];
  summary: string;
}): string {
  return (
    `---\nslug: ${slug}\nstatus: ${status}\nstatusSummary: in hand\nsummary: ${summary}\nblockedBy: [${blockedBy.join(", ")}]\n` +
    `artifact: https://example.invalid/${slug}\ndoneWhen: []\n---\n\n${slug}\n`
  );
}

/** A sandbox home whose handovers directory holds the fixture board. */
function sandboxBoard(): { home: string; handoverDir: string } {
  const home = mkdtempSync(join(tmpdir(), "handover-row-"));
  fixtureDirs.push(home);
  const handoverDir = join(home, "handovers");
  mkdirSync(join(handoverDir, "archive"), { recursive: true });
  const write = ({ path, text }: { path: string; text: string }): void => {
    writeFileSync(join(handoverDir, path), text, "utf8");
  };
  write({
    path: "target-ask.md",
    text: docText({ blockedBy: ["live-dep", "filed-dep"], slug: "target-ask", status: "ready", summary: LONG_SUMMARY }),
  });
  write({ path: "live-dep.md", text: docText({ blockedBy: [], slug: "live-dep", status: "ready", summary: "dep" }) });
  write({ path: "unrelated.md", text: docText({ blockedBy: [], slug: "unrelated", status: "ready", summary: "x" }) });
  write({ path: "broken.md", text: "---\nslug: [unterminated\n---\n" });
  write({
    path: join("archive", "filed-dep.md"),
    text: docText({ blockedBy: [], slug: "filed-dep", status: "done", summary: "shipped" }),
  });
  return { handoverDir, home };
}

function run({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(BIN, args, {
    encoding: "utf8",
    env: { HOME: process.env["HOME"]!, PATH: process.env["PATH"]!, SLOPWEAVER_LAUNCHER_QUIET: "1" },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status === null) {
    throw new Error(`slopweaver ${args.join(" ")} ended on signal ${String(result.signal)}, with no exit status`);
  }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

describe("handover row", () => {
  it("prints the row handover list --json prints for the slug, with its summary whole", () => {
    const { handoverDir, home } = sandboxBoard();
    const scope = ["--dir", handoverDir, "--home", home, "--json"];
    const row = run({ args: ["handover", "row", "--slug", "target-ask", ...scope] });
    const board = run({ args: ["handover", "list", "--all", ...scope] });
    expect(row.status).toBe(0);
    expect(board.status).toBe(0);
    const printed = JSON.parse(row.stdout) as Record<string, unknown>;
    const document = JSON.parse(board.stdout) as { referenceContext: unknown; rows: Record<string, unknown>[] };
    const listed = document.rows.find((one) => one["slug"] === "target-ask")!;
    expect(printed["summary"]).toBe(LONG_SUMMARY);
    // The live dependency was walked and composed: without it the target would read runnable.
    expect(printed["reason"]).toBe("waiting on live-dep");
    // The row carries the board's one `referenceContext` itself, since it is read without the board around it.
    // One row has no board to fold its pull requests over, so `prSteers` is the one board field it leaves out.
    const { referenceContext, ...fields } = printed;
    expect(Object.hasOwn(printed, "prSteers")).toBe(false);
    expect({ ...fields, summary: "" }).toEqual({ ...listed, prSteers: undefined, summary: "" });
    expect(referenceContext).toEqual(document.referenceContext);
  });

  it("prints one text line by default and adds the doc's path under --full", () => {
    const { handoverDir, home } = sandboxBoard();
    const scope = ["--dir", handoverDir, "--home", home];
    const compact = run({ args: ["handover", "row", "--slug", "target-ask", ...scope] });
    const full = run({ args: ["handover", "row", "--slug", "target-ask", "--full", ...scope] });
    expect(compact.status).toBe(0);
    expect(full.status).toBe(0);
    const head = "target-ask — NOT YET: waiting on live-dep";
    expect(compact.stdout).toBe(`${head}\n`);
    expect(full.stdout).toBe(`${head}\n  path: ${join(handoverDir, "target-ask.md")}\n`);
  });

  it("prints the same --json document with or without --full", () => {
    const { handoverDir, home } = sandboxBoard();
    const scope = ["--dir", handoverDir, "--home", home, "--json"];
    const plain = run({ args: ["handover", "row", "--slug", "target-ask", ...scope] });
    const full = run({ args: ["handover", "row", "--slug", "target-ask", "--full", ...scope] });
    expect(plain.status).toBe(0);
    expect(full.stdout).toBe(plain.stdout);
  });

  // A review's counterexample, verbatim: the walk once stopped at an archived dependency and printed RUN NOW.
  it("walks through an archived dependency to the live doc that decides the target's placement", () => {
    const home = mkdtempSync(join(tmpdir(), "handover-row-through-"));
    fixtureDirs.push(home);
    const handoverDir = join(home, "handovers");
    mkdirSync(join(handoverDir, "archive"), { recursive: true });
    writeFileSync(join(handoverDir, "a.md"), docText({ blockedBy: ["old"], slug: "a", status: "ready", summary: "a" }));
    writeFileSync(
      join(handoverDir, "archive", "old.md"),
      docText({ blockedBy: ["deeper"], slug: "old", status: "done", summary: "old" }),
    );
    writeFileSync(
      join(handoverDir, "deeper.md"),
      docText({ blockedBy: [], slug: "deeper", status: "cancelled", summary: "deeper" }),
    );
    const scope = ["--dir", handoverDir, "--home", home, "--json"];
    const row = run({ args: ["handover", "row", "--slug", "a", ...scope] });
    const board = run({ args: ["handover", "list", "--all", ...scope] });
    const printed = JSON.parse(row.stdout) as Record<string, unknown>;
    const document = JSON.parse(board.stdout) as { referenceContext: unknown; rows: Record<string, unknown>[] };
    const listed = document.rows.find((one) => one["slug"] === "a")!;
    expect([printed["section"], printed["reason"]]).toEqual([listed["section"], listed["reason"]]);
    expect(printed["reason"]).toBe("blocked by deeper (cancelled)");
    const { referenceContext, ...fields } = printed;
    expect(fields).toEqual({ ...listed, prSteers: undefined });
    expect(referenceContext).toEqual(document.referenceContext);
  });

  // The next counterexample: an archived doc named only by another archived doc is not loaded by the board.
  it("leaves out an archived doc only another archived doc names, exactly as the board does", () => {
    const home = mkdtempSync(join(tmpdir(), "handover-row-chain-"));
    fixtureDirs.push(home);
    const handoverDir = join(home, "handovers");
    mkdirSync(join(handoverDir, "archive"), { recursive: true });
    writeFileSync(
      join(handoverDir, "a.md"),
      docText({ blockedBy: ["old1"], slug: "a", status: "ready", summary: "a" }),
    );
    writeFileSync(
      join(handoverDir, "archive", "old1.md"),
      docText({ blockedBy: ["old2"], slug: "old1", status: "done", summary: "old1" }),
    );
    writeFileSync(
      join(handoverDir, "archive", "old2.md"),
      docText({ blockedBy: [], slug: "old2", status: "cancelled", summary: "old2" }),
    );
    const scope = ["--dir", handoverDir, "--home", home, "--json"];
    const printed = JSON.parse(run({ args: ["handover", "row", "--slug", "a", ...scope] }).stdout) as Record<
      string,
      unknown
    >;
    const board = JSON.parse(run({ args: ["handover", "list", "--all", ...scope] }).stdout) as {
      referenceContext: unknown;
      rows: Record<string, unknown>[];
    };
    const listed = board.rows.find((one) => one["slug"] === "a")!;
    // The row carries the board's one `referenceContext` itself, since it is read without the board around it.
    const { referenceContext, ...row } = printed;
    expect(printed["reason"]).toBe("declared ready");
    expect(row).toEqual({ ...listed, prSteers: undefined });
    expect(referenceContext).toEqual(board.referenceContext);
  });

  it("refuses an archived target with exit 3, since the board carries no row for it", () => {
    const { handoverDir, home } = sandboxBoard();
    const result = run({ args: ["handover", "row", "--slug", "filed-dep", "--dir", handoverDir, "--home", home] });
    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("handover row: filed-dep is archived (");
  });

  it("exits 1 naming the slug no readable doc carries", () => {
    const { handoverDir, home } = sandboxBoard();
    const result = run({ args: ["handover", "row", "--slug", "nowhere", "--dir", handoverDir, "--home", home] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handover row: no readable doc carries slug nowhere as nowhere.md");
  });

  it("refuses an unsafe slug as a usage error before touching a path", () => {
    const { handoverDir, home } = sandboxBoard();
    const result = run({ args: ["handover", "row", "--slug", "../escape", "--dir", handoverDir, "--home", home] });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("handover row: --slug takes one doc's slug");
  });
});
