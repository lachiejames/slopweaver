/**
 * `hand post --row` on a run waiting on the owner over a held question: refused while the owner's words over that
 * question's card since it was asked go unnamed in `--read-owner-words`, through once each anchor is named. A hand
 * note once asked the owner to paste a password again after they had spoken over the card the day before.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandPost } from "../../../../../../cli/commands/hand/post.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { NoteCommand } from "../../../../../../hand/note/raise.js";
import { ledgerLine, type RunEvent } from "../../../../../../handover/ledger.js";
import { callsDir } from "../../../../../../talk/callStore.js";
import { CLOSED, said } from "../../../../talk/cardUtteranceFixture.js";
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

const ROW = "backup-master-password-wraps-the-backup-key";
const CALL = "9b2f1c3e-4d5a-4b6c-8d7e-0f1a2b3c4d5e";
const ANCHOR = `call:${CALL}#s-1`;

/** A board row whose run waits on the owner over a question asked before the call. */
function waitingRow(): void {
  mkdirSync(join(home, "handovers"), { recursive: true });
  mkdirSync(join(home, "runs"), { recursive: true });
  writeFileSync(join(home, "handovers", `${ROW}.md`), `---\nslug: ${ROW}\nstatus: ready\n---\n# doc\n`);
  const events: readonly RunEvent[] = [
    { atIso: "2026-09-25T15:00:00.000Z", branch: "feat/x", docHash: "abc123", kind: "started" },
    { atIso: "2026-09-25T15:30:00.000Z", kind: "question", question: "Have you saved the new password?" },
  ];
  writeFileSync(join(home, "runs", `${ROW}.jsonl`), events.map((event) => ledgerLine({ event })).join(""));
}

/** A call in which the owner answered over the row's card, opened by the voice. */
function callOverCard(): void {
  const dir = callsDir({ home });
  mkdirSync(dir, { mode: 0o700, recursive: true });
  const lines = [
    { ...said({ at: "55:41", id: "s-1", open: `ask:${ROW}`, text: "Uh, I have saved it" }), openBy: "voice" },
    CLOSED,
  ];
  writeFileSync(join(dir, `${CALL}.jsonl`), lines.map((line) => `${JSON.stringify(line)}\n`).join(""), {
    mode: 0o600,
  });
}

describe("hand post — the owner's words over the row's held question are read before it is asked again", () => {
  it("refuses, quoting the anchor and the flag, and writes no step", async () => {
    waitingRow();
    callOverCard();
    expect(await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet", "--row", ROW] }) })).toBe(EXIT_ERROR);
    const text = diagnostics.join("\n");
    expect(text).toContain("slopweaver hand post blocked because");
    expect(text).toContain(`--read-owner-words ${ANCHOR}`);
    expect(commands).toEqual([]);
  });

  it("posts once the seat names the anchor as read", async () => {
    waitingRow();
    callOverCard();
    expect(
      await runHandPost({
        deps: deps(),
        rest: post({ tail: ["--quiet", "--row", ROW, "--read-owner-words", ANCHOR] }),
      }),
    ).toBe(EXIT_OK);
  });

  it("posts with no flag when the owner said nothing over the card", async () => {
    waitingRow();
    expect(await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet", "--row", ROW] }) })).toBe(EXIT_OK);
  });
});
