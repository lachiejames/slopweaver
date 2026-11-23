/**
 * A stopped recipe set, seated by the tick itself: what `supervisor tick open` registers and spawns for it, what it
 * leaves alone, and the close that refuses a set with neither a seat nor a hold.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runSupervisorTick } from "../../../../../../cli/commands/supervisor/tickRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { repairAsk, repairSlugBaseOf, repairSlugOf } from "../../../../../../supervisor/stoppedRecipeSeat.js";
import { tickFile } from "../tickFixtures.js";
import { dir, fake, root, seatAndOpen, useWorkdir } from "./harness.js";
import { STOPPED, seatActs, stoppedBoard, stoppedEpisode, templateActions } from "./stoppedFixtures.js";

useWorkdir();

describe("a stopped recipe set, seated by the tick itself", () => {
  const attempt = (): string => repairSlugOf({ episodeKey: stoppedEpisode(), tickId: "handoff-9292-tick-2" });

  it("registers ONE repair row and spawns it the same tick, and the template carries both acts", async () => {
    await seatAndOpen();
    const run = fake({ reconcile: stoppedBoard(), stopped: STOPPED });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["open", "--dir", dir] })).toBe(EXIT_OK);
    const slug = attempt();
    expect(seatActs({ run })).toEqual([
      [
        "handover",
        "register",
        "--ask",
        repairAsk({ recipeIds: ["vulnfix-digest-acme-admin"], slug }),
        "--dispatch",
        "--keep-lines",
        "--slug",
        slug,
        "--priority",
        "p0",
        "--workspace",
        "self",
        "--workspace-because",
        "a stopped recipe is this Slopweaver instance's own automation, repaired in its own checkout",
        "--repo",
        "/checkout",
      ],
      ["cmux", "spawn", slug, "--model", "opus"],
    ]);
    expect(templateActions({ tick: 2 }).map(({ kind, outcome, subject }) => ({ kind, outcome, subject }))).toEqual([
      {
        kind: "state-amended",
        outcome: "completed",
        subject: { id: slug, kind: "handover", label: 'repair the stopped "vulnfix-digest-acme-admin"' },
      },
      {
        kind: "spawned",
        outcome: "completed",
        subject: { id: slug, kind: "handover", label: 'repair the stopped "vulnfix-digest-acme-admin"' },
      },
    ]);
    expect(run.out).toContain(`  stopped recipes: seated ${slug} on opus`);
  });

  it("spawns the episode's row already on the board rather than registering another", async () => {
    const onBoard = repairSlugOf({ episodeKey: stoppedEpisode(), tickId: "handoff-9292-tick-1" });
    await seatAndOpen();
    const run = fake({ reconcile: stoppedBoard({ ready: [{ id: onBoard, standing: "ready" }] }), stopped: STOPPED });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["open", "--dir", dir] })).toBe(EXIT_OK);
    expect(seatActs({ run })).toEqual([["cmux", "spawn", onBoard, "--model", "opus"]]);
  });

  it("leaves a board row unspawned on every later tick once an earlier attempt of its stop ended", async () => {
    const onBoard = repairSlugOf({ episodeKey: stoppedEpisode(), tickId: "handoff-9292-tick-2" });
    const archive = join(root, "home", "handovers", "archive");
    mkdirSync(archive, { recursive: true });
    writeFileSync(
      join(archive, `${repairSlugOf({ episodeKey: stoppedEpisode(), tickId: "handoff-9292-tick-1" })}.md`),
      "",
    );
    writeFileSync(join(root, "home", "handovers", `${onBoard}.md`), "");
    await seatAndOpen();
    const run = fake({ reconcile: stoppedBoard({ ready: [{ id: onBoard, standing: "ready" }] }), stopped: STOPPED });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["open", "--dir", dir] })).toBe(EXIT_OK);
    expect(seatActs({ run })).toEqual([]);
    expect(run.out).toContain(
      `  stopped recipes: an earlier repair of this stop ended with it still standing, so ${onBoard} is NOT ` +
        "spawned — spawn it or hold it with a reason before close",
    );
  });

  it("never respawns a board row a spawn already dispatched, whose seat ran and ended with the stop standing", async () => {
    const onBoard = repairSlugOf({ episodeKey: stoppedEpisode(), tickId: "handoff-9292-tick-1" });
    mkdirSync(join(root, "home", "handovers"), { recursive: true });
    writeFileSync(join(root, "home", "handovers", `${onBoard}.md`), "");
    mkdirSync(join(root, "home", "runs"), { recursive: true });
    writeFileSync(join(root, "home", "runs", `${onBoard}.jsonl`), "");
    await seatAndOpen();
    const run = fake({ reconcile: stoppedBoard({ ready: [{ id: onBoard, standing: "ready" }] }), stopped: STOPPED });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["open", "--dir", dir] })).toBe(EXIT_OK);
    expect(seatActs({ run })).toEqual([]);
  });

  it("registers but never auto-spawns when only an earlier attempt's run journal is left, its doc gone", async () => {
    mkdirSync(join(root, "home", "runs"), { recursive: true });
    writeFileSync(
      join(
        root,
        "home",
        "runs",
        `${repairSlugOf({ episodeKey: stoppedEpisode(), tickId: "handoff-9292-tick-1" })}.jsonl`,
      ),
      "",
    );
    await seatAndOpen();
    const run = fake({ reconcile: stoppedBoard(), stopped: STOPPED });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["open", "--dir", dir] })).toBe(EXIT_OK);
    expect(seatActs({ run }).map((argv) => argv.slice(0, 2).join(" "))).toEqual(["handover register"]);
  });

  it("never respawns a board row whose own doc is also archived, an attempt that already closed", async () => {
    const onBoard = repairSlugOf({ episodeKey: stoppedEpisode(), tickId: "handoff-9292-tick-1" });
    mkdirSync(join(root, "home", "handovers", "archive"), { recursive: true });
    writeFileSync(join(root, "home", "handovers", "archive", `${onBoard}.md`), "");
    await seatAndOpen();
    const run = fake({ reconcile: stoppedBoard({ ready: [{ id: onBoard, standing: "ready" }] }), stopped: STOPPED });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["open", "--dir", dir] })).toBe(EXIT_OK);
    expect(seatActs({ run })).toEqual([]);
  });

  it("writes nothing when cmux was unread, even with no row of the stop on the board", async () => {
    await seatAndOpen();
    const run = fake({ reconcile: stoppedBoard({ fleet: "unavailable" }), stopped: STOPPED });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["open", "--dir", dir] })).toBe(EXIT_OK);
    expect(seatActs({ run })).toEqual([]);
    expect(run.out).toContain(
      "  stopped recipes: nothing seated — with cmux unread, a seat on this stop cannot be ruled out",
    );
  });

  it("spawns a board row whose own doc is the episode's only one, a first attempt that never seated", async () => {
    const onBoard = repairSlugOf({ episodeKey: stoppedEpisode(), tickId: "handoff-9292-tick-1" });
    mkdirSync(join(root, "home", "handovers"), { recursive: true });
    writeFileSync(join(root, "home", "handovers", `${onBoard}.md`), "");
    await seatAndOpen();
    const run = fake({ reconcile: stoppedBoard({ ready: [{ id: onBoard, standing: "ready" }] }), stopped: STOPPED });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["open", "--dir", dir] })).toBe(EXIT_OK);
    expect(seatActs({ run })).toEqual([["cmux", "spawn", onBoard, "--model", "opus"]]);
  });

  it("does nothing when a live seat already holds the episode's row", async () => {
    const onBoard = repairSlugOf({ episodeKey: stoppedEpisode(), tickId: "handoff-9292-tick-1" });
    await seatAndOpen();
    const run = fake({ reconcile: stoppedBoard({ aligned: [{ row: { id: onBoard } }] }), stopped: STOPPED });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["open", "--dir", dir] })).toBe(EXIT_OK);
    expect(seatActs({ run })).toEqual([]);
    expect(templateActions({ tick: 2 })).toEqual([]);
    expect(run.out).toContain(`  stopped recipes: ${onBoard} already has a seat`);
  });

  it("registers but never auto-spawns a second attempt once an earlier one ended with the stop standing", async () => {
    const handovers = join(root, "home", "handovers");
    mkdirSync(handovers, { recursive: true });
    writeFileSync(join(handovers, `${repairSlugBaseOf({ episodeKey: stoppedEpisode() })}-handoff-9292-tick-1.md`), "");
    await seatAndOpen();
    const run = fake({ reconcile: stoppedBoard(), stopped: STOPPED });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["open", "--dir", dir] })).toBe(EXIT_OK);
    expect(seatActs({ run }).map((argv) => argv.slice(0, 2).join(" "))).toEqual(["handover register"]);
    expect(templateActions({ tick: 2 }).map(({ kind }) => kind)).toEqual(["state-amended"]);
  });

  it("counts an earlier attempt whose doc was archived on close, so it still never auto-spawns again", async () => {
    const archive = join(root, "home", "handovers", "archive");
    mkdirSync(archive, { recursive: true });
    writeFileSync(join(archive, `${repairSlugBaseOf({ episodeKey: stoppedEpisode() })}-handoff-9292-tick-1.md`), "");
    await seatAndOpen();
    const run = fake({ reconcile: stoppedBoard(), stopped: STOPPED });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["open", "--dir", dir] })).toBe(EXIT_OK);
    expect(seatActs({ run }).map((argv) => argv.slice(0, 2).join(" "))).toEqual(["handover register"]);
  });

  it("records a spawn that failed as failed, which seats nobody", async () => {
    await seatAndOpen();
    const run = fake({ reconcile: stoppedBoard(), spawnFails: true, stopped: STOPPED });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["open", "--dir", dir] })).toBe(EXIT_OK);
    expect(templateActions({ tick: 2 }).map(({ kind, outcome }) => `${String(kind)}:${String(outcome)}`)).toEqual([
      "state-amended:completed",
      "spawned:failed",
    ]);
  });

  it("refuses a close whose stopped set has neither a seat nor a hold, writing nothing", async () => {
    await seatAndOpen({ reconcile: stoppedBoard(), stopped: STOPPED });
    const run = fake({ reconcile: stoppedBoard(), stoppedHatch: false, stopped: STOPPED });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(run.diagnostics.some((line) => line.includes('the stopped set "vulnfix-digest-acme-admin"'))).toBe(true);
    expect(run.diagnostics.some((line) => line.includes("SLOPWEAVER_ALLOW_UNSEATED_STOPPED_RECIPES=1"))).toBe(true);
    expect(run.appended).toEqual([]);
  });

  it("closes a tick whose stopped set every recipe of which the chair held, with a reason", async () => {
    const hold = {
      claim: "Held on the owner's word: the digest waits for the acme-admin token rotation.",
      judgementId: "hold-vulnfix-digest",
      kind: "hold-rationale",
      subject: { id: "vulnfix-digest-acme-admin", kind: "recipe", label: "vulnfix-digest-acme-admin" },
      whyNotDerived: "operational-context",
      witness: { kind: "artifact", ref: "talk:8ef4c45d" },
    };
    await seatAndOpen({ reconcile: stoppedBoard(), stopped: STOPPED, tick: tickFile({ judgements: [hold] }) });
    const run = fake({ reconcile: stoppedBoard(), stoppedHatch: false, stopped: STOPPED });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(run.appended.map((row) => row.tickId)).toEqual(["handoff-9292-tick-1"]);
  });
});
