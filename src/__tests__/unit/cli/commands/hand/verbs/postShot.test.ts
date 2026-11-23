/**
 * `hand post --shot` and `--box`: the picture a step carries, stored and published with its boxes, and the
 * pairings and boxes it refuses.
 */
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandList } from "../../../../../../cli/commands/hand/list.js";
import { runHandPost } from "../../../../../../cli/commands/hand/post.js";
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

describe("hand post", () => {
  describe("--shot and --box", () => {
    /** A PNG header declaring 1440x900 — all the store reads of the picture. */
    const png = (): string => {
      const bytes = Buffer.alloc(40);
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      ]).copy(bytes);
      bytes.writeUInt32BE(1440, 16);
      bytes.writeUInt32BE(900, 20);
      const path = join(home, "page.png");
      writeFileSync(path, bytes);
      return path;
    };

    it("stores the picture and publishes its boxes through `hand list --json`", async () => {
      const tail = [
        "--quiet",
        "--shot",
        png(),
        "--box",
        "40,120,320,36=Personal API keys",
        "--box",
        "1200,40,200,40=New key",
      ];
      expect(await runHandPost({ deps: deps(), rest: post({ tail }) })).toBe(EXIT_OK);
      out = [];
      expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
      const shot = JSON.parse(out[0]!).shot;
      expect(shot.width).toBe(1440);
      expect(shot.height).toBe(900);
      expect(shot.boxes).toEqual([
        { height: 36, label: "Personal API keys", width: 320, x: 40, y: 120 },
        { height: 40, label: "New key", width: 200, x: 1200, y: 40 },
      ]);
      const blob = join(home, "hand-steps", "shots", String(shot.sha256).slice(0, 2), shot.sha256);
      expect(statSync(blob).mode & 0o777).toBe(0o600);
    });

    it.each([
      [["--box", "0,0,10,10=x"], "hand post: --box is drawn on a picture — pass the provider page's PNG with --shot"],
      [
        ["--shot", "/tmp/page.png"],
        "hand post: --shot needs at least one --box x,y,width,height=label — a picture with no box shows the owner nothing to grab",
      ],
    ])("refuses %j unpaired before anything is read or written", async (flags, line) => {
      expect(await runHandPost({ deps: deps(), rest: post({ tail: [...flags] }) })).toBe(EXIT_USAGE);
      expect(diagnostics[0]).toBe(line);
    });

    it("refuses a box past the picture's edge and stores nothing", async () => {
      const tail = ["--quiet", "--shot", png(), "--box", "1400,0,41,10=past the edge"];
      expect(await runHandPost({ deps: deps(), rest: post({ tail }) })).toBe(EXIT_ERROR);
      expect(diagnostics[0]).toBe("hand post: shot box 1 has no area or runs past the 1440x900 picture");
      expect(existsSync(join(home, "hand-steps", "shots"))).toBe(false);
    });

    it("takes the picture back out when the append itself refuses the post", async () => {
      expect(await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) })).toBe(EXIT_OK);
      diagnostics = [];
      // The same id again, now carrying a picture: the register refuses the changed re-post at the append.
      const tail = ["--quiet", "--shot", png(), "--box", "40,120,320,36=Personal API keys"];
      expect(await runHandPost({ deps: deps(), rest: post({ tail }) })).toBe(EXIT_ERROR);
      expect(diagnostics[0]).toContain("shot");
      expect(readdirSync(join(home, "hand-steps", "shots"), { recursive: true })).toEqual([
        expect.stringMatching(/^[0-9a-f]{2}$/u),
      ]);
    });
  });
});
