/**
 * `hand push`: one banner per arrival, silence once the owner knows, a snoozed step left out until it arrives again, and
 * a failed banner retried rather than retired.
 */
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandList } from "../../../../../../cli/commands/hand/list.js";
import { runHandPost } from "../../../../../../cli/commands/hand/post.js";
import { runHandPush } from "../../../../../../cli/commands/hand/push.js";
import { runHandSnooze } from "../../../../../../cli/commands/hand/snooze.js";
import { runHandWake } from "../../../../../../cli/commands/hand/wake.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { NoteCommand } from "../../../../../../hand/note/raise.js";
import { NOW } from "./fixtures.js";
import { freshHand, handHarness } from "./harness.js";

let home = "";
let out: string[] = [];
let diagnostics: string[] = [];
let commands: NoteCommand[] = [];
let looked: string[] = [];

const { deps, post } = handHarness({ state: () => ({ commands, diagnostics, home, looked, out }) });

beforeEach(() => {
  ({ commands, diagnostics, home, looked, out } = freshHand());
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("hand push", () => {
  it("sends ONE banner on the first pass and is silent on the second", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    out = [];
    commands = [];
    expect(runHandPush({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_OK);
    expect(out[0]).toBe("hand push: 1 new of 1 outstanding — sending one notification");
    const notify = commands.find((command) => command.file === "osascript")!;
    expect(notify.args.slice(4)).toEqual([
      "One step needs your hand",
      "Sign in to Google Cloud so the monitor deploy can finish",
      "The note is on screen, top right",
    ]);

    out = [];
    commands = [];
    expect(runHandPush({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_OK);
    expect(out[0]).toBe("hand push: 1 outstanding, none new — the owner already knows, so nothing is sent");
    expect(commands).toEqual([]);
  });

  it("leaves a snoozed step out until its time comes, then hears it ARRIVE again", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    runHandSnooze({ deps: deps(), rest: ["gcloud-signin", "--for", "1h", "--home", home] });
    out = [];
    expect(runHandPush({ deps: deps(), rest: ["--home", home, "--dry-run"] })).toBe(EXIT_OK);
    expect(out[0]).toBe("hand push: nothing is waiting on the owner");
    out = [];
    const lapsed = deps({ nowIso: "2026-09-19T06:01:07.803Z" });
    expect(runHandPush({ deps: lapsed, rest: ["--home", home, "--dry-run"] })).toBe(EXIT_OK);
    expect(out[0]).toBe("hand push: 1 new of 1 outstanding — sending one notification");
  });

  it("hears a step the owner was already pushed ARRIVE again when its snooze lapses with no pass in between", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    expect(runHandPush({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_OK);
    runHandSnooze({ deps: deps(), rest: ["gcloud-signin", "--for", "1h", "--home", home] });
    const lapsed = deps({ nowIso: "2026-09-19T06:01:07.803Z" });
    expect(runHandWake({ deps: lapsed, rest: ["--home", home] })).toBe(EXIT_OK);
    out = [];
    commands = [];
    expect(runHandPush({ deps: lapsed, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(out[0]).toBe("hand push: 1 new of 1 outstanding — sending one notification");
    expect(commands.filter((command) => command.file === "osascript").length).toBe(1);
  });

  it("leaves out a step whose snooze press the store could not record, rather than pushing it", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    expect(runHandPush({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_OK);
    writeFileSync(join(home, "hand-steps", "snoozes"), "not a directory\n");
    writeFileSync(join(home, "hand-steps", "dismiss", "gcloud-signin.snooze-1h"), `${NOW}\n`);
    out = [];
    commands = [];
    expect(runHandPush({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_OK);
    expect(out[0]).toBe("hand push: nothing is waiting on the owner");
    expect(commands).toEqual([]);
    expect(existsSync(join(home, "hand-steps", "dismiss", "gcloud-signin.snooze-1h"))).toBe(true);
  });

  it("holds a step out while its snooze record stands but will not read, naming the file", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    expect(runHandPush({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_OK);
    runHandSnooze({ deps: deps(), rest: ["gcloud-signin", "--for", "1h", "--home", home] });
    runHandList({ deps: deps(), rest: ["--home", home] });
    writeFileSync(join(home, "hand-steps", "snoozes", "gcloud-signin.json"), "{ torn\n");
    out = [];
    diagnostics = [];
    commands = [];
    expect(runHandPush({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_OK);
    expect(out[0]).toBe("hand push: nothing is waiting on the owner");
    expect(commands).toEqual([]);
    expect(diagnostics.some((line) => line.includes("gcloud-signin.json"))).toBe(true);
  });

  it("sends nothing and records nothing under --dry-run", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    out = [];
    commands = [];
    expect(runHandPush({ deps: deps(), rest: ["--home", home, "--dry-run"] })).toBe(EXIT_OK);
    expect(out[1]).toBe("  not sent (--dry-run)");
    expect(commands).toEqual([]);
    out = [];
    runHandPush({ deps: deps(), rest: ["--home", home, "--dry-run"] });
    expect(out[0]).toBe("hand push: 1 new of 1 outstanding — sending one notification");
  });

  it("says nothing is waiting on an install with an empty register", () => {
    expect(runHandPush({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_OK);
    expect(out[0]).toBe("hand push: nothing is waiting on the owner");
    expect(commands).toEqual([]);
  });

  it("RETRIES an arrival whose banner failed, instead of retiring it into the ledger", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    out = [];
    diagnostics = [];
    expect(runHandPush({ deps: deps({ throws: true }), rest: ["--home", home] })).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toBe(
      "hand push: the banner did not go out, so nothing was recorded — the next pass retries it",
    );
    expect(existsSync(join(home, "hand-steps", "pushed.jsonl"))).toBe(false);

    out = [];
    commands = [];
    expect(runHandPush({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_OK);
    expect(out[0]).toBe("hand push: 1 new of 1 outstanding — sending one notification");
    expect(commands.filter((command) => command.file === "osascript").length).toBe(1);
  });

  it("records a machine that has no banners at all, and exits 0 rather than erroring", async () => {
    await runHandPost({ deps: deps({ platform: "linux" }), rest: post({ tail: ["--quiet"] }) });
    out = [];
    expect(runHandPush({ deps: deps({ platform: "linux" }), rest: ["--home", home] })).toBe(EXIT_OK);
    expect(out[1]).toContain("this is linux");
  });
});
