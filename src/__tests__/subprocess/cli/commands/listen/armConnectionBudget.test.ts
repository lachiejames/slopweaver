/**
 * `listen arm` reports the app's Socket Mode connection budget BEFORE it prints the command, proved through
 * the SHIPPED binary.
 *
 * Why this cannot live on the unit lane: the defect being closed is one of TIMING on a real invocation —
 * the arm record was written and `listen status` named a pid while the refusal was still
 * seconds away from a dead process's stderr, so the operator learned the app was at its cap only because a
 * death-watch fired. What has to be true is that a session running `listen arm` sees the count in the same
 * breath as the command it is about to run. Only spawning the binary proves the wiring from the record on
 * disk, through the verb, to the stream a human reads.
 *
 * `HOME` and `SLOPWEAVER_HOME` are an isolated temp directory, so a passing run reads nothing from, and
 * writes nothing to, the machine's own state.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

let isolatedHome: string;

beforeEach(() => {
  isolatedHome = mkdtempSync(join(tmpdir(), "slop-armbudget-"));
});

afterEach(() => {
  rmSync(isolatedHome, { force: true, recursive: true });
});

/** Write the connections record the way the listener itself would, straight into the isolated home. */
function recordReading({ contents }: { contents: string }): void {
  mkdirSync(join(isolatedHome, "live", "listener"), { recursive: true });
  writeFileSync(join(isolatedHome, "live", "listener", "connections.json"), contents, "utf8");
}

/** Run `listen arm` against the isolated home, keeping the two streams apart. */
function arm({ extra = [] }: { extra?: readonly string[] } = {}): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const spawned = spawnSync(BIN, ["listen", "arm", "--home", isolatedHome, ...extra], {
    encoding: "utf8",
    env: { HOME: isolatedHome, PATH: process.env["PATH"]!, SLOPWEAVER_HOME: isolatedHome },
  });
  return { status: spawned.status!, stderr: spawned.stderr, stdout: spawned.stdout };
}

describe("listen arm's connection budget", () => {
  it("says the arm opens BLIND when nothing has ever connected", () => {
    const result = arm();

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("no Socket Mode connection count has ever been observed");
    expect(result.stderr).toContain("opens blind");
  });

  it("reports the last reading with its age and names it a FLOOR", () => {
    recordReading({
      contents: JSON.stringify({
        armId: "613dcc8e",
        connections: 10,
        observedAtIso: new Date(Date.now() - 300_000).toISOString(),
        pid: 15_770,
      }),
    });

    const result = arm();

    expect(result.stderr).toContain("Slack last reported 10 of 10 Socket Mode connections for this app, 5m ago");
    expect(result.stderr).toContain("(arm 613dcc8e, pid 15770)");
    expect(result.stderr).toContain("FLOOR, not a live count");
    expect(result.stderr).toContain("REFUSED at `hello`");
  });

  it("stays quiet about a refusal when the last reading saw one connection", () => {
    recordReading({
      contents: JSON.stringify({
        connections: 1,
        observedAtIso: new Date(Date.now() - 60_000).toISOString(),
        pid: 37_660,
      }),
    });

    const result = arm();

    expect(result.stderr).toContain("Slack last reported 1 of 10 Socket Mode connections");
    expect(result.stderr).not.toContain("REFUSED at `hello`");
  });

  it("NAMES a corrupt record rather than reporting it as never-observed", () => {
    recordReading({ contents: `{"connections":` });

    const result = arm();

    expect(result.stderr).toContain("could not read the last Socket Mode connection count");
    expect(result.stderr).not.toContain("has ever been observed");
  });

  it("keeps stdout the ONE shell line — a session pipes it straight into its own shell", () => {
    recordReading({
      contents: JSON.stringify({ connections: 10, observedAtIso: new Date().toISOString(), pid: 15_770 }),
    });

    const stdout = arm().stdout;

    expect(stdout.trim().split("\n").length).toBe(1);
    expect(stdout).toContain("listen");
    expect(stdout).not.toContain("Slack last reported");
  });

  it("carries the reading in --json, as null when there is none", () => {
    const empty: unknown = JSON.parse(arm({ extra: ["--json"] }).stdout);
    expect((empty as { socketConnections: unknown }).socketConnections).toBe(null);
    expect((empty as { socketConnectionsProblem: unknown }).socketConnectionsProblem).toBe(null);

    recordReading({
      contents: JSON.stringify({ connections: 4, observedAtIso: "2026-09-09T17:55:53.000Z", pid: 15_770 }),
    });
    const held: unknown = JSON.parse(arm({ extra: ["--json"] }).stdout);
    expect((held as { socketConnections: { connections: number } }).socketConnections.connections).toBe(4);
    expect((held as { socketConnectionsProblem: unknown }).socketConnectionsProblem).toBe(null);
  });

  it("tells a --json caller a corrupt record APART from one that was never written", () => {
    recordReading({ contents: `{"connections":` });

    const result = arm({ extra: ["--json"] });
    const document: unknown = JSON.parse(result.stdout);

    // Both absences answer `socketConnections: null`, so this field is the only thing keeping them apart.
    expect((document as { socketConnections: unknown }).socketConnections).toBe(null);
    expect((document as { socketConnectionsProblem: string }).socketConnectionsProblem).toContain(
      "could not read the last Socket Mode connection count",
    );
  });

  it("narrates the budget on stderr under --json too, so the human half is never dropped", () => {
    recordReading({
      contents: JSON.stringify({ connections: 10, observedAtIso: new Date().toISOString(), pid: 15_770 }),
    });

    const result = arm({ extra: ["--json"] });

    expect(result.stderr).toContain("Slack last reported 10 of 10 Socket Mode connections");
    expect(result.stdout).not.toContain("Slack last reported");
  });
});
