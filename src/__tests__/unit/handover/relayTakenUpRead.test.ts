/**
 * What became of one relay's words, read off a real turn file and real run journals in a throwaway home — the
 * evidence `relayTakenUpOf` asks before a mark may answer a relay spoken over a card.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readRelayWorkEvidence } from "../../../handover/relayTakenUpRead.js";

const TURN = "a0000028-0000-4000-8000-000000000031";
const ANCHOR = `talk:${TURN}`;
const SLUG = "talk-a00000280000";
const ASK = "owner-steer-console-call-5a50c50e-01-56z-01";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "relay-work-"));
  mkdirSync(join(home, "talk", "turns"), { recursive: true });
  mkdirSync(join(home, "runs"), { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Write the relay's turn file as `talk relay` leaves a registered one, naming `about`. */
function writeTurn({ about }: { about: string }): void {
  const record = {
    about,
    anchor: ANCHOR,
    digest: "d",
    heard: "Right, that is all from me. I turn this card down",
    registeredAtIso: "2026-10-13T23:37:48.564Z",
    slug: SLUG,
    stagedAtIso: "2026-10-13T23:37:48.290Z",
    state: "registered",
    turnId: TURN,
    words: "",
  };
  writeFileSync(join(home, "talk", "turns", `${TURN}.json`), JSON.stringify(record));
}

/** Append journal lines to one row's run journal. */
function writeJournal({ slug, lines }: { slug: string; lines: readonly object[] }): void {
  writeFileSync(join(home, "runs", `${slug}.jsonl`), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
}

/** A ruling line as `talk relay` lands one on an ask, under `anchor`. */
function ruling({ anchor }: { anchor: string }): object {
  return {
    anchor,
    atIso: "2026-10-13T23:37:49.000Z",
    decidedIso: "2026-10-13T23:37:48.290Z",
    kind: "ruling",
    ruling: "I turn this card down",
  };
}

describe("readRelayWorkEvidence", () => {
  it("names no card for a relay whose turn names none, and reads no journal to say so", () => {
    writeTurn({ about: "" });
    writeFileSync(join(home, "runs", `${SLUG}.jsonl`), "{not json\n");

    expect(readRelayWorkEvidence({ anchor: ANCHOR, home, slug: SLUG })).toEqual({
      cardKey: undefined,
      kind: "read",
      rulingOnCard: false,
      seatDispatched: false,
    });
  });

  it("names no card for a key no register holds", () => {
    writeTurn({ about: "recipe:morning-digest" });

    expect(readRelayWorkEvidence({ anchor: ANCHOR, home, slug: SLUG })).toEqual({
      cardKey: undefined,
      kind: "read",
      rulingOnCard: false,
      seatDispatched: false,
    });
  });

  it("reads the measured incident: the card's journal ends on the re-asked question, no seat was dispatched", () => {
    writeTurn({ about: `ask:${ASK}` });
    writeJournal({ lines: [ruling({ anchor: "talk:a0000029-0000-4000-8000-000000000032" })], slug: ASK });

    expect(readRelayWorkEvidence({ anchor: ANCHOR, home, slug: SLUG })).toEqual({
      cardKey: `ask:${ASK}`,
      kind: "read",
      rulingOnCard: false,
      seatDispatched: false,
    });
  });

  it("finds the owner's words as a ruling on the card's journal by the relay's own anchor, a later ruling beside it", () => {
    writeTurn({ about: `ask:${ASK}` });
    writeJournal({
      lines: [ruling({ anchor: ANCHOR }), ruling({ anchor: "talk:a0000031-0000-4000-8000-000000000034" })],
      slug: ASK,
    });

    expect(readRelayWorkEvidence({ anchor: ANCHOR, home, slug: SLUG })).toEqual({
      cardKey: `ask:${ASK}`,
      kind: "read",
      rulingOnCard: true,
      seatDispatched: false,
    });
  });

  it("takes a ruling line that decodes as evidence beside a line that does not", () => {
    writeTurn({ about: `ask:${ASK}` });
    writeFileSync(join(home, "runs", `${ASK}.jsonl`), `${JSON.stringify(ruling({ anchor: ANCHOR }))}\n{not json\n`);

    expect(readRelayWorkEvidence({ anchor: ANCHOR, home, slug: SLUG })).toEqual({
      cardKey: `ask:${ASK}`,
      kind: "read",
      rulingOnCard: true,
      seatDispatched: false,
    });
  });

  it("proves nothing from a journal whose only line does not decode", () => {
    writeTurn({ about: `ask:${ASK}` });
    writeFileSync(join(home, "runs", `${ASK}.jsonl`), "{not json\n");

    expect(readRelayWorkEvidence({ anchor: ANCHOR, home, slug: SLUG })).toEqual({
      cardKey: `ask:${ASK}`,
      kind: "read",
      rulingOnCard: false,
      seatDispatched: false,
    });
  });

  it("finds a seat dispatched on the relay row, for a card that is not an ask", () => {
    writeTurn({ about: "post:sd-4a11e00c" });
    writeJournal({
      lines: [{ atIso: "2026-10-14T00:40:00.000Z", by: "chair", kind: "dispatched", target: "workspace:9" }],
      slug: SLUG,
    });

    expect(readRelayWorkEvidence({ anchor: ANCHOR, home, slug: SLUG })).toEqual({
      cardKey: "post:sd-4a11e00c",
      kind: "read",
      rulingOnCard: false,
      seatDispatched: true,
    });
  });

  it("finds a seat started on the relay row", () => {
    writeTurn({ about: `ask:${ASK}` });
    writeJournal({
      lines: [{ atIso: "2026-10-14T00:40:00.000Z", branch: SLUG, docHash: "c75dacb08229be26", kind: "started" }],
      slug: SLUG,
    });

    expect(readRelayWorkEvidence({ anchor: ANCHOR, home, slug: SLUG })).toEqual({
      cardKey: `ask:${ASK}`,
      kind: "read",
      rulingOnCard: false,
      seatDispatched: true,
    });
  });

  it("is unreadable, never a relay over no card, when the turn file is missing", () => {
    const work = readRelayWorkEvidence({ anchor: ANCHOR, home, slug: SLUG });

    expect(work.kind).toBe("unreadable");
    expect(JSON.stringify(work)).toContain("the relay's turn would not read");
  });

  it("is unreadable when the card's journal is not a regular file", () => {
    writeTurn({ about: `ask:${ASK}` });
    mkdirSync(join(home, "runs", `${ASK}.jsonl`));

    const work = readRelayWorkEvidence({ anchor: ANCHOR, home, slug: SLUG });

    expect(work.kind).toBe("unreadable");
    expect(JSON.stringify(work)).toContain(`${ASK}'s journal would not read`);
  });
});
