/**
 * `supervisor tick close` end to end over a real temp directory, the first half: the close that commits, and every
 * gate that refuses one before it writes anything. The seams are the plain functions in `harness.ts`, and the next
 * prompt is the LAST thing on stdout.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runSupervisorTick } from "../../../../../../cli/commands/supervisor/tickRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { MAX_RENDERED_PROMPT_WORDS, wordCount } from "../../../../../../supervisor/sweepPrompt.js";
import { shiftOverflowPath } from "../../../../../../supervisor/sweepPromptOverflow.js";
import type { UnreadWord } from "../../../../../../talk/unreadWords.js";
import { NOW, PARKED_STEER, RECONCILE, TRIPPED_FLEET, tickFile } from "../tickFixtures.js";
import { dir, fake, recentBlocks, root, seatAndOpen, useWorkdir } from "./harness.js";
import { stoppedBoard } from "./stoppedFixtures.js";

useWorkdir();

describe("supervisor tick close", () => {
  it("refuses a tick whose shift words say nothing is seatable over a board of open rows, writing nothing", async () => {
    const board = stoppedBoard({
      held: [
        { id: "land-acme-1", standing: "blocked" },
        { id: "land-acme-2", standing: "blocked" },
      ],
      rankedCount: 2,
      repolessRows: ["land-acme-1", "land-acme-2"],
      trunkMovedRows: [],
    });
    await seatAndOpen({
      reconcile: board,
      tick: tickFile({ shift: "No fleet seat live because nothing is seatable" }),
    });
    const run = fake({ reconcile: board });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(
      run.diagnostics.some((line) =>
        line.includes("this tick says there is no work while the reconciliation it read holds 2 open: 0 ready, 2 held"),
      ),
    ).toBe(true);
    expect(run.diagnostics.some((line) => line.includes('shift: "nothing is seatable"'))).toBe(true);
    expect([run.appended, run.published]).toEqual([[], []]);
  });

  it("commits the form, the page and the tick row, and prints the next prompt LAST", async () => {
    await seatAndOpen();
    const run = fake();

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(recentBlocks()).toBe(1);
    expect(run.published).toEqual(["<p>the page</p>"]);
    expect(run.appended.map((row) => row.tickId)).toEqual(["handoff-9292-tick-1"]);
    expect(run.out).toHaveLength(1);
    expect(run.out[0]).toContain("/checkout/skills/supervisor/reference/sweep-contract.md");
    // The page is rendered from the refreshed list the tick staged — what the fake child printed, nothing.
    expect(run.renderedLists).toEqual([readFileSync(join(dir, "tick-1", "run.json"), "utf8")]);
    expect(run.renders[0]).toContain("--nothing-stale");
    expect(JSON.parse(readFileSync(join(dir, "tick-1", "close-state.json"), "utf8")).done).toEqual([
      "form-committed",
      "snapshots-resolved",
      "page-published",
      "tick-recorded",
    ]);
  });

  it("closes over a shift state past its budget, keeping it whole under the handoff and printing a prompt under the cap", async () => {
    const shift = Array.from({ length: 70 }, (_, at) => `Item ${String(at)} is still in flight on its seat now.`).join(
      " ",
    );
    await seatAndOpen({ tick: tickFile({ shift }) });
    const run = fake();

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    const kept = shiftOverflowPath({ home: join(root, "home"), scope: "handoff-9292", shiftState: shift });
    expect(readFileSync(kept, "utf8")).toBe(shift);
    expect(run.out).toHaveLength(1);
    expect(run.out[0]).toContain(`the whole shift state is ${kept}; read it beside the contract this tick]`);
    expect(wordCount({ text: run.out[0]! }) <= MAX_RENDERED_PROMPT_WORDS).toBe(true);
    expect(run.diagnostics.some((line) => line.includes(`words are only in ${kept}`))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "tick-1", "close-state.json"), "utf8")).done).toEqual([
      "form-committed",
      "snapshots-resolved",
      "page-published",
      "tick-recorded",
    ]);
  });

  it("refuses a fifth headline sentence and writes nothing", async () => {
    const sentences = ["One is here.", "Two is here.", "Three is here.", "Four is here.", "Five is here."];
    await seatAndOpen({ tick: tickFile({ headline: { sentences } }) });
    const run = fake();

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(run.diagnostics.join("\n")).toContain("headline.sentences: has 5 sentences; at most 4 are allowed");
    expect(recentBlocks()).toBe(0);
    expect(run.renders).toEqual([]);
    expect(run.published).toEqual([]);
    expect(run.appended).toEqual([]);
    expect(existsSync(join(dir, "tick-1", "close-state.json"))).toBe(false);
  });

  it("refuses a close while a call word of the owner's is unread, writing nothing", async () => {
    await seatAndOpen();
    const run = fake({ voiceNeverMarked: true });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(run.diagnostics.some((line) => line.includes("the tick record gates"))).toBe(true);
    expect(recentBlocks()).toBe(0);
    expect(run.published).toEqual([]);
    expect(run.appended).toEqual([]);
  });

  it("refuses a close while a steer the owner spoke over a Queue card before the tick started has no action, writing nothing", async () => {
    await seatAndOpen();
    const run = fake({
      steers: [
        {
          cardKey: "ask:the-card",
          heard: "ship it tonight",
          registeredAtIso: "2026-01-01T00:00:00.000Z",
          relaySlug: "talk-a00000390000",
          turnId: "a0000039-0000-4000-8000-000000000042",
          verdict: { kind: "reverted", passFinalisedIso: "2026-01-01T00:05:00.000Z", reason: "missed-pass" },
        },
      ],
    });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(run.diagnostics.some((line) => line.includes("puts each back on the owner's Queue as Not picked up"))).toBe(
      true,
    );
    expect(run.diagnostics.some((line) => line.includes("talk:a0000039-0000-4000-8000-000000000042"))).toBe(true);
    expect(recentBlocks()).toBe(0);
    expect(run.published).toEqual([]);
    expect(run.appended).toEqual([]);
  });

  it("closes over a stretch the owner is still speaking, naming it after the record, and refuses it final past their floor", async () => {
    await seatAndOpen();
    const growing: UnreadWord = {
      atIso: NOW,
      callId: "a0000053-0000-4000-8000-000000000056",
      cut: false,
      final: false,
      growingSinceRead: true,
      latestAtIso: NOW,
      nextRelay: undefined,
      pointer: "talk-call:a0000053-0000-4000-8000-000000000056#turn_000000000000000000003",
      revisions: [],
      segmentId: "turn_000000000000000000003",
      text: "it kind of seems like it's reading it live",
    };
    // Two minutes before the close: the owner's floor has passed, so the finished stretch is the chair's to have read.
    const twoMinutesBefore = "2026-09-27T00:58:00.000Z";
    const finished = fake({
      voiceWords: [
        { ...growing, atIso: twoMinutesBefore, final: true, growingSinceRead: false, latestAtIso: twoMinutesBefore },
      ],
    });

    expect(await runSupervisorTick({ deps: finished.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(finished.appended).toEqual([]);

    const run = fake({ voiceWords: [growing] });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(run.appended.map((row) => row.tickId)).toEqual(["handoff-9292-tick-1"]);
    expect(run.diagnostics.slice(-3)).toEqual([
      "supervisor tick close: 1 stretch(es) of the owner's speech are still being spoken, or inside the two-minute quiet " +
        "floor, and do not refuse this tick — each stays unread, and refuses a later tick once the floor has passed " +
        "and it is final, its call ends, or it stops growing:",
      `supervisor tick close:   ${NOW} talk-call:a0000053-0000-4000-8000-000000000056#turn_000000000000000000003 ` +
        `"it kind of seems like it's reading it live"`,
      "supervisor tick close: chair cadence: not judged, so it is UNMEASURED — this fixture exercises the close",
    ]);
  });

  it("refuses a close that read a TRIPPED fleet health verdict and posted nothing, writing nothing", async () => {
    await seatAndOpen();
    const run = fake({ fleet: TRIPPED_FLEET });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(
      run.diagnostics.some((line) =>
        line.includes("this tick read a TRIPPED fleet health verdict and its floating note is not up"),
      ),
    ).toBe(true);
    expect(run.diagnostics.some((line) => line.includes("SLOPWEAVER_ALLOW_UNESCALATED_FLEET_HEALTH=1"))).toBe(true);
    expect(run.diagnostics.some((line) => line.includes("mon-health-deaths-0a1b2c"))).toBe(true);
    expect(recentBlocks()).toBe(0);
    expect(run.published).toEqual([]);
    expect(run.appended).toEqual([]);
  });

  it("refuses a close that read a broken automation's finding with nobody on it, writing nothing", async () => {
    const notion = "recipe-failing-resync-corpus-notion-2026-10-12t13-00-00.000z-a1";
    const board = JSON.stringify({
      ...(JSON.parse(RECONCILE) as Record<string, unknown>),
      duplicateRecipeFailures: [],
      fleet: "observed",
      held: [{ groomed: true, id: notion, kind: "ask", priority: "p1", ready: false, standing: "blocked" }],
      misaligned: [],
      ready: [],
      repolessRows: [notion],
      unprioritised: [],
    });
    await seatAndOpen({ reconcile: board });
    const run = fake({ recipeHatch: false, reconcile: board });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(run.diagnostics.some((line) => line.includes(`slopweaver handover set-repo ${notion} --repo`))).toBe(true);
    expect(run.diagnostics.some((line) => line.includes("SLOPWEAVER_ALLOW_UNSEATED_RECIPE_FAILURE=1"))).toBe(true);
    expect(recentBlocks()).toBe(0);
    expect(run.published).toEqual([]);
    expect(run.appended).toEqual([]);
  });

  it("closes past a tripped verdict when its hatch is open", async () => {
    await seatAndOpen();
    const run = fake({ fleet: TRIPPED_FLEET, fleetHatch: true });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(run.appended.length).toBe(1);
  });

  it("refuses a close that read an explicitly steered row at risk with its note down, writing nothing", async () => {
    await seatAndOpen();
    const run = fake({ steer: PARKED_STEER });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(
      run.diagnostics.some((line) =>
        line.includes(
          "this tick read a deliverable the owner explicitly steered at risk and its floating note is not up — " +
            "its seat closed until 2026-10-22T04:50:00Z, so nobody is working it",
        ),
      ),
    ).toBe(true);
    expect(run.diagnostics.some((line) => line.includes("SLOPWEAVER_ALLOW_UNESCALATED_STEER_RISK=1"))).toBe(true);
    expect(run.diagnostics.some((line) => line.includes("mon-steer-sup-4293-1a2b3c"))).toBe(true);
    expect(recentBlocks()).toBe(0);
    expect(run.published).toEqual([]);
    expect(run.appended).toEqual([]);
  });

  it("closes past a steered row at risk when its hatch is open", async () => {
    await seatAndOpen();
    const run = fake({ steer: PARKED_STEER, steerHatch: true });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(run.appended.length).toBe(1);
  });
});
