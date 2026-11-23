/**
 * `hand push` with a kind the owner muted among the arrivals: the note's one slot goes to the first arrival whose
 * note is not kept down, so a muted kind never keeps another kind's note off the owner's screen.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandPush } from "../../../../../../cli/commands/hand/push.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { NoteCommand } from "../../../../../../hand/note/raise.js";
import { MONITOR_WITNESS } from "../../../../../../hand/step.js";
import { appendHandRow } from "../../../../../../hand/store.js";
import { unwrap } from "../../../../../../lib/result.js";
import { recordNoteMute } from "../../../../../../monitor/noteMutes.js";
import { NOW } from "./fixtures.js";
import { freshHand, handHarness, tokenOf } from "./harness.js";

let home = "";
let out: string[] = [];
let diagnostics: string[] = [];
let commands: NoteCommand[] = [];
let looked: string[] = [];

const { deps } = handHarness({ state: () => ({ commands, diagnostics, home, looked, out }) });

beforeEach(() => {
  ({ commands, diagnostics, home, looked, out } = freshHand());
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Post the two monitor cards, the chair's first. */
async function postBoth(): Promise<void> {
  const card = { postedBy: "monitor", postedIso: NOW, url: "http://localhost:3000", witness: MONITOR_WITNESS };
  const chair = {
    ...card,
    id: "mon-chair-unpinned",
    unblocks: "the chair",
    what: "Seat the chair on Fable — it booted on another model",
  };
  const fsev = {
    ...card,
    id: "mon-fsev-97860",
    unblocks: "the disk",
    what: "Restart fseventsd — its footprint is past the line",
  };
  unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: chair } }));
  unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: fsev } }));
}

/** The step whose note each launch drew, read off the cascade slot its raise reserved. */
function drawnIds(): readonly string[] {
  return commands
    .filter((command) => command.file === "open")
    .map((command) => {
      const slot = readFileSync(join(home, "hand-steps", "live", `${tokenOf({ command })}.slot`), "utf8");
      return slot.split(" ")[0]!;
    });
}

describe("hand push, with a kind the owner muted among the arrivals", () => {
  it("still pushes the arrival, and exits 1, after meeting a kind-answer press it could not read", async () => {
    await postBoth();
    mkdirSync(join(home, "hand-steps", "dismiss", "mon-chair-unpinned.mute-kind", "inside"), { recursive: true });
    expect(runHandPush({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_ERROR);
    expect(diagnostics.some((line) => line.includes("the press would not read"))).toBe(true);
    // The unreadable press keeps the chair's note down, so the slot goes to the next arrival.
    expect(drawnIds()).toEqual(["mon-fsev-97860"]);
  });

  it("exits 1, naming the store, when the mute store will not list — never pushes as if nothing were muted", async () => {
    await postBoth();
    // A regular file where the mutes directory belongs: every lookup under it throws ENOTDIR.
    writeFileSync(join(home, "hand-steps", "mutes"), "not a directory");
    expect(runHandPush({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_ERROR);
    expect(diagnostics.some((line) => line.includes(join("hand-steps", "mutes")))).toBe(true);
  });

  it("draws the first arrival's note when nothing is kept down — the chair's", async () => {
    await postBoth();
    expect(runHandPush({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_OK);
    expect(drawnIds()).toEqual(["mon-chair-unpinned"]);
  });

  it("gives the note to the next arrival when the first one's kind is muted", async () => {
    await postBoth();
    unwrap(recordNoteMute({ home, mute: { from: { kind: "command" }, monitorId: "chair-off-fable", mutedIso: NOW } }));
    expect(runHandPush({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_OK);
    expect(drawnIds()).toEqual(["mon-fsev-97860"]);
  });
});
