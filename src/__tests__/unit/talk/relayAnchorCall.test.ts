/**
 * `callIdInRelayAnchor` over a temp home this file mints: a real call index, a real call file and a real relay turn.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { callIndexPath, callsDir } from "../../../talk/callStore.js";
import { callIdInRelayAnchor } from "../../../talk/relayAnchorCall.js";
import { formRelayDraft } from "../../../talk/relayDraft.js";
import { claimTurn } from "../../../talk/relayStore.js";

const ID = "7b8bdb47-ae28-4ec4-a01e-780b7a5458a8";
const OTHER = "a0000071-0000-4000-8000-000000000077";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "relay-anchor-call-"));
  mkdirSync(dirname(callIndexPath({ home })), { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const index = ({ text }: { text: string }): void => writeFileSync(callIndexPath({ home }), text);
const read = ({ anchor }: { anchor: string }) => callIdInRelayAnchor({ anchor, home });

describe("callIdInRelayAnchor", () => {
  it("answers the call id when the call index lists it and no turn file is there", () => {
    index({ text: `${OTHER}\n${ID}\n` });
    expect(unwrap(read({ anchor: `talk:${ID}` }))).toBe(ID);
  });

  it("answers the call id off a call file alone, for a call that predates the index", () => {
    mkdirSync(callsDir({ home }), { recursive: true });
    writeFileSync(join(callsDir({ home }), `${ID}.jsonl`), "");
    expect(unwrap(read({ anchor: `talk:${ID}` }))).toBe(ID);
  });

  it("normalises the anchor's spelling as parseRelayAnchor does", () => {
    index({ text: `${ID}\n` });
    expect(unwrap(read({ anchor: ` TALK:${ID.toUpperCase()} ` }))).toBe(ID);
  });

  it("answers undefined for an id no call carries", () => {
    index({ text: `${OTHER}\n` });
    expect(unwrap(read({ anchor: `talk:${ID}` }))).toBe(undefined);
  });

  it("answers undefined when there is no call index at all", () => {
    expect(unwrap(read({ anchor: `talk:${ID}` }))).toBe(undefined);
  });

  it("answers undefined when a relay turn file carries the id, even one the index also lists", () => {
    index({ text: `${ID}\n` });
    const draft = unwrap(
      formRelayDraft({
        about: "",
        heard: "",
        picture: { kind: "none", reason: "screen-not-shared" },
        readsAfter: [],
        say: "explain this card to me",
        turnId: ID,
        typed: false,
        wordsAlone: false,
      }),
    );
    unwrap(claimTurn({ draft, home, nowIso: "2026-09-27T05:01:07.803Z" }));
    expect(unwrap(read({ anchor: `talk:${ID}` }))).toBe(undefined);
  });

  it("answers undefined for an anchor that is not talk:", () => {
    index({ text: `${ID}\n` });
    expect(unwrap(read({ anchor: `talk-call:${ID}#turn_000000000000000000011` }))).toBe(undefined);
  });

  it("refuses when the call index will not read, even with a call file under the id", () => {
    index({ text: "not-a-call-id\n" });
    mkdirSync(callsDir({ home }), { recursive: true });
    writeFileSync(join(callsDir({ home }), `${ID}.jsonl`), "");
    expect(unwrapErr(read({ anchor: `talk:${ID}` })).code).toBe("CALL_INDEX_MALFORMED");
  });

  it("refuses a dangling link at the call index's path, even with a call file under the id", () => {
    symlinkSync(join(home, "nowhere.txt"), callIndexPath({ home }));
    mkdirSync(callsDir({ home }), { recursive: true });
    writeFileSync(join(callsDir({ home }), `${ID}.jsonl`), "");
    const refused = unwrapErr(read({ anchor: `talk:${ID}` }));
    expect(refused.code).toBe("UNREAD_PATH_FAILED");
    expect(refused.message).toContain(callIndexPath({ home }));
  });

  it("refuses something other than a regular file at the call file's path, rather than calling it a call", () => {
    mkdirSync(join(callsDir({ home }), `${ID}.jsonl`), { recursive: true });
    expect(unwrapErr(read({ anchor: `talk:${ID}` })).message).toContain("not a regular call file");
  });
});
