/*
 * A row is born with the owner's words when its anchor names them, and with the reason when they do not read — never
 * refused over a quote. A card landing's `call:` row is registered before its landing, so its missing record is the
 * expected order and is stored as unread for the landing to quote over.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registrationHisWords } from "../../../../../cli/commands/handover/registerHisWords.js";
import { unwrap } from "../../../../../lib/result.js";
import { formRelayDraft } from "../../../../../talk/relayDraft.js";
import { claimTurn } from "../../../../../talk/relayStore.js";

const TURN = "a0000015-0000-4000-8000-000000000016";
const STAGED = "2026-09-28T06:03:54.584Z";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "register-owner-words-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("registrationHisWords", () => {
  it("stores nothing for a row with no anchor, or an anchor that names no record of the owner's words", () => {
    expect([
      registrationHisWords({ anchor: undefined, home }),
      registrationHisWords({ anchor: "https://x.slack.com/archives/C1/p1", home }),
    ]).toEqual([undefined, undefined]);
  });

  it("stores the owner's words off a relay turn the anchor names", () => {
    const draft = unwrap(
      formRelayDraft({
        about: "",
        heard: "lead the card with my words",
        picture: { kind: "none", reason: "screen-not-shared" },
        readsAfter: [],
        say: "the voice's paraphrase, never quoted",
        turnId: TURN,
        typed: false,
        wordsAlone: false,
      }),
    );
    unwrap(claimTurn({ draft, home, nowIso: STAGED }));
    expect(registrationHisWords({ anchor: `talk:${TURN}`, home })).toEqual({
      hisWords: {
        anchor: `talk:${TURN}`,
        atIso: STAGED,
        cut: "none",
        where: "console-voice",
        words: "lead the card with my words",
      },
      kind: "held",
    });
  });

  it("stores why the words would not read, rather than refusing the row", () => {
    expect(registrationHisWords({ anchor: `talk:${TURN}`, home })).toEqual({
      anchor: `talk:${TURN}`,
      kind: "unread",
      why: `talk:${TURN}: no relay turn file carries it`,
    });
  });
});
