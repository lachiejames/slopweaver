/*
 * Reading the owner's words off a `call:<callId>#<segment>` anchor through `resolveHisWords` and `resolveRawWords` —
 * the card-landing scheme, read off the landing ledger and checked against a closed call file on disk. The landing
 * reader's own cases are `./hisWordsLanded.test.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveHisWords, resolveRawWords } from "../../../handover/hisWordsResolve.js";
import { unwrap } from "../../../lib/result.js";
import { OWNER_SPEAKER } from "../../../talk/callRecord.js";
import type { CardLandedRow } from "../../../talk/cardLanding.js";
import { appendCardLanding } from "../../../talk/cardLandingStore.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "owner-words-landing-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

function resolve({ anchor }: { anchor: string }): ReturnType<typeof resolveHisWords> {
  return resolveHisWords({ anchor, home, projectsDir: join(home, "projects") });
}

/**
 * The landings' call on disk, closed, carrying each landed utterance over its card with the voice between: `cut`
 * never finished, every other one exactly its landing's words, finished.
 */
const closedCallOnDisk = (): void => {
  mkdirSync(join(home, "talk", "calls"), { recursive: true });
  const said = [
    { id: "s-1", open: "ask:ship-it", text: "ship it" },
    { final: false, id: "cut", text: "yes send it" },
    { id: "whole", text: "yes send it" },
    { id: "older", text: "yes send it" },
  ];
  const stretches = said.flatMap(({ final = true, id, open = "post:sd-11112222", text }, at) => [
    JSON.stringify({
      atIso: `2026-09-26T21:0${String(at)}:00.000Z`,
      final,
      id,
      kind: "segment",
      open,
      text,
      who: OWNER_SPEAKER,
    }),
    JSON.stringify({
      atIso: `2026-09-26T21:0${String(at)}:30.000Z`,
      final: true,
      id: `v-${id}`,
      kind: "segment",
      open,
      text: "noted",
      who: "voice",
    }),
  ]);
  const closed = JSON.stringify({ atIso: "2026-09-26T21:09:00.000Z", kind: "closed", why: null });
  writeFileSync(
    join(home, "talk", "calls", "a0000041-0000-4000-8000-000000000044.jsonl"),
    `${[...stretches, closed].join("\n")}\n`,
  );
};

describe("resolveHisWords — a call: card-landing anchor", () => {
  it("quotes a call: anchor off the card it landed on, and names that record rather than the call file", () => {
    const anchor = "call:a0000041-0000-4000-8000-000000000044#s-1";
    const landed: CardLandedRow = {
      anchor,
      atIso: "2026-09-26T21:05:00.000Z",
      cardKey: "ask:ship-it",
      decidedIso: "2026-09-26T21:04:00.000Z",
      kind: "landed",
      source: "transcript",
      words: "ship it",
      workSlug: "ship-it",
    };
    unwrap(appendCardLanding({ home, row: landed }));
    closedCallOnDisk();
    expect(unwrap(resolve({ anchor }))).toEqual({
      anchor,
      cut: "none",
      atIso: "2026-09-26T21:04:00.000Z",
      where: "call-landing",
      words: "ship it",
    });
    expect(unwrap(resolveRawWords({ anchor, home, projectsDir: join(home, "projects") })).context).toEqual({
      cardKey: "ask:ship-it",
      draftIds: undefined,
      draftIdsUnread: undefined,
      kind: "card-landing",
    });
  });

  // A call that closed or dropped lands a stretch it never finished: the landing says so, and one that predates
  // saying it is never read as whole — so the whole-words check an approval makes can see the cut.
  it("reads a landing's cut off the landing: cut as cut, whole as whole, one that predates saying as unknown", () => {
    const row = ({ segment, wordsCut }: { segment: string; wordsCut: boolean | undefined }): string => {
      const anchor = `call:a0000041-0000-4000-8000-000000000044#${segment}`;
      const base: CardLandedRow = {
        anchor,
        atIso: "2026-09-26T21:05:00.000Z",
        cardKey: "post:sd-11112222",
        decidedIso: "2026-09-26T21:04:00.000Z",
        kind: "landed",
        source: "transcript",
        words: "yes send it",
        workSlug: `send-${segment}`,
      };
      unwrap(appendCardLanding({ home, row: wordsCut === undefined ? base : { ...base, wordsCut } }));
      return anchor;
    };
    const cut = row({ segment: "cut", wordsCut: true });
    const whole = row({ segment: "whole", wordsCut: false });
    const older = row({ segment: "older", wordsCut: undefined });
    closedCallOnDisk();
    const raw = ({ anchor }: { anchor: string }): readonly [boolean, boolean] => {
      const read = unwrap(resolveRawWords({ anchor, home, projectsDir: join(home, "projects") }));
      return [read.tailKnown, read.tailLost];
    };
    expect([raw({ anchor: cut }), raw({ anchor: whole }), raw({ anchor: older })]).toEqual([
      [true, true],
      [true, false],
      [false, false],
    ]);
    expect(unwrap(resolve({ anchor: cut })).cut).toBe("end");
    expect(unwrap(resolve({ anchor: whole })).cut).toBe("none");
  });
});
