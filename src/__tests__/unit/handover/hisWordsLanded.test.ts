/**
 * `landedWords` — the owner's words off a card landing, cut when the landing or the call file now says so.
 *
 * The case that made the call-file read: a whole row landed, the owner restored the card, then an
 * overtaken batch put an empty unfinished stretch ahead of the same words. The restore keeps any cut row from being
 * written, so only the call file still shows the cut, and `slack draft approve` must not bind the old row as their
 * whole yes.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { landedWords } from "../../../handover/hisWordsLanded.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { OWNER_SPEAKER } from "../../../talk/callRecord.js";
import type { CardLandedRow } from "../../../talk/cardLanding.js";
import { appendCardLanding } from "../../../talk/cardLandingStore.js";

const CALL = "a0000041-0000-4000-8000-000000000044";
const CARD = "post:sd-11112222";
const ANCHOR = `call:${CALL}#s-1`;

/** One of the owner's stretches over the card, as a call-file line. */
const said = ({ at, final, id, text }: { at: string; final: boolean; id: string; text: string }): string =>
  JSON.stringify({
    atIso: `2026-09-26T21:${at}.000Z`,
    final,
    id,
    kind: "segment",
    open: CARD,
    text,
    who: OWNER_SPEAKER,
  });

const CLOSED = JSON.stringify({ atIso: "2026-09-26T21:09:00.000Z", kind: "closed", why: null });
const WHOLE = [said({ at: "04:00", final: true, id: "s-1", text: "send it" }), CLOSED];
const CUT = [said({ at: "03:59", final: false, id: "s-0", text: " " }), ...WHOLE];

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "owner-words-landed-"));
  const row: CardLandedRow = {
    anchor: ANCHOR,
    atIso: "2026-09-26T21:05:00.000Z",
    cardKey: CARD,
    decidedIso: "2026-09-26T21:04:00.000Z",
    kind: "landed",
    source: "transcript",
    words: "send it",
    wordsCut: false,
    workSlug: "send-s-1",
  };
  unwrap(appendCardLanding({ home, row }));
  mkdirSync(join(home, "talk", "calls"), { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Write the call file as these lines. */
const callFile = ({ text }: { text: string }): void => {
  writeFileSync(join(home, "talk", "calls", `${CALL}.jsonl`), text);
};

describe("landedWords", () => {
  it("reads a whole landing as cut once its call shows a stretch of it unfinished, and as whole while it does not", () => {
    const tailLostWith = ({ lines }: { lines: readonly string[] }): readonly [string, boolean, boolean] => {
      callFile({ text: `${lines.join("\n")}\n` });
      const read = unwrap(landedWords({ anchor: ANCHOR, home }));
      return [read.text, read.tailKnown, read.tailLost];
    };
    expect([tailLostWith({ lines: WHOLE }), tailLostWith({ lines: CUT })]).toEqual([
      ["send it", true, false],
      ["send it", true, true],
    ]);
  });

  // A final replaces the snapshot it follows, and the fold that read the landing whole reads the
  // call the same way, so a whole row over a call whose earlier snapshot the final does not print must read as cut.
  it("reads a whole landing as cut when the final that won does not print an earlier snapshot of its stretch", () => {
    const tailLostWith = ({ before }: { before: string }): boolean => {
      const snapshot = said({ at: "03:59", final: false, id: "s-1", text: before });
      callFile({ text: `${[snapshot, ...WHOLE].join("\n")}\n` });
      return unwrap(landedWords({ anchor: ANCHOR, home })).tailLost;
    };
    expect(["send it to everyone", "send no", "do not s", "send"].map((before) => tailLostWith({ before }))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  // The owner's line unfinished, a voice line under the same id finishing it with the same words.
  it("reads a whole landing as cut when a voice line shares the landed stretch's id and finished it", () => {
    const partial = said({ at: "03:59", final: false, id: "s-1", text: "send it" });
    const voiceFinal = JSON.stringify({ ...JSON.parse(WHOLE[0]!), who: "voice" });
    callFile({ text: `${[partial, voiceFinal, CLOSED].join("\n")}\n` });
    expect(unwrap(landedWords({ anchor: ANCHOR, home })).tailLost).toBe(true);
  });

  // A row landed off an unfinished snapshot stays cut until a final snapshot says exactly its words.
  it("lifts a cut the row recorded only when the call now finishes exactly the row's words", () => {
    const cutRow: CardLandedRow = {
      anchor: ANCHOR,
      atIso: "2026-09-26T21:06:00.000Z",
      cardKey: CARD,
      decidedIso: "2026-09-26T21:04:00.000Z",
      kind: "landed",
      source: "transcript",
      words: "send it",
      wordsCut: true,
      workSlug: "send-s-1",
    };
    unwrap(appendCardLanding({ home, row: cutRow }));
    const tailLostWith = ({ text }: { text: string }): boolean => {
      callFile({ text: `${[said({ at: "04:00", final: true, id: "s-1", text }), CLOSED].join("\n")}\n` });
      return unwrap(landedWords({ anchor: ANCHOR, home })).tailLost;
    };
    expect([tailLostWith({ text: "send it" }), tailLostWith({ text: "send it once the review lands" })]).toEqual([
      false,
      true,
    ]);
  });

  // A call still running ends no utterance, so the owner's last stretch matching the row lifts nothing;
  // Nor does a close line written BEFORE the utterance.
  it("keeps a recorded cut while the call has not ended the utterance, and lifts it once the call closes", () => {
    const cutRow: CardLandedRow = {
      anchor: ANCHOR,
      atIso: "2026-09-26T21:06:00.000Z",
      cardKey: CARD,
      decidedIso: "2026-09-26T21:04:00.000Z",
      kind: "landed",
      source: "transcript",
      words: "send it",
      wordsCut: true,
      workSlug: "send-s-1",
    };
    unwrap(appendCardLanding({ home, row: cutRow }));
    const stretch = said({ at: "04:00", final: true, id: "s-1", text: "send it" });
    const tailLostWith = ({ lines }: { lines: readonly string[] }): boolean => {
      callFile({ text: `${lines.join("\n")}\n` });
      return unwrap(landedWords({ anchor: ANCHOR, home })).tailLost;
    };
    expect([
      tailLostWith({ lines: [stretch] }),
      tailLostWith({ lines: [CLOSED, stretch] }),
      tailLostWith({ lines: [stretch, CLOSED] }),
    ]).toEqual([true, true, false]);
  });

  // One utterance must hold every anchor the row carries before its words lift the row's cut.
  it("keeps a recorded cut when the call now splits the row's stretches across two utterances", () => {
    const cutRow: CardLandedRow = {
      anchor: ANCHOR,
      atIso: "2026-09-26T21:06:00.000Z",
      cardKey: CARD,
      decidedIso: "2026-09-26T21:04:00.000Z",
      kind: "landed",
      laterAnchors: [`call:${CALL}#s-3`],
      source: "transcript",
      words: "send it",
      wordsCut: true,
      workSlug: "send-s-1",
    };
    unwrap(appendCardLanding({ home, row: cutRow }));
    const voice = JSON.stringify({
      ...JSON.parse(said({ at: "04:01", final: true, id: "s-2", text: "ok" })),
      who: "voice",
    });
    const tailLostWith = ({ between }: { between: readonly string[] }): boolean => {
      const lines = [
        said({ at: "04:00", final: true, id: "s-1", text: "send it" }),
        ...between,
        said({ at: "04:02", final: true, id: "s-3", text: "" }),
        CLOSED,
      ];
      callFile({ text: `${lines.join("\n")}\n` });
      return unwrap(landedWords({ anchor: ANCHOR, home })).tailLost;
    };
    expect([tailLostWith({ between: [] }), tailLostWith({ between: [voice] })]).toEqual([false, true]);
  });

  it("refuses when a stretch's card stamp does not read, since it might be the unfinished end of the landing", () => {
    const torn = JSON.stringify({
      ...JSON.parse(said({ at: "04:01", final: false, id: "s-2", text: "but" })),
      open: "?",
    });
    callFile({ text: `${[WHOLE[0]!, torn, CLOSED].join("\n")}\n` });
    expect(unwrapErr(landedWords({ anchor: ANCHOR, home })).message).toBe(
      `${ANCHOR} could not be read — 1 stretch(es) of the call carry a stamp that does not read, so whether its words were cut is unknown`,
    );
  });

  // A landing names a recorded call, so its file gone is evidence lost, never a call that shows no cut.
  it("refuses when the call file the landing names is not there", () => {
    expect(unwrapErr(landedWords({ anchor: ANCHOR, home })).message).toBe(
      `${ANCHOR} could not be read — the call file is not there, so whether its words were later cut is unknown`,
    );
  });

  // A file rewritten or cut short without the landed stretch can show no cut, which then proves nothing.
  it("refuses when the call file no longer holds the stretch the landing names", () => {
    callFile({ text: `${[said({ at: "04:00", final: true, id: "s-2", text: "send it" }), CLOSED].join("\n")}\n` });
    expect(unwrapErr(landedWords({ anchor: ANCHOR, home })).message).toBe(
      `${ANCHOR} could not be read — the call file no longer holds the stretch this landing names, so whether its words were cut is unknown`,
    );
  });

  // p3 02206483: a late snapshot that began earlier re-places the stretch, its text unchanged, so a transcript landing's
  // words still whole can sit on another card, or under one the voice opened, and then answer the card they landed on no
  // longer.
  it("refuses a transcript landing whose words the call now places on another card, or under the voice's", () => {
    const late = ({ over }: { over: Readonly<Record<string, string>> }): string =>
      JSON.stringify({
        ...JSON.parse(said({ at: "04:30", final: true, id: "s-1", text: "send it" })),
        beganIso: "2026-09-26T21:03:59.000Z",
        ...over,
      });
    const refusal = ({ over }: { over: Readonly<Record<string, string>> }): string => {
      callFile({ text: `${[WHOLE[0]!, late({ over }), CLOSED].join("\n")}\n` });
      return unwrapErr(landedWords({ anchor: ANCHOR, home })).message;
    };
    const why = `${ANCHOR} could not be read — the call no longer places these words on ${CARD}, opened by the owner, where they landed`;
    callFile({ text: `${WHOLE.join("\n")}\n` });
    expect([
      unwrap(landedWords({ anchor: ANCHOR, home })).tailLost,
      refusal({ over: { open: "post:sd-99998888" } }),
      refusal({ over: { openBy: "voice" } }),
    ]).toEqual([false, why, why]);
  });

  it("refuses when a call line does not parse, since that line might be the cut stretch", () => {
    callFile({ text: `${WHOLE.join("\n")}\n{torn\n` });
    expect(unwrapErr(landedWords({ anchor: ANCHOR, home })).message).toBe(
      `${ANCHOR} could not be read — 1 line(s) of the call do not parse, so whether its words were cut is unknown`,
    );
  });
});
