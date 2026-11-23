/**
 * `hand snooze`: the note closed until a time the owner chose with the step left open, and the store failures and
 * arguments it refuses.
 */
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandList } from "../../../../../../cli/commands/hand/list.js";
import { runHandPost } from "../../../../../../cli/commands/hand/post.js";
import { runHandSnooze } from "../../../../../../cli/commands/hand/snooze.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import type { NoteCommand } from "../../../../../../hand/note/raise.js";
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

describe("hand snooze", () => {
  it("refuses out loud when the snooze store will not write, leaving the note UP rather than down with no wake time", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    writeFileSync(join(home, "hand-steps", "snoozes"), "not a directory\n");
    expect(runHandSnooze({ deps: deps(), rest: ["gcloud-signin", "--for", "1h", "--home", home] })).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain("the snooze store at");
    expect(existsSync(join(home, "hand-steps", "dismiss", "gcloud-signin.snooze-1h"))).toBe(false);
  });

  it("records no snooze when the push ledger will not take its departure, so no wake can land in a stale ledger", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    writeFileSync(join(home, "hand-steps", "pushed.jsonl"), "not json\n");
    expect(runHandSnooze({ deps: deps(), rest: ["gcloud-signin", "--for", "1h", "--home", home] })).toBe(EXIT_ERROR);
    expect(existsSync(join(home, "hand-steps", "snoozes", "gcloud-signin.json"))).toBe(false);
    expect(existsSync(join(home, "hand-steps", "dismiss", "gcloud-signin.snooze-1h"))).toBe(false);
  });

  it("closes the window until a time the owner chose and leaves the step OPEN, marked snoozed on the list", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    out = [];
    expect(runHandSnooze({ deps: deps(), rest: ["gcloud-signin", "--for", "1h", "--home", home] })).toBe(EXIT_OK);
    expect(out).toEqual(["hand snooze: gcloud-signin snoozed until Sat 16:01 — still open, the note comes back then"]);
    expect(existsSync(join(home, "hand-steps", "dismiss", "gcloud-signin.snooze-1h"))).toBe(true);
    out = [];
    runHandList({ deps: deps(), rest: ["--home", home] });
    expect(out[0]).toBe("gcloud-signin  Sign in to Google Cloud so the monitor deploy can finish");
    expect(out[3]).toBe("    snoozed until Sat 16:01");
    out = [];
    runHandList({ deps: deps(), rest: ["--home", home, "--json"] });
    expect(JSON.parse(out[0]!).snoozedUntil).toBe("2026-09-19T06:01:07.803Z");
  });

  it("draws nothing on an identical re-post while the snooze holds, and keeps the snooze", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    runHandSnooze({ deps: deps(), rest: ["gcloud-signin", "--for", "1h", "--home", home] });
    runHandList({ deps: deps(), rest: ["--home", home] });
    commands = [];
    out = [];
    expect(await runHandPost({ deps: deps(), rest: post() })).toBe(EXIT_OK);
    expect(out.some((line) => line.includes("snoozed until Sat 16:01 — its note comes back then"))).toBe(true);
    expect(commands).toEqual([]);
    expect(existsSync(join(home, "hand-steps", "snoozes", "gcloud-signin.json"))).toBe(true);
  });

  it("keeps the owner's LATEST press when an older one a store failure kept is read beside it", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    expect(runHandSnooze({ deps: deps(), rest: ["gcloud-signin", "--for", "1h", "--home", home] })).toBe(EXIT_OK);
    writeFileSync(join(home, "hand-steps", "dismiss", "gcloud-signin.snooze-tomorrow"), "2026-09-19T04:01:07.803Z\n");
    out = [];
    runHandList({ deps: deps(), rest: ["--home", home, "--json"] });
    expect(JSON.parse(out[0]!).snoozedUntil).toBe("2026-09-19T06:01:07.803Z");
    expect(existsSync(join(home, "hand-steps", "dismiss", "gcloud-signin.snooze-tomorrow"))).toBe(false);
    expect(existsSync(join(home, "hand-steps", "dismiss", "gcloud-signin.snooze-1h"))).toBe(false);
  });

  it("prints the snooze as one JSON line, settling nothing", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    out = [];
    expect(
      runHandSnooze({ deps: deps(), rest: ["gcloud-signin", "--for", "tomorrow", "--home", home, "--json"] }),
    ).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!)).toEqual({
      choice: "tomorrow",
      id: "gcloud-signin",
      settled: false,
      untilIso: "2026-09-19T23:00:00.000Z",
    });
  });

  it("refuses a choice that is not one of the band's, and a missing id, as usage", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    expect(runHandSnooze({ deps: deps(), rest: ["gcloud-signin", "--for", "forever", "--home", home] })).toBe(
      EXIT_USAGE,
    );
    expect(diagnostics[0]).toBe("hand snooze: --for must be one of 1h, 3h, tomorrow");
    diagnostics = [];
    expect(runHandSnooze({ deps: deps(), rest: ["--for", "1h", "--home", home] })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe("hand snooze: name exactly one step id");
  });

  it("refuses an id nothing open carries", () => {
    expect(runHandSnooze({ deps: deps(), rest: ["nope", "--for", "1h", "--home", home] })).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain("no open hand step carries the id nope");
  });
});
