/**
 * `hand post` looking at a web `--url` before the note goes up: what it opens, what it refuses unseen, and the
 * picture the look carries onto the step.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandList } from "../../../../../../cli/commands/hand/list.js";
import type { HandPageLook } from "../../../../../../cli/commands/hand/pageLookRun.js";
import { runHandPost } from "../../../../../../cli/commands/hand/post.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { contentDigest } from "../../../../../../corpus/contentStore.js";
import type { NoteCommand } from "../../../../../../hand/note/raise.js";
import type { RowPullRequests } from "../../../../../../hand/rowPullRequest.js";
import type { ReadShot } from "../../../../../../hand/shotStore.js";
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

describe("hand post", () => {
  describe("looking at the page before the note goes up", () => {
    const PAGE = "http://localhost:3000/api/page/talk-stage-looks/index.html";

    /** A picture the look took: a PNG header declaring 1280x800, stamped so two looks differ by a byte. */
    const taken = ({ stamp }: { stamp: number }): ReadShot => {
      const bytes = Buffer.alloc(41);
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      ]).copy(bytes);
      bytes.writeUInt32BE(1280, 16);
      bytes.writeUInt32BE(800, 20);
      bytes.writeUInt8(stamp, 40);
      return { bytes, height: 800, sha256: contentDigest({ bytes }), width: 1280 };
    };

    it("opens a web --url itself before recording", async () => {
      expect(await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet", "--url", PAGE] }) })).toBe(EXIT_OK);
      expect(looked).toEqual([PAGE]);
    });

    it("opens nothing for a step with no link", async () => {
      expect(await runHandPost({ deps: deps(), rest: postAs({ id: "ask-1", tail: ["--quiet"] }) })).toBe(EXIT_OK);
      expect(looked).toEqual([]);
    });

    it("refuses a --url whose page answered 404, naming its hatch, and records nothing", async () => {
      const look: HandPageLook = { kind: "not-shown", why: `answered HTTP 404 at ${PAGE}` };
      expect(await runHandPost({ deps: deps({ look }), rest: post({ tail: ["--url", PAGE] }) })).toBe(EXIT_ERROR);
      expect(diagnostics[0]).toContain(
        `slopweaver hand post blocked because the post opened its --url in the owner's Chrome`,
      );
      expect(diagnostics[0]).toContain(`(the page answered HTTP 404 at ${PAGE})`);
      expect(diagnostics[0]).toContain("SLOPWEAVER_ALLOW_UNSEEN_HAND_URL=1 slopweaver hand post");
      expect(commands).toEqual([]);
      out = [];
      expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
      expect(out).toEqual([]);
    });

    it("refuses when the browser could not look at all — nothing unseen reaches the owner", async () => {
      const look: HandPageLook = { kind: "unlooked", why: "no Chrome profile pin is recorded" };
      expect(await runHandPost({ deps: deps({ look }), rest: post({ tail: ["--url", PAGE] }) })).toBe(EXIT_ERROR);
      expect(diagnostics[0]).toContain(`(the browser could not look at ${PAGE} — no Chrome profile pin is recorded)`);
    });

    it("carries the page as the look saw it, with no boxes, when the poster gave no --shot", async () => {
      const look: HandPageLook = { kind: "seen", picture: taken({ stamp: 1 }) };
      expect(await runHandPost({ deps: deps({ look }), rest: post({ tail: ["--quiet", "--url", PAGE] }) })).toBe(
        EXIT_OK,
      );
      out = [];
      expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
      const shot = JSON.parse(out[0]!).shot;
      expect(shot).toEqual({ boxes: [], height: 800, sha256: taken({ stamp: 1 }).sha256, width: 1280 });
      expect(existsSync(join(home, "hand-steps", "shots", String(shot.sha256).slice(0, 2), shot.sha256))).toBe(true);
    });

    it("reads an exact retry as the same posting, though its look took a different picture", async () => {
      const tail = ["--quiet", "--url", PAGE, "--posted-iso", NOW];
      const first: HandPageLook = { kind: "seen", picture: taken({ stamp: 1 }) };
      const second: HandPageLook = { kind: "seen", picture: taken({ stamp: 2 }) };
      expect(await runHandPost({ deps: deps({ look: first }), rest: post({ tail }) })).toBe(EXIT_OK);
      out = [];
      expect(await runHandPost({ deps: deps({ look: second }), rest: post({ tail }) })).toBe(EXIT_OK);
      expect(out[0]).toBe(
        "hand post: gcloud-signin already recorded — Sign in to Google Cloud so the monitor deploy can finish",
      );
    });

    it("refuses a check-in whose row's pull request is open, before opening the page", async () => {
      const pulls: RowPullRequests = {
        branches: ["talk-stage-looks"],
        kind: "read",
        pulls: [{ number: 1919, state: "OPEN", url: "https://github.com/lachiejames/slopweaver/pull/1919" }],
        repo: "lachiejames/slopweaver",
      };
      const tail = ["--check-in", "--row", "talk-stage-looks", "--url", PAGE];
      expect(await runHandPost({ deps: deps({ pulls }), rest: post({ tail }) })).toBe(EXIT_ERROR);
      expect(diagnostics[0]).toContain(
        "(--row talk-stage-looks's pull request is not merged, so what the check-in shows the owner is not live yet: " +
          "https://github.com/lachiejames/slopweaver/pull/1919 (open))",
      );
      expect(diagnostics[0]).toContain("SLOPWEAVER_ALLOW_UNMERGED_CHECK_IN=1 slopweaver hand post --check-in --row");
      expect(looked).toEqual([]);
      expect(commands).toEqual([]);
    });
  });
});
