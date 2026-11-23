/**
 * `settleRelayAtAct` run for real against a temp home this file mints: a real relay turn, a real relay row on a
 * board OUTSIDE `home/handovers` (so the store mirror stays out of it, `testing.md`), and a real intake ledger.
 * The settle it performs is the shipped `handover settle`, so each case reads the row back off disk.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { askRowText } from "../../../../../cli/commands/handover/askRowText.js";
import { settleRelayAtAct } from "../../../../../cli/commands/handover/relaySettleAtAct.js";
import { unwrap } from "../../../../../lib/result.js";
import { appendIntakeMark } from "../../../../../supervisor/intakeStore.js";
import { formRelayDraft } from "../../../../../talk/relayDraft.js";
import { claimTurn, markRegistered } from "../../../../../talk/relayStore.js";

const TURN = "a0000063-0000-4000-8000-000000000069";
const SLUG = "talk-a00000630000";
const ANCHOR = `talk:${TURN}`;
const NOW = "2026-10-05T05:00:00.000Z";
const CARD = "owner-steer-console-call-5a50c50e-01-56z-01";
/** The measured mark: a card disposition whose witness is free text, not a row on the board. */
const REWORK = {
  byClaudeSessionId: "s",
  kind: "card",
  markedAtIso: NOW,
  witness: "the owning seat reworks the pull request on that relay",
} as const;

let home = "";
let dir = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "relay-act-"));
  dir = join(home, "board");
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Relay the owner's words over `about` (no card unless named) and register the relay's own row on the board. */
function relayRow({ about = "" }: { about?: string } = {}): string {
  const draft = unwrap(
    formRelayDraft({
      about,
      heard: "",
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say: "list my open PRs",
      turnId: TURN,
      typed: false,
      wordsAlone: false,
    }),
  );
  unwrap(markRegistered({ home, nowIso: NOW, record: unwrap(claimTurn({ draft, home, nowIso: NOW })).record }));
  return writeRow({ anchor: ANCHOR, slug: SLUG });
}

function writeRow({ anchor, slug }: { anchor: string; slug: string }): string {
  const path = join(dir, `${slug}.md`);
  writeFileSync(
    path,
    askRowText({
      anchor,
      ask: "list my open PRs",
      askedIso: "2026-10-05T04:59:00Z",
      branch: undefined,
      checkedIso: "2026-10-05T04:59:01Z",
      dispatch: true,
      finding: undefined,
      priority: undefined,
      repo: undefined,
      shape: undefined,
      slug,
    }),
  );
  return path;
}

describe("settleRelayAtAct", () => {
  it("answers the relay's own row when the chair marked its pointer", async () => {
    const path = relayRow();
    appendIntakeMark({
      home,
      mark: { byClaudeSessionId: "s", kind: "answered", markedAtIso: NOW, pointer: ANCHOR, witness: "listed in chat" },
    });

    const outcome = await settleRelayAtAct({ dir, home, pointer: ANCHOR, verb: "test" });

    expect(outcome).toEqual({ kind: "settled", slug: SLUG });
    expect(readFileSync(path, "utf8").includes("\nsettlement: answered\n")).toBe(true);
  });

  it("files the relay into a row cut from it", async () => {
    const path = relayRow();
    writeRow({ anchor: ANCHOR, slug: "the-cut-row" });

    const outcome = await settleRelayAtAct({ dir, home, pointer: ANCHOR, verb: "test" });

    expect(outcome).toEqual({ kind: "settled", slug: SLUG });
    const settled = readFileSync(path, "utf8");
    expect([settled.includes("\nsettlement: filed\n"), settled.includes("the-cut-row")]).toEqual([true, true]);
  });

  it("leaves a relay nothing took up open", async () => {
    const path = relayRow();
    const before = readFileSync(path, "utf8");

    expect(await settleRelayAtAct({ dir, home, pointer: ANCHOR, verb: "test" })).toEqual({ kind: "nothing-decided" });
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  // A free-text card mark answered a relay spoken over a card the owner's words never reached.
  it("leaves a relay spoken over a card open on a free-text card mark, when the owner's words reached nothing", async () => {
    const path = relayRow({ about: `ask:${CARD}` });
    const before = readFileSync(path, "utf8");
    appendIntakeMark({ home, mark: { ...REWORK, pointer: ANCHOR } });

    expect(await settleRelayAtAct({ dir, home, pointer: ANCHOR, verb: "test" })).toEqual({ kind: "nothing-decided" });
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("answers that relay once the owner's words are a ruling on the card's own journal", async () => {
    const path = relayRow({ about: `ask:${CARD}` });
    mkdirSync(join(home, "runs"), { recursive: true });
    const ruling = { anchor: ANCHOR, atIso: NOW, decidedIso: NOW, kind: "ruling", ruling: "I turn this card down" };
    writeFileSync(join(home, "runs", `${CARD}.jsonl`), `${JSON.stringify(ruling)}\n`);
    appendIntakeMark({ home, mark: { ...REWORK, pointer: ANCHOR } });

    expect(await settleRelayAtAct({ dir, home, pointer: ANCHOR, verb: "test" })).toEqual({
      kind: "settled",
      slug: SLUG,
    });
    expect(readFileSync(path, "utf8").includes("\nsettlement: answered\n")).toBe(true);
  });

  it("does nothing for a pointer that is no relay's, or a relay with no open row", async () => {
    expect(await settleRelayAtAct({ dir, home, pointer: "transcript:a0000036#291-8", verb: "test" })).toEqual({
      kind: "not-a-relay",
    });
    expect(await settleRelayAtAct({ dir, home, pointer: ANCHOR, verb: "test" })).toEqual({ kind: "no-open-row" });
  });
});
