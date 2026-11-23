/**
 * The shared harness for the card-landing test files: the throwaway home and board each case runs over, the
 * call, card and anchor every case names, and the helpers that stage an ask, record a landing reading, build a
 * `landCard` input and read back what landed.
 *
 * `useCardLandHome()` mints the home in a `beforeEach` and removes it in the `afterEach` it registers, so read
 * `home` and `board` only inside a case. A filesystem round-trip into `mkdtempSync` directories, nothing else.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect } from "vitest";

import { unwrap } from "#lib/result.js";

import { runHandoverRegister } from "../../../../cli/commands/handover/askRowRun.js";
import { LANDING_PRODUCER } from "../../../../cli/commands/reading/core.js";
import type { LandCardInput } from "../../../../cli/commands/talk/cardLandApply.js";
import { EXIT_OK } from "../../../../cli/exitCodes.js";
import { runDisposition } from "../../../../handover/boardTypes.js";
import { derivedRowState } from "../../../../handover/derivedRowState.js";
import { parseHandoverDoc } from "../../../../handover/doc.js";
import { ownerWaitOf } from "../../../../handover/ownerWait.js";
import { applyRowEvent } from "../../../../handover/rowEvent.js";
import { readRunJournal } from "../../../../handover/runStore.js";
import { recordReading } from "../../../../readings/store.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { type CallEntry, OWNER_SPEAKER } from "../../../../talk/callRecord.js";
import { callsDir } from "../../../../talk/callStore.js";
import { activeCardLandings } from "../../../../talk/cardLanding.js";
import { readCardLandings } from "../../../../talk/cardLandingStore.js";

/** The call every case's utterances were said on. */
export const CALL = "a0000041-0000-4000-8000-000000000044";
// A held draft: a card whose register has no place for the owner's words, so they land as a dispatch row. A hand
// step takes no words at all (`talk/cardAnswer.ts`), so it is not this suite's card.
export const CARD = "draft:voice-mark-draft";
/** A hand step, which never takes the owner's words. */
export const HAND = "hand:voice-mark-step";
/** The anchor of the owner's first segment on {@link CALL}. */
export const ANCHOR = `call:${CALL}#s-1`;
/** The question a staged ask is waiting on the owner for. */
export const QUESTION = "Which base should the stacked PR target?";
// The relay turn whose row slug is `talk-` and this id's first twelve hex characters.
export const RELAY_TURN = "a0000071-0000-4000-8000-000000000077";
// A relay turn no board row carries, so the owner's words land on their own dispatch row.
const JUDGED_TURN = "a0000077-0000-4000-8000-000000000084";

/** The case's throwaway state home; a live binding, assigned before each case and read only inside one. */
export let home = "";
/** The handover board inside {@link home}; a live binding, assigned before each case and read only inside one. */
export let board = "";

/**
 * The voice's relay of the owner's words, judged an answer to the card — what `talk transcript` needs before it
 * lands any (a greeting said with a card open is not its answer).
 *
 * @param heard the words the voice relayed
 * @param about the card key the relay judged them an answer to
 * @returns a `relay` call entry judged to answer the card
 */
export const judged = ({
  atIso,
  heard = "what is a voice mark",
  about = CARD,
}: {
  atIso: string;
  heard?: string;
  about?: string;
}): CallEntry => ({
  about,
  answersCard: true,
  atIso,
  detail: "",
  heard,
  kind: "relay",
  outcome: "registered",
  say: heard,
  turnId: JUDGED_TURN,
});

/** The card of the owner's own pull request, keyed as the console keys it. */
export const MINE = "pr:acme.widgets.16406";

/**
 * Record a landing reading whose census lists each pull request under its author, read as `octocat`.
 *
 * @param prs each listed pull request and who opened it
 * @param atIso when the reading was taken and recorded
 */
export function recordLanding({
  prs,
  atIso = "2026-09-25T15:00:00.000Z",
}: {
  prs: readonly { number: number; author: string }[];
  atIso?: string;
}): void {
  const census = [{ kind: "read", pullRequests: prs, repo: "acme/widgets", viewer: "octocat" }];
  unwrap(
    recordReading({
      by: "tick-1",
      document: JSON.stringify({ census, rows: [], selection: { author: "@me", repos: ["acme/widgets"] } }),
      home,
      nowIso: atIso,
      observedAtIso: atIso,
      producer: LANDING_PRODUCER,
    }),
  );
}

/**
 * Put the call the landings name on disk, closed, carrying {@link ANCHOR}'s stretch finished over the card: a landing's
 * words are read as whole only off a call whose file is there and still says exactly them, since one absent, rewritten
 * without that stretch, or since grown past them may hold a later cut.
 *
 * @param card the card the stretch was said over, {@link CARD} unless a case lands elsewhere
 * @param words what the stretch says, as the landing about to be read carries them
 */
export function callOnDisk({ card = CARD, words }: { card?: string; words: string }): void {
  mkdirSync(callsDir({ home }), { recursive: true });
  const stretch: CallEntry = {
    atIso: "2026-09-25T15:39:00.000Z",
    final: true,
    id: "s-1",
    kind: "segment",
    open: card,
    text: words,
    who: OWNER_SPEAKER,
  };
  const closed = { atIso: "2026-09-25T16:30:00.000Z", kind: "closed", why: null };
  writeFileSync(join(callsDir({ home }), `${CALL}.jsonl`), `${JSON.stringify(stretch)}\n${JSON.stringify(closed)}\n`);
}

/**
 * Register the hooks that give every case its own home and board, and remove them after. Call it once, at the top
 * of a test file.
 */
export function useCardLandHome(): void {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "card-land-"));
    board = stateHomePaths({ home }).handovers;
    mkdirSync(board, { recursive: true });
    // The 16406 pull request is the owner's, so a {@link MINE} card holds the owner's words.
    recordLanding({ prs: [{ author: "octocat", number: 16406 }] });
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });
}

/**
 * The full argv a verb receives: `[node, bin, "talk", <verb>, ...rest]`.
 *
 * @returns the argv a `talk` verb's runner is handed
 */
export const argvFor = ({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] => [
  "node",
  "slopweaver",
  "talk",
  verb,
  ...rest,
];

/**
 * A `landCard` input landing {@link ANCHOR}'s words on {@link CARD} over this case's home and board.
 *
 * @param over the fields a case changes from that default
 * @returns the input `landCard` is handed
 */
export const input = (over: Partial<LandCardInput> = {}): LandCardInput => ({
  anchor: ANCHOR,
  cardKey: CARD,
  decidedIso: "2026-09-25T15:40:00.000Z",
  handoverDir: board,
  home,
  laterAnchors: [],
  nowIso: "2026-09-25T15:41:00.000Z",
  relayTurns: [],
  source: "transcript",
  words: "what is a voice mark",
  wordsCut: false,
  workspace: undefined,
  ...over,
});

/**
 * The landings still in force on this case's ledger.
 *
 * @returns each active landing's anchor, card key and work row
 */
export const active = (): readonly { cardKey: string; anchor: string; workSlug: string }[] =>
  activeCardLandings({ rows: unwrap(readCardLandings({ home })).rows }).map(({ anchor, cardKey, workSlug }) => ({
    anchor,
    cardKey,
    workSlug,
  }));

/** Put an ask on the board that is waiting on the owner, the way a session parks one. */
export async function stageAsk({ slug, anchor }: { slug: string; anchor?: string }): Promise<void> {
  const argv = ["node", "slopweaver", "handover", "register", "--ask", "a parked ask", "--priority", "p1"];
  const anchored = anchor === undefined ? [] : ["--anchor", anchor];
  expect(
    await runHandoverRegister([...argv, ...anchored, "--dispatch", "--slug", slug, "--dir", board, "--home", home]),
  ).toBe(EXIT_OK);
  const runsDir = stateHomePaths({ home }).runs;
  unwrap(
    applyRowEvent({
      event: { atIso: "2026-09-25T10:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
      runsDir,
      slug,
    }),
  );
  unwrap(
    applyRowEvent({
      event: { atIso: "2026-09-25T11:00:00.000Z", kind: "question", question: QUESTION },
      runsDir,
      slug,
    }),
  );
}

/**
 * How the queue reads an ask: `owner` is on the owner's queue, `already-ruled` waits on a session.
 *
 * @returns the ask's owner-wait kind, with the ruling's words when it is already ruled
 */
export function waitOf({ slug }: { slug: string }): { kind: string; words?: string } {
  const events = unwrap(readRunJournal({ runsDir: stateHomePaths({ home }).runs, slug })).events;
  const path = join(board, `${slug}.md`);
  const doc = parseHandoverDoc({ path, text: readFileSync(path, "utf8") });
  const wait = ownerWaitOf({
    derived: derivedRowState({ doc, events }),
    run: runDisposition({ events, unreadableLines: [] }),
  });
  if (wait.kind === "already-ruled") {
    return { kind: wait.kind, words: wait.words };
  }
  return { kind: wait.kind };
}
