/**
 * `hand retract`: every named step settled as a retraction, never as done, all or nothing, and never without a
 * reason.
 */
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandList } from "../../../../../../cli/commands/hand/list.js";
import { runHandPost } from "../../../../../../cli/commands/hand/post.js";
import { runHandRetract } from "../../../../../../cli/commands/hand/retract.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
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

describe("hand retract", () => {
  it("settles every named step as a RETRACTION, never as done, and takes it off the list", async () => {
    await runHandPost({ deps: deps(), rest: postAs({ id: "mon-park-a", tail: ["--quiet"] }) });
    await runHandPost({ deps: deps(), rest: postAs({ id: "mon-park-b", tail: ["--quiet"] }) });
    await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) });
    out = [];

    expect(
      await runHandRetract({
        deps: deps(),
        rest: ["mon-park-a", "mon-park-b", "--why", "a parked run, already on the owner's queue", "--home", home],
      }),
    ).toBe(EXIT_OK);
    expect(out).toEqual([
      "hand retract: 2 step(s) retracted — retracted, never a step for the owner's hands — a parked run, already on the owner's queue",
      "  1 step(s) still waiting on the owner",
    ]);
    const register = readFileSync(join(home, "hand-steps", "steps.jsonl"), "utf8");
    expect(register).toContain(
      `"did":"retracted, never a step for the owner's hands — a parked run, already on the owner's queue"`,
    );
  });

  it("retracts NOTHING when one id in the list is not open, so a typo never half-applies", async () => {
    await runHandPost({ deps: deps(), rest: postAs({ id: "mon-park-a", tail: ["--quiet"] }) });

    expect(await runHandRetract({ deps: deps(), rest: ["mon-park-a", "nope", "--why", "x", "--home", home] })).toBe(
      EXIT_ERROR,
    );
    expect(diagnostics[0]).toContain("no open hand step carries nope — nothing was retracted");
    out = [];
    runHandList({ deps: deps(), rest: ["--home", home, "--json"] });
    expect(out.join("\n")).toContain('"id":"mon-park-a"');
  });

  it("refuses without a --why, because a retraction nobody can read the reason for is a silent delete", async () => {
    expect(await runHandRetract({ deps: deps(), rest: ["mon-park-a", "--home", home] })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe("hand retract: at least one step id and a non-empty --why are required");
  });
});
