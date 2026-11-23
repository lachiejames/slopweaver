/**
 * `hand mute`: the note's Never for this kind, read and reversed — add, list and remove a mute, a notice kind and an
 * undeclared kind refused, and a press the note left recorded before anything is read.
 */
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { muteActionOf, runHandMute } from "../../../../../../cli/commands/hand/mute.js";
import { listMutes } from "../../../../../../cli/commands/hand/muteList.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import type { NoteCommand } from "../../../../../../hand/note/raise.js";
import { MONITOR_WITNESS } from "../../../../../../hand/step.js";
import { unwrap } from "../../../../../../lib/result.js";
import { escalationHeld, recordEscalationHold } from "../../../../../../monitor/escalationHolds.js";
import { noteKeptDown } from "../../../../../../monitor/kindAnswerGate.js";
import { kindMuted } from "../../../../../../monitor/noteMutes.js";
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

describe("muteActionOf", () => {
  it("reads list, and add or remove with exactly one declared kind", () => {
    expect(muteActionOf({ positionals: ["list"] })).toEqual({ kind: "list" });
    expect(muteActionOf({ positionals: ["add", "chair-off-fable"] })).toEqual({
      kind: "add",
      monitorId: "chair-off-fable",
    });
    expect(muteActionOf({ positionals: ["remove", "chair-off-fable"] })).toEqual({
      kind: "remove",
      monitorId: "chair-off-fable",
    });
  });

  it("refuses an undeclared kind, a missing one and anything else", () => {
    expect(muteActionOf({ positionals: ["add", "nosuch"] })).toEqual({
      problem: "nosuch is no declared monitor kind — `slopweaver monitor list` names them",
    });
    expect(muteActionOf({ positionals: ["add"] })).toEqual({
      problem: "name list, or add or remove with exactly one kind",
    });
    expect(muteActionOf({ positionals: [] })).toEqual({ problem: "name list, or add or remove with exactly one kind" });
  });
});

describe("hand mute", () => {
  it("mutes a kind, lists it, and removes it — a second remove reads expected-empty", () => {
    expect(runHandMute({ deps: deps(), rest: ["add", "chair-off-fable", "--home", home] })).toBe(EXIT_OK);
    expect(out).toEqual([
      "hand mute: chair-off-fable's note will not be raised again — its cards still post; `slopweaver hand mute remove chair-off-fable` reverses it",
    ]);
    expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(true);
    out = [];
    expect(runHandMute({ deps: deps(), rest: ["list", "--home", home] })).toBe(EXIT_OK);
    expect(out).toEqual([
      `hand mute: muted: chair-off-fable since ${NOW} (set with hand mute add) — \`slopweaver hand mute remove chair-off-fable\``,
    ]);
    out = [];
    expect(runHandMute({ deps: deps(), rest: ["remove", "chair-off-fable", "--home", home] })).toBe(EXIT_OK);
    expect(out).toEqual([
      "hand mute: chair-off-fable's notes come back from the next pass that posts one; a card of it already open stays on the Queue, and `slopweaver hand show <id>` draws it",
    ]);
    expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(false);
    out = [];
    expect(runHandMute({ deps: deps(), rest: ["remove", "chair-off-fable", "--home", home] })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(out).toEqual(["hand mute: chair-off-fable was not muted"]);
  });

  it("lists as one JSON line, and fails a list over a press this run could not honour", () => {
    expect(listMutes({ deps: deps(), home, json: true, pressProblems: 0 })).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!)).toEqual({
      holds: [],
      mutes: [],
      pendingPresses: [],
      unreadable: { holds: [], mutes: [] },
    });
    expect(listMutes({ deps: deps(), home, json: false, pressProblems: 1 })).toBe(EXIT_ERROR);
  });

  it("lists an empty store in one sentence", () => {
    expect(runHandMute({ deps: deps(), rest: ["list", "--home", home] })).toBe(EXIT_OK);
    expect(out).toEqual(["hand mute: no kind is muted and no note is held until it gets worse"]);
  });

  it("refuses to mute a notice kind", () => {
    expect(runHandMute({ deps: deps(), rest: ["add", "recipe-repairing", "--home", home] })).toBe(EXIT_ERROR);
    expect(diagnostics).toEqual([
      "hand mute: recipe-repairing is a notice — it appears on no list, so its note is its only delivery and it is never muted",
    ]);
    expect(kindMuted({ home, monitorId: "recipe-repairing" })).toBe(false);
  });

  it("refuses an undeclared kind as a usage error", () => {
    expect(runHandMute({ deps: deps(), rest: ["add", "nosuch", "--home", home] })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe("hand mute: nosuch is no declared monitor kind — `slopweaver monitor list` names them");
  });

  it("records a Never press the note left before it lists, even once the card has settled", () => {
    const dismiss = join(home, "hand-steps", "dismiss");
    mkdirSync(dismiss, { recursive: true });
    writeFileSync(join(dismiss, "mon-chair-unpinned.mute-kind"), `${NOW}\n`);
    expect(runHandMute({ deps: deps(), rest: ["list", "--home", home] })).toBe(EXIT_OK);
    expect(out).toEqual([
      `hand mute: muted: chair-off-fable since ${NOW} (pressed on mon-chair-unpinned) — \`slopweaver hand mute remove chair-off-fable\``,
    ]);
  });

  it("names a hold standing until worse, and an unreadable mute record with exit 1", () => {
    unwrap(
      recordEscalationHold({
        hold: {
          base: "mon-fsev-97860",
          monitorId: "fseventsd-bloated",
          pressedIso: NOW,
          state: { kind: "pending" },
          stepId: "mon-fsev-97860",
        },
        home,
      }),
    );
    const mutes = join(home, "hand-steps", "mutes");
    mkdirSync(mutes, { recursive: true });
    writeFileSync(join(mutes, "chair-off-fable.json"), "{torn");
    expect(runHandMute({ deps: deps(), rest: ["list", "--home", home] })).toBe(EXIT_ERROR);
    expect(out).toEqual([
      "hand mute: muted (record unreadable): chair-off-fable — `slopweaver hand mute remove chair-off-fable`",
      "hand mute: held until worse: mon-fsev-97860 (fseventsd-bloated, waiting for its first reading) — `slopweaver hand show mon-fsev-97860` draws it now, `slopweaver hand mute remove mon-fsev-97860` releases it",
    ]);
    expect(diagnostics.length).toBe(1);
  });

  it("releases a hold by the subject `list` prints, a re-cut id naming the same hold, and a second release reads expected-empty", () => {
    unwrap(
      recordEscalationHold({
        hold: {
          base: "mon-fsev-97860",
          monitorId: "fseventsd-bloated",
          pressedIso: NOW,
          state: { kind: "pending" },
          stepId: "mon-fsev-97860.2",
        },
        home,
      }),
    );
    expect(escalationHeld({ base: "mon-fsev-97860", home })).toBe(true);
    expect(runHandMute({ deps: deps(), rest: ["remove", "mon-fsev-97860.2", "--home", home] })).toBe(EXIT_OK);
    expect(out).toEqual([
      "hand mute: mon-fsev-97860 is no longer held — its note comes back from the next pass that posts one, and `slopweaver hand show <id>` draws an open card now",
    ]);
    expect(escalationHeld({ base: "mon-fsev-97860", home })).toBe(false);
    out = [];
    expect(runHandMute({ deps: deps(), rest: ["remove", "mon-fsev-97860", "--home", home] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(out).toEqual(["hand mute: mon-fsev-97860 was not held until it gets worse"]);
  });

  it("names a press the mute store would not take, and discards it by the step id it was pressed on", () => {
    const dismiss = join(home, "hand-steps", "dismiss");
    mkdirSync(dismiss, { recursive: true });
    const marker = join(dismiss, "mon-chair-unpinned.mute-kind");
    writeFileSync(marker, `${NOW}\n`);
    // A regular file where the mute store's directory belongs: the press cannot be recorded, so its marker stays.
    writeFileSync(join(home, "hand-steps", "mutes"), "not a directory");
    expect(runHandMute({ deps: deps(), rest: ["list", "--home", home] })).toBe(EXIT_ERROR);
    expect(out).toEqual([
      "hand mute: pressed, not recorded: Never for this kind on mon-chair-unpinned keeps its note down — the next pass records it once the store writes, `slopweaver hand mute remove mon-chair-unpinned` discards it",
    ]);
    expect(existsSync(marker)).toBe(true);
    out = [];
    diagnostics = [];
    // The press goes, but the store it could not reach still stands broken, so whether its kind is muted cannot be
    // told: the release never says the note comes back, and exits 1 naming the store.
    expect(runHandMute({ deps: deps(), rest: ["remove", "mon-chair-unpinned", "--home", home] })).toBe(EXIT_ERROR);
    expect(existsSync(marker)).toBe(false);
    expect(out).toEqual([]);
    expect(diagnostics[0]).toContain("hand mute: mon-chair-unpinned is released, but");
    expect(diagnostics[0]).toContain(join("hand-steps", "mutes"));
  });

  it("lists a DIRECTORY at a press path, and the remove it prints takes it", () => {
    const marker = join(home, "hand-steps", "dismiss", "mon-chair-unpinned.mute-kind");
    mkdirSync(join(marker, "inside"), { recursive: true });
    expect(runHandMute({ deps: deps(), rest: ["list", "--home", home] })).toBe(EXIT_ERROR);
    expect(out).toEqual([
      "hand mute: pressed, not recorded: Never for this kind on mon-chair-unpinned keeps its note down — the next pass records it once the store writes, `slopweaver hand mute remove mon-chair-unpinned` discards it",
    ]);
    out = [];
    expect(runHandMute({ deps: deps(), rest: ["remove", "mon-chair-unpinned", "--home", home] })).toBe(EXIT_OK);
    expect(existsSync(marker)).toBe(false);
  });

  it("removes a press by the id it is listed under, however its file is named", () => {
    const marker = join(home, "hand-steps", "dismiss", "mon-chair-unpinned.bad.mute-kind");
    mkdirSync(join(marker, "inside"), { recursive: true });
    expect(runHandMute({ deps: deps(), rest: ["list", "--home", home] })).toBe(EXIT_ERROR);
    expect(out).toEqual([
      "hand mute: pressed, not recorded: Never for this kind on mon-chair-unpinned.bad keeps its note down — the next pass records it once the store writes, `slopweaver hand mute remove mon-chair-unpinned.bad` discards it",
    ]);
    out = [];
    expect(runHandMute({ deps: deps(), rest: ["remove", "mon-chair-unpinned.bad", "--home", home] })).toBe(EXIT_OK);
    expect(existsSync(marker)).toBe(false);
  });

  it("lists an upper-cased press under the lower-case id that names it, and removes it by that id", () => {
    const dismiss = join(home, "hand-steps", "dismiss");
    mkdirSync(dismiss, { recursive: true });
    const marker = join(dismiss, "MON-CHAIR-UNPINNED.MUTE-KIND");
    mkdirSync(join(marker, "inside"), { recursive: true });
    expect(runHandMute({ deps: deps(), rest: ["list", "--home", home] })).toBe(EXIT_ERROR);
    expect(out).toEqual([
      "hand mute: pressed, not recorded: Never for this kind on mon-chair-unpinned keeps its note down — the next pass records it once the store writes, `slopweaver hand mute remove mon-chair-unpinned` discards it",
    ]);
    out = [];
    expect(runHandMute({ deps: deps(), rest: ["remove", "mon-chair-unpinned", "--home", home] })).toBe(EXIT_OK);
    expect(existsSync(marker)).toBe(false);
  });

  it("reads a file named for no step as no press, keeping nothing down", () => {
    const marker = join(home, "hand-steps", "dismiss", "mon-chair-bad id.mute-kind");
    mkdirSync(join(marker, "inside"), { recursive: true });
    const chair = {
      id: "mon-chair-unpinned",
      postedBy: "monitor",
      postedIso: NOW,
      unblocks: "the chair",
      what: "Seat the chair on Fable",
      witness: MONITOR_WITNESS,
    };
    expect(noteKeptDown({ home, step: chair })).toBe(undefined);
    expect(runHandMute({ deps: deps(), rest: ["list", "--home", home] })).toBe(EXIT_OK);
    expect(diagnostics).toEqual([]);
    expect(muteActionOf({ positionals: ["remove", "mon-chair-bad id"] })).toEqual({
      problem:
        "mon-chair-bad id is no declared monitor kind nor a held subject's step id — `slopweaver hand mute list` names both",
    });
  });

  it("names a press that will not go as a failure with exit 1, never a release", () => {
    const dismiss = join(home, "hand-steps", "dismiss");
    mkdirSync(dismiss, { recursive: true });
    const marker = join(dismiss, "mon-chair-unpinned.mute-kind");
    writeFileSync(marker, `${NOW}\n`);
    // Readable and searchable, never writable: the press lists, and its unlink is refused.
    chmodSync(dismiss, 0o500);
    try {
      expect(runHandMute({ deps: deps(), rest: ["remove", "mon-chair-unpinned", "--home", home] })).toBe(EXIT_ERROR);
      expect(out).toEqual([]);
      // The release runs before any press is recorded, so the one line is its own refusal — and no mute was minted.
      expect(diagnostics.length).toBe(1);
      expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(false);
      expect(diagnostics[0]).toContain(`the press at ${marker} would not go`);
      expect(existsSync(marker)).toBe(true);
    } finally {
      chmodSync(dismiss, 0o700);
    }
  });

  it("never says a kind is not muted while an unrecorded press of it stands — names it and exits 1", () => {
    const marker = join(home, "hand-steps", "dismiss", "mon-chair-unpinned.mute-kind");
    mkdirSync(join(marker, "inside"), { recursive: true });
    expect(runHandMute({ deps: deps(), rest: ["remove", "chair-off-fable", "--home", home] })).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(diagnostics.at(-1)).toBe(
      "hand mute: Never for this kind on mon-chair-unpinned is not recorded and still keeps chair-off-fable's note down — `slopweaver hand mute remove mon-chair-unpinned` discards it",
    );
    expect(existsSync(marker)).toBe(true);
  });

  it("adds a mute, yet exits 1 naming a press of another subject that still keeps its note down", () => {
    const marker = join(home, "hand-steps", "dismiss", "mon-fsev-97860.when-worse");
    mkdirSync(join(marker, "inside"), { recursive: true });
    expect(runHandMute({ deps: deps(), rest: ["add", "chair-off-fable", "--home", home] })).toBe(EXIT_ERROR);
    expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(true);
    expect(diagnostics.at(-1)).toBe(
      "hand mute: When it gets worse on mon-fsev-97860 is not recorded and still keeps its note down — `slopweaver hand mute remove mon-fsev-97860` discards it",
    );
  });

  it("never says a released press's note comes back while the mute it was recorded as still stands", () => {
    const dismiss = join(home, "hand-steps", "dismiss");
    mkdirSync(dismiss, { recursive: true });
    const marker = join(dismiss, "mon-chair-unpinned.mute-kind");
    writeFileSync(marker, `${NOW}\n`);
    // The list records the press as a mute, then cannot unlink its marker: both now stand.
    chmodSync(dismiss, 0o500);
    try {
      expect(runHandMute({ deps: deps(), rest: ["list", "--home", home] })).toBe(EXIT_ERROR);
    } finally {
      chmodSync(dismiss, 0o700);
    }
    expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(true);
    out = [];
    diagnostics = [];
    expect(runHandMute({ deps: deps(), rest: ["remove", "mon-chair-unpinned", "--home", home] })).toBe(EXIT_ERROR);
    expect(existsSync(marker)).toBe(false);
    expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(true);
    expect(out).toEqual([]);
    expect(diagnostics).toEqual([
      "hand mute: mon-chair-unpinned is released, but its kind chair-off-fable is muted, so its note stays down — `slopweaver hand mute remove chair-off-fable` lifts that",
    ]);
  });

  it("names a mute store that will not read behind a released subject, never passing it off as a mute", () => {
    unwrap(
      recordEscalationHold({
        hold: {
          base: "mon-fsev-97860",
          monitorId: "fseventsd-bloated",
          pressedIso: NOW,
          state: { kind: "pending" },
          stepId: "mon-fsev-97860",
        },
        home,
      }),
    );
    const mutes = join(home, "hand-steps", "mutes");
    mkdirSync(mutes, { recursive: true });
    chmodSync(mutes, 0o000);
    try {
      expect(runHandMute({ deps: deps(), rest: ["remove", "mon-fsev-97860", "--home", home] })).toBe(EXIT_ERROR);
    } finally {
      chmodSync(mutes, 0o700);
    }
    expect(escalationHeld({ base: "mon-fsev-97860", home })).toBe(false);
    expect(out).toEqual([]);
    expect(diagnostics[0]).toContain(`hand mute: mon-fsev-97860 is released, but the kind answer store at ${mutes}`);
    expect(diagnostics[0]).toContain("a mute of fseventsd-bloated there may still keep its note down");
    expect(diagnostics.some((line) => line.includes("is muted, so its note stays down"))).toBe(false);
  });

  it("discards the press it names before recording any, so the remove `list` printed never mints that mute", () => {
    const marker = join(home, "hand-steps", "dismiss", "mon-chair-unpinned.mute-kind");
    mkdirSync(join(home, "hand-steps", "dismiss"), { recursive: true });
    // Left while the store would not write; it writes again now, so recording first would turn it into a mute.
    writeFileSync(marker, `${NOW}\n`);
    expect(runHandMute({ deps: deps(), rest: ["remove", "mon-chair-unpinned", "--home", home] })).toBe(EXIT_OK);
    expect(existsSync(marker)).toBe(false);
    expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(false);
    expect(out).toEqual([
      "hand mute: mon-chair-unpinned is no longer held — its note comes back from the next pass that posts one, and `slopweaver hand show <id>` draws an open card now",
    ]);
  });

  it("never says nothing is muted when a store would not list", () => {
    // A regular file where the mutes directory belongs: readdir fails with ENOTDIR, not ENOENT.
    mkdirSync(join(home, "hand-steps"), { recursive: true });
    writeFileSync(join(home, "hand-steps", "mutes"), "not a directory");
    expect(runHandMute({ deps: deps(), rest: ["list", "--home", home] })).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]).toContain("hand-steps/mutes");
  });

  it("never says nothing is muted after a press it could not read", () => {
    const dismiss = join(home, "hand-steps", "dismiss");
    mkdirSync(dismiss, { recursive: true });
    // An empty marker reads as no stamp — the same answer an unreadable one gives — so the press is refused.
    writeFileSync(join(dismiss, "mon-chair-unpinned.mute-kind"), "");
    expect(runHandMute({ deps: deps(), rest: ["list", "--home", home] })).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(diagnostics.length).toBe(1);
  });

  it("refuses to remove something that is neither a kind nor a monitor subject, and never releases a hold by add", () => {
    expect(muteActionOf({ positionals: ["remove", "../mutes/x"] })).toEqual({
      problem:
        "../mutes/x is no declared monitor kind nor a held subject's step id — `slopweaver hand mute list` names both",
    });
    expect(muteActionOf({ positionals: ["remove", "mon-a/../../mutes/x"] })).toEqual({
      problem:
        "mon-a/../../mutes/x is no declared monitor kind nor a held subject's step id — `slopweaver hand mute list` names both",
    });
    expect(muteActionOf({ positionals: ["remove", "mon-fsev-97860"] })).toEqual({
      base: "mon-fsev-97860",
      kind: "release",
    });
    expect(muteActionOf({ positionals: ["add", "mon-fsev-97860"] })).toEqual({
      problem: "mon-fsev-97860 is no declared monitor kind — `slopweaver monitor list` names them",
    });
  });
});
