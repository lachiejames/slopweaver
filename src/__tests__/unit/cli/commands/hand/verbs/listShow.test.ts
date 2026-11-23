/**
 * `hand list` and `hand show`: the open steps in register or ranked order, each with its tier, and one step's note
 * raised again by id.
 */
import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandList } from "../../../../../../cli/commands/hand/list.js";
import { runHandPost } from "../../../../../../cli/commands/hand/post.js";
import { runHandShow } from "../../../../../../cli/commands/hand/show.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { NoteCommand } from "../../../../../../hand/note/raise.js";
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

describe("hand list, show and dismiss", () => {
  it("lists the open step, oldest first, with its settling command", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    out = [];
    expect(runHandList({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_OK);
    expect(out[0]).toBe("gcloud-signin  Sign in to Google Cloud so the monitor deploy can finish");
    expect(out[2]).toBe("    settles with slopweaver hand done gcloud-signin");
  });

  it("re-raises one open step by id", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    commands = [];
    expect(runHandShow({ deps: deps(), rest: ["gcloud-signin", "--home", home] })).toBe(EXIT_OK);
    expect(commands.length).toBe(1);
  });

  it("refuses to show an id nothing open carries", () => {
    expect(runHandShow({ deps: deps(), rest: ["never-posted", "--home", home] })).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain("no open hand step carries the id never-posted");
  });

  it("--ranked --json leads with the work blocker, ends on the check-in, and carries each row's tier", async () => {
    await runHandPost({ deps: deps(), rest: postAs({ id: "try-the-page", tail: ["--quiet", "--check-in"] }) });
    await runHandPost({ deps: deps(), rest: postAs({ id: "fleet-steer", tail: ["--quiet"] }) });
    await runHandPost({ deps: deps(), rest: postAs({ id: "iso-reply", tail: ["--quiet", "--context", "work"] }) });
    out = [];
    expect(runHandList({ deps: deps(), rest: ["--home", home, "--ranked", "--json"] })).toBe(EXIT_OK);
    const rows = out.map((line) => JSON.parse(line) as { id: string; tier: string });
    expect(rows.map((row) => [row.id, row.tier])).toEqual([
      ["iso-reply", "team-blocked"],
      ["fleet-steer", "fleet-blocked"],
      ["try-the-page", "check-in"],
    ]);
  });

  it("keeps the register's oldest-first order, and no tier field, without --ranked", async () => {
    await runHandPost({ deps: deps(), rest: postAs({ id: "try-the-page", tail: ["--quiet", "--check-in"] }) });
    await runHandPost({ deps: deps(), rest: postAs({ id: "iso-reply", tail: ["--quiet", "--context", "work"] }) });
    out = [];
    expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    const rows = out.map((line) => JSON.parse(line) as { id: string; tier?: string });
    expect(rows.map((row) => row.id)).toEqual(["try-the-page", "iso-reply"]);
    expect(rows[0]!.tier).toBeUndefined();
  });

  it("--ranked prints each step's tier on its text line", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet", "--context", "work"] }) });
    out = [];
    expect(runHandList({ deps: deps(), rest: ["--home", home, "--ranked"] })).toBe(EXIT_OK);
    expect(out[0]).toBe("gcloud-signin  [team-blocked]  Sign in to Google Cloud so the monitor deploy can finish");
  });
});
