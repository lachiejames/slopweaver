/**
 * `supervisor tick seat|open` end to end over a real temp directory: the seat file it writes once, and the next tick
 * it opens. The seams are the plain functions in `harness.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runSupervisorTick } from "../../../../../../cli/commands/supervisor/tickRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { RECONCILE } from "../tickFixtures.js";
import { dir, fake, seatAndOpen, useWorkdir } from "./harness.js";

useWorkdir();

describe("supervisor tick seat", () => {
  it("writes the seat once, taking the handoff from the directory, and refuses a second without --replace", async () => {
    const rest = [
      "seat",
      "--dir",
      dir,
      "--workspace",
      "workspace:93",
      "--model",
      "fable",
      "--pinned-at",
      "2026-09-23T14:36:00Z",
      "--loop-session-key",
      "k",
    ];
    expect(await runSupervisorTick({ deps: fake().deps, rest })).toBe(EXIT_OK);
    const second = fake();

    expect(await runSupervisorTick({ deps: second.deps, rest })).toBe(EXIT_ERROR);
    expect(JSON.parse(readFileSync(join(dir, "seat.json"), "utf8")).handoff).toBe("handoff-9292");
    expect(second.diagnostics[0]).toContain("already exists — pass --replace");
  });

  it("refuses a subaction it does not know, as a usage error", async () => {
    expect(await runSupervisorTick({ deps: fake().deps, rest: ["draft", "--dir", dir] })).toBe(EXIT_USAGE);
  });
});

describe("supervisor tick open", () => {
  it("takes the next tick, digests it, and writes the template the chair fills", async () => {
    await seatAndOpen();
    const run = fake();

    expect(await runSupervisorTick({ deps: run.deps, rest: ["open", "--dir", dir] })).toBe(EXIT_OK);
    expect(existsSync(join(dir, "tick-2", "tick.json"))).toBe(true);
    expect(readFileSync(join(dir, "tick-2", "digest.txt"), "utf8")).toContain("reconcile: Aligned on the rewrite.\n");
    expect(run.out.at(-1)).toBe(
      `fill ${join(dir, "tick-2", "tick.json")}, then: slopweaver supervisor tick close --dir ${dir}`,
    );
  });

  it("prints every reading on the seat's first tick, then folds what tick 1 already said behind its file", async () => {
    await seatAndOpen();
    const first = readFileSync(join(dir, "tick-1", "digest.txt"), "utf8")
      .trimEnd()
      .split("\n");
    const run = fake({ reconcile: RECONCILE.replace("Aligned on the rewrite.", "Misaligned on the rewrite.") });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["open", "--dir", dir] })).toBe(EXIT_OK);
    const printed = run.out.map((line) => line.trim());
    const fold = printed.findIndex((line) => line.startsWith("unchanged since tick 1: "));

    expect(first).toContain("reconcile: Aligned on the rewrite.");
    expect(printed).not.toContain("reconcile: Aligned on the rewrite.");
    const head = printed.findIndex((line) => line.startsWith("changed since tick 1 — "));
    const changed = printed.slice(head + 1, printed.indexOf("still standing since tick 1, act on these too:"));

    expect(printed[1]).toMatch(/^queue leader: /u);
    expect(printed[head]).toBe(
      `changed since tick 1 — ${String(changed.length)} of ${String(first.length)} line(s), act on these:`,
    );
    // A NOT READ line quotes its capture path cut to a width, and under a short temp root (CI's) the cut falls past
    // `tick-<n>`, so that line moves with the tick there and not here. Every OTHER changed line is the reconcile one.
    expect(changed.filter((line) => !line.includes(dir))).toEqual(["reconcile: Misaligned on the rewrite."]);
    expect(printed[fold]).toContain(`every line: ${join(dir, "tick-2", "digest.txt")}`);
    expect(fold).toBeGreaterThan(head + 1);
  });

  it("drives a landing repository's bumps itself when the home stores no drive row for it", async () => {
    const seatArgs = ["--workspace", "workspace:93", "--model", "fable", "--pinned-at", "2026-09-23T14:36:00Z"];
    const seated = ["seat", "--dir", dir, ...seatArgs, "--loop-session-key", "k", "--landing-repos", "acme/widgets"];
    expect(await runSupervisorTick({ deps: fake().deps, rest: seated })).toBe(EXIT_OK);
    const run = fake();

    expect(await runSupervisorTick({ deps: run.deps, rest: ["open", "--dir", dir] })).toBe(EXIT_OK);
    expect(run.children.filter((argv) => argv[1] === "bump-drive")).toEqual([
      ["github", "bump-drive", "--repo", "acme/widgets", "--json"],
    ]);
    expect(run.out).toContain("  bump-drive acme/widgets: driven by this tick — no bump-drive row is stored for it");
    expect(run.out).toContain("  bump-drive-acme-widgets: captured as text, not JSON");
  });

  it("says loudly, under its header and on stderr, that close-done's JSON fell back to text", async () => {
    await seatAndOpen();
    const run = fake({ closeDone: 'steer-at-risk  FIRING over 1\n{"counts":{},"outcomes":[]}\n' });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["open", "--dir", dir] })).toBe(EXIT_OK);
    const loud = "close-done.json is NOT one JSON document, so the digest reads it as text — ";
    expect(run.out[0]).toMatch(/^supervisor tick open: tick 2 — /u);
    expect(run.out[1]!.startsWith(`  FELL BACK TO TEXT: ${loud}`)).toBe(true);
    expect(run.out.filter((line) => line.includes("FELL BACK TO TEXT")).length).toBe(1);
    expect(run.diagnostics.filter((line) => line.startsWith(`supervisor tick open: ${loud}`)).length).toBe(1);
  });

  it("says nothing of a fallback when close-done printed its one document", async () => {
    await seatAndOpen();
    const run = fake({ closeDone: '{"counts":{},"outcomes":[]}\n' });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["open", "--dir", dir] })).toBe(EXIT_OK);
    expect(run.out.filter((line) => line.includes("FELL BACK TO TEXT"))).toEqual([]);
  });

  it("refuses to open in a directory with no seat", async () => {
    const run = fake();

    expect(await runSupervisorTick({ deps: run.deps, rest: ["open", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(run.diagnostics.join("\n")).toContain("no seat file");
  });
});
