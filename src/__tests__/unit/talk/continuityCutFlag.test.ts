/*
 * The supervisor read marks a turn it cut short. The typed half of continuity carries that flag on the owner's
 * turn and on the chair's reply, so the voice can say an answer was cut rather than speak a clipped one as whole.
 */
import { describe, expect, it } from "vitest";

import { OWNER_SPEAKER } from "../../../talk/callRecord.js";
import { continuityForStorage, type TalkContinuity } from "../../../talk/continuity.js";
import { typedTurnsOf } from "../../../talk/continuityTyped.js";
import type { SupervisorExchange, SupervisorWindow } from "../../../talk/supervisorWindow.js";

const SINCE = "2026-09-21T17:30:00.000Z";
const TYPED_AT = "2026-09-24T17:38:24.337Z";
const REPLY_AT = "2026-09-24T17:41:39.293Z";
const LATER_AT = "2026-09-24T17:30:00.000Z";

/** An empty read, overridable. */
const continuity = (over: Partial<TalkContinuity> = {}): TalkContinuity => ({
  builtIso: "2026-09-24T17:30:00.000Z",
  calls: [],
  knowledge: [],
  rulings: [],
  sinceIso: SINCE,
  steers: [],
  typed: [],
  unread: [],
  ...over,
});

/** One owner turn of the supervisor chat, overridable. */
const exchange = (over: Partial<SupervisorExchange> = {}): SupervisorExchange => ({
  atIso: TYPED_AT,
  cut: false,
  text: "ditch the massive text on the bottom left",
  viaVoice: false,
  who: OWNER_SPEAKER,
  ...over,
});

/** A supervisor chat read whole, newest first. */
const chat = ({ exchanges }: { exchanges: readonly SupervisorExchange[] }): SupervisorWindow => ({
  exchanges,
  note: "",
  omitted: 0,
  sessionId: "s",
  tailCut: false,
  undecodable: 0,
});

describe("typedTurnsOf cut flag", () => {
  it("carries the supervisor read's cut flag on the owner's turn and on the reply, only when set", () => {
    const read = typedTurnsOf({
      sinceIso: SINCE,
      window: chat({
        exchanges: [
          exchange({ atIso: REPLY_AT, cut: true, text: "a long report …", who: "chair" }),
          exchange({ cut: true, text: "a long turn …" }),
          exchange({ atIso: LATER_AT, cut: false, text: "a short turn" }),
        ],
      }),
    });
    expect(read.typed).toEqual([
      {
        atIso: TYPED_AT,
        cut: true,
        reply: { atIso: REPLY_AT, cut: true, text: "a long report …" },
        text: "a long turn …",
      },
      { atIso: LATER_AT, reply: undefined, text: "a short turn" },
    ]);
    expect(Object.keys(read.typed[1]!)).not.toContain("cut");
    const stored = continuityForStorage({ continuity: continuity({ typed: read.typed }) });
    expect(stored.typed[0]!.cut).toBe(true);
    expect(stored.typed[0]!.reply!.cut).toBe(true);
    expect(Object.keys(stored.typed[1]!)).not.toContain("cut");
  });
});
