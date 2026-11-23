/**
 * `hand show` over a kind-answer press it could not record: the raise clears every marker of its step, so drawing
 * that step's note would silently lose the suppression the press carries. The verb names the press with the remove
 * that discards it, exits 1 and draws nothing on that step — another step still draws.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandMute } from "../../../../../../cli/commands/hand/mute.js";
import { runHandShow } from "../../../../../../cli/commands/hand/show.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { NoteCommand } from "../../../../../../hand/note/raise.js";
import { MONITOR_WITNESS } from "../../../../../../hand/step.js";
import { appendHandRow } from "../../../../../../hand/store.js";
import { unwrap } from "../../../../../../lib/result.js";
import { NOW } from "./fixtures.js";
import { freshHand, handHarness } from "./harness.js";

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

/** A press that will not read as a regular file: a directory at the marker path. */
function unreadablePress(): string {
  const marker = join(home, "hand-steps", "dismiss", "mon-chair-unpinned.mute-kind");
  mkdirSync(join(marker, "inside"), { recursive: true });
  return marker;
}

/** How many notes this run launched. */
function launches(): number {
  return commands.filter((command) => command.file === "open").length;
}

describe("hand show, over a kind-answer press it could not record", () => {
  it("never draws over the press — names it with its remove, exits 1 and leaves the marker standing", async () => {
    await postBoth();
    const marker = unreadablePress();
    expect(runHandShow({ deps: deps(), rest: ["mon-chair-unpinned", "--home", home] })).toBe(EXIT_ERROR);
    expect(launches()).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(diagnostics.at(-1)).toBe(
      "hand show: Never for this kind on mon-chair-unpinned is not recorded and still keeps its note down — `slopweaver hand mute remove mon-chair-unpinned` discards it, then `slopweaver hand show mon-chair-unpinned` draws it",
    );
  });

  it("still draws another step's note, and exits 1 for the press it met", async () => {
    await postBoth();
    const marker = unreadablePress();
    expect(runHandShow({ deps: deps(), rest: ["mon-fsev-97860", "--home", home] })).toBe(EXIT_ERROR);
    expect(launches()).toBe(1);
    expect(existsSync(marker)).toBe(true);
  });

  it("draws the note once the remove it names has discarded the press", async () => {
    await postBoth();
    const marker = unreadablePress();
    expect(runHandMute({ deps: deps(), rest: ["remove", "mon-chair-unpinned", "--home", home] })).toBe(EXIT_OK);
    expect(existsSync(marker)).toBe(false);
    expect(runHandShow({ deps: deps(), rest: ["mon-chair-unpinned", "--home", home] })).toBe(EXIT_OK);
    expect(launches()).toBe(1);
  });
});
