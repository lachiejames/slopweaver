/**
 * `hand done`: the step settled and its note taken down, and an id nothing open carries refused.
 */
import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandDone } from "../../../../../../cli/commands/hand/done.js";
import { runHandPost } from "../../../../../../cli/commands/hand/post.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
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

describe("hand done", () => {
  it("settles the step and takes its note down", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    out = [];
    expect(await runHandDone({ deps: deps(), rest: ["gcloud-signin", "--did", "signed in", "--home", home] })).toBe(
      EXIT_OK,
    );
    expect(out[0]).toBe("hand done: gcloud-signin settled — signed in");
    expect(out[1]).toBe("  0 step(s) still waiting on the owner");
  });

  it("refuses an id nothing open carries", async () => {
    expect(await runHandDone({ deps: deps(), rest: ["nope", "--did", "x", "--home", home] })).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain("no open hand step carries the id nope");
  });
});
