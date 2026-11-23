/**
 * `hand post` and a step asking the owner to react to a message drafted as them: refused unless the ask it opens offers
 * the message, by `--open` or a hand-typed `--url` alike.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  describe("a step asking the owner to react to a message drafted as them", () => {
    /** A step saying "drafted as you", opening the ask `iso-reply` through the console link `--open` mints. */
    function draftStep({ tail = [] }: { tail?: readonly string[] } = {}): string[] {
      const rest = [...post({ tail: ["--quiet", ...tail] })];
      rest[rest.indexOf("--what") + 1] = "Read the reply to Rosa drafted as you, and say whether to post it";
      return rest;
    }

    /** The `iso-reply` run's journal: started, asked, and — when `offered` — a reply as the owner attached. */
    function journal({ offered }: { offered: boolean }): void {
      const question = "Can I post this reply as you in the ISO thread?";
      const events: unknown[] = [
        { atIso: "2026-09-26T08:00:00.000Z", branch: "iso", docHash: "h1", kind: "started" },
        { atIso: "2026-09-26T08:10:00.000Z", kind: "question", question },
      ];
      if (offered) {
        events.push({
          action: {
            actor: "me",
            body: "<@U0SYN000002> happy for me to upload it?",
            destinations: [
              { channel: "C0SYN000001", kind: "channel", label: "#proj-iso", tradeoff: "under your name" },
            ],
            mentions: [{ label: "Rosa Lindqvist", userId: "U0SYN000002" }],
            version: 1,
          },
          atIso: "2026-09-26T08:25:00.000Z",
          kind: "question-offered",
          lean: "post it",
          options: [
            { letter: "A", option: "#proj-iso", tradeoff: "under your name" },
            { letter: "B", option: "Hold it — send nothing for now", tradeoff: "the draft goes stale" },
          ],
          problem: "change management waits on Rosa",
          question,
        });
      }
      mkdirSync(join(home, "runs"), { recursive: true });
      writeFileSync(
        join(home, "runs", "iso-reply.jsonl"),
        events.map((event) => `${JSON.stringify(event)}\n`).join(""),
      );
    }

    it("refuses it when it names no draft and opens no ask, recording nothing", async () => {
      expect(await runHandPost({ deps: deps(), rest: draftStep() })).toBe(EXIT_USAGE);
      expect(diagnostics[0]).toContain(
        "slopweaver hand post blocked because the step asks the owner to react to a message drafted as the owner",
      );
      expect(diagnostics[0]).toContain('it says "drafted as you", and it names no parked draft and opens no ask');
      out = [];
      expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
      expect(out).toEqual([]);
    });

    it("refuses it when the ask it opens offers no message", async () => {
      journal({ offered: false });
      expect(await runHandPost({ deps: deps(), rest: draftStep({ tail: ["--open", "ask:iso-reply"] }) })).toBe(
        EXIT_USAGE,
      );
      expect(diagnostics[0]).toContain("it names no parked draft, and the ask it opens offers no message");
    });

    it("admits it when the ask it opens offers the reply", async () => {
      journal({ offered: true });
      expect(await runHandPost({ deps: deps(), rest: draftStep({ tail: ["--open", "ask:iso-reply"] }) })).toBe(EXIT_OK);
      expect(diagnostics).toEqual([]);
    });

    it("judges a hand-typed --url exactly as --open, so neither spelling is a way round it", async () => {
      journal({ offered: false });
      const url = "http://localhost:3000/queue?open=ask%3Aiso-reply";
      expect(await runHandPost({ deps: deps(), rest: draftStep({ tail: ["--url", url] }) })).toBe(EXIT_USAGE);
      expect(diagnostics[0]).toContain("it names no parked draft, and the ask it opens offers no message");
    });
  });
});
