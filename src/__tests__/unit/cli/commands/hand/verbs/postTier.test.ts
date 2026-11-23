/**
 * `hand post` and the tier a step is posted in: exactly one of `--blocks` or `--check-in`, recorded as given.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandList } from "../../../../../../cli/commands/hand/list.js";
import { runHandPost } from "../../../../../../cli/commands/hand/post.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
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

describe("hand post", () => {
  describe("the tier a step is posted in", () => {
    /** The default post with no tier flag in it, then the case's own tail — so the case states the tier or none. */
    function untiered({ tail = [] }: { tail?: readonly string[] } = {}): string[] {
      const bare = [...post({ tail: ["--quiet", "--check-in"] })].filter((arg) => arg !== "--check-in");
      return [...bare, ...tail];
    }

    /** The one step `hand list --json` publishes. */
    function listedStep(): Record<string, unknown> {
      out = [];
      expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
      expect(out.length).toBe(1);
      return JSON.parse(out[0]!) as Record<string, unknown>;
    }

    it("refuses a step that names neither tier, naming both flags, and writes nothing", async () => {
      expect(await runHandPost({ deps: deps(), rest: untiered() })).toBe(EXIT_USAGE);
      expect(diagnostics[0]).toContain("--blocks when work is stopped on the owner, or --check-in when the fleet");
      expect(diagnostics[0]).toContain("Exactly one of the two");
      expect(existsSync(join(home, "hand-steps", "steps.jsonl"))).toBe(false);
    });

    it("refuses a step that names both tiers", async () => {
      expect(await runHandPost({ deps: deps(), rest: untiered({ tail: ["--blocks", "--check-in"] }) })).toBe(
        EXIT_USAGE,
      );
      expect(diagnostics[0]).toBe(
        "hand post: --check-in and --blocks are the two tiers — pass exactly one, never both",
      );
      expect(existsSync(join(home, "hand-steps", "steps.jsonl"))).toBe(false);
    });

    it("records a --check-in step as a check-in", async () => {
      expect(await runHandPost({ deps: deps(), rest: untiered({ tail: ["--check-in"] }) })).toBe(EXIT_OK);
      expect(listedStep()["checkIn"]).toBe(true);
    });

    it("records a --blocks step with no check-in mark", async () => {
      expect(await runHandPost({ deps: deps(), rest: untiered({ tail: ["--blocks"] }) })).toBe(EXIT_OK);
      const step = listedStep();
      expect(step["id"]).toBe("gcloud-signin");
      expect(step["checkIn"]).toBeUndefined();
    });
  });
});
