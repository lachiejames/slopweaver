/**
 * `hand wake`: quiet while every snooze holds, the note raised and the snooze forgotten once one lapses, and a
 * failed launch kept for the next tick.
 */
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandList } from "../../../../../../cli/commands/hand/list.js";
import { runHandPost } from "../../../../../../cli/commands/hand/post.js";
import { runHandSnooze } from "../../../../../../cli/commands/hand/snooze.js";
import { runHandWake } from "../../../../../../cli/commands/hand/wake.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { NoteCommand } from "../../../../../../hand/note/raise.js";
import { MONITOR_WITNESS } from "../../../../../../hand/step.js";
import { appendHandRow } from "../../../../../../hand/store.js";
import { unwrap } from "../../../../../../lib/result.js";
import { recordNoteMute } from "../../../../../../monitor/noteMutes.js";
import { NOW } from "./fixtures.js";
import { freshHand, handHarness } from "./harness.js";

let home = "";
let out: string[] = [];
let diagnostics: string[] = [];
let commands: NoteCommand[] = [];
let looked: string[] = [];

const { deps, post, postAs } = handHarness({ state: () => ({ commands, diagnostics, home, looked, out }) });

beforeEach(() => {
  ({ commands, diagnostics, home, looked, out } = freshHand());
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("hand wake", () => {
  it("is quiet, exit 3, while every snooze still holds", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    runHandSnooze({ deps: deps(), rest: ["gcloud-signin", "--for", "1h", "--home", home] });
    out = [];
    commands = [];
    expect(runHandWake({ deps: deps({ nowIso: "2026-09-19T06:00:00.000Z" }), rest: ["--home", home] })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(out).toEqual(["hand wake: no snooze has lapsed (1 still snoozed)"]);
    expect(commands).toEqual([]);
  });

  it("exits 1, never a quiet 3, after meeting a kind-answer press it could not read", () => {
    const marker = join(home, "hand-steps", "dismiss", "mon-chair-unpinned.mute-kind");
    mkdirSync(join(marker, "inside"), { recursive: true });
    expect(runHandWake({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_ERROR);
    expect(diagnostics.some((line) => line.includes("the press would not read"))).toBe(true);
    expect(existsSync(marker)).toBe(true);
  });

  it("exits 1, never a quiet 3, while a snooze record will not read", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    runHandSnooze({ deps: deps(), rest: ["gcloud-signin", "--for", "1h", "--home", home] });
    runHandList({ deps: deps(), rest: ["--home", home] });
    writeFileSync(join(home, "hand-steps", "snoozes", "gcloud-signin.json"), "{ torn\n");
    diagnostics = [];
    expect(runHandWake({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_ERROR);
    expect(diagnostics.some((line) => line.includes("gcloud-signin.json"))).toBe(true);
  });

  it("raises the note once the snooze lapses, and forgets the snooze", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    runHandSnooze({ deps: deps(), rest: ["gcloud-signin", "--for", "1h", "--home", home] });
    const later = deps({ nowIso: "2026-09-19T06:01:07.803Z" });
    out = [];
    commands = [];
    expect(runHandWake({ deps: later, rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!)).toEqual({ keptDown: [], sleeping: [], woken: ["gcloud-signin"] });
    expect(commands.map((command) => command.file)).toEqual(["open"]);
    out = [];
    runHandList({ deps: later, rest: ["--home", home, "--json"] });
    expect(JSON.parse(out[0]!).snoozedUntil).toBeUndefined();
    out = [];
    expect(runHandWake({ deps: later, rest: ["--home", home] })).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("keeps a lapsed snooze's note down when the owner muted its kind meanwhile, and forgets the snooze", async () => {
    const id = "mon-chair-unpinned";
    const step = {
      id,
      postedBy: "monitor",
      postedIso: NOW,
      unblocks: "the chair",
      url: "http://localhost:3000",
      what: "Seat the chair on Fable — it booted on another model",
      witness: MONITOR_WITNESS,
    };
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step } }));
    runHandSnooze({ deps: deps(), rest: [id, "--for", "1h", "--home", home] });
    unwrap(recordNoteMute({ home, mute: { from: { kind: "command" }, monitorId: "chair-off-fable", mutedIso: NOW } }));
    const later = deps({ nowIso: "2026-09-19T06:01:07.803Z" });
    out = [];
    commands = [];
    expect(runHandWake({ deps: later, rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!)).toEqual({ keptDown: [id], sleeping: [], woken: [] });
    expect(commands).toEqual([]);
    out = [];
    expect(runHandWake({ deps: later, rest: ["--home", home] })).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("exits 1, naming the record, when a kept-down step's spent snooze will not go", async () => {
    const id = "mon-chair-unpinned";
    const step = {
      id,
      postedBy: "monitor",
      postedIso: NOW,
      unblocks: "the chair",
      url: "http://localhost:3000",
      what: "Seat the chair on Fable — it booted on another model",
      witness: MONITOR_WITNESS,
    };
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step } }));
    runHandSnooze({ deps: deps(), rest: [id, "--for", "1h", "--home", home] });
    unwrap(recordNoteMute({ home, mute: { from: { kind: "command" }, monitorId: "chair-off-fable", mutedIso: NOW } }));
    const snoozes = join(home, "hand-steps", "snoozes");
    // Readable and searchable, never writable: the snooze reads as lapsed, and its unlink is refused.
    chmodSync(snoozes, 0o500);
    try {
      diagnostics = [];
      commands = [];
      const later = deps({ nowIso: "2026-09-19T06:01:07.803Z" });
      expect(runHandWake({ deps: later, rest: ["--home", home, "--json"] })).toBe(EXIT_ERROR);
      expect(diagnostics.some((line) => line.includes(snoozes))).toBe(true);
      expect(commands).toEqual([]);
    } finally {
      chmodSync(snoozes, 0o700);
    }
  });

  it("keeps a lapsed snooze whose launch fails, so the next tick retries it", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    runHandSnooze({ deps: deps(), rest: ["gcloud-signin", "--for", "1h", "--home", home] });
    const lapsedIso = "2026-09-19T06:01:07.803Z";
    expect(runHandWake({ deps: deps({ nowIso: lapsedIso, throws: true }), rest: ["--home", home] })).toBe(EXIT_ERROR);
    out = [];
    expect(runHandWake({ deps: deps({ nowIso: lapsedIso }), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!)).toEqual({ keptDown: [], sleeping: [], woken: ["gcloud-signin"] });
  });

  it("raises a lapsed snooze's note while another step's note is up, stacked in front of it", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    runHandSnooze({ deps: deps(), rest: ["gcloud-signin", "--for", "1h", "--home", home] });
    const lapsedIso = "2026-09-19T06:01:07.803Z";
    const later = deps({ nowIso: lapsedIso });
    // Another step's note, just raised and still inside its startup window.
    expect(await runHandPost({ deps: later, rest: postAs({ id: "iso-reply" }) })).toBe(EXIT_OK);
    out = [];
    commands = [];
    expect(runHandWake({ deps: later, rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!)).toEqual({ keptDown: [], sleeping: [], woken: ["gcloud-signin"] });
    expect(commands.map((command) => command.file)).toEqual(["open"]);
  });
});
