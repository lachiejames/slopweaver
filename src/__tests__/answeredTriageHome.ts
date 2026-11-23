/**
 * An answered-triage incident laid out as a `$SLOPWEAVER_HOME`, written from synthetic words: the voice asks whether a
 * card needs more info too, the owner answers with a bare yes, and a relay carries that yes to the chair with no
 * verdict stored. It is the record set the approved-draft tick gate, `readAnswerContexts` and `talk unread` read, and
 * keeps every shape the incident's own records had: the owner's segment under the owner speaker label, a relay turn written before relays stored a `triageRuling`, and a parked draft whose approval is not yet recorded.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { slackDraftLogPath } from "../admit/slackDraftStore.js";
import { stateHomePaths } from "../stateHome.js";
import { OWNER_SPEAKER } from "../talk/callRecord.js";
import { callIndexPath, callsDir } from "../talk/callStore.js";
import { cardLandingsPath } from "../talk/cardLandingStore.js";

/** The call every record names. */
export const ANSWERED_CALL = "a0000044-0000-4000-8000-000000000047";

/** The relay turn that carried the owner's yes to the chair. */
export const ANSWERED_TURN = "a0000025-0000-4000-8000-000000000028";

/** The owner's words, as the relay heard them. */
export const ANSWERED_WORDS = "Yes, of course";

/** The voice's question the owner answered, ending in the question a test asserts the cut keeps. */
export const ANSWERED_QUESTION =
  "Needs more info. Next: a proposed post makes a claim about one account’s access in two systems, " +
  "no links or screenshots, and it guesses at a cause because a setting is on. Needs more info here too?";

/** The voice segment that asked {@link ANSWERED_QUESTION}. */
export const ANSWERED_QUESTION_SEGMENT = "turn_000000000000000000022";

/** The owner's segment that answered it. */
export const ANSWERED_OWNER_SEGMENT = "turn_000000000000000000023";

const CARD = "post:sd-ffab16e8";

/** One JSON line per record, newline-terminated, as the stores append them. */
function jsonl({ records }: { records: readonly Record<string, unknown>[] }): string {
  return records.map((record) => `${JSON.stringify(record)}\n`).join("");
}

/** The call's open record, the first line of its log. */
const CALL_OPEN = {
  atIso: "2026-10-13T23:23:06.040Z",
  kind: "open",
  model: "realtime-v3",
  sessionId: "a0000069-0000-4000-8000-000000000075",
  voice: "sol",
  writeId: "648479ba-2e9d-4f6a-a71e-cd2c1f43e4b4",
} as const;

/** The call's lines: its open, the voice's question, the owner's yes, the relay line, and the voice's reply. */
function callLines(): string {
  return jsonl({
    records: [
      CALL_OPEN,
      {
        atIso: "2026-10-13T23:38:44.101Z",
        beganIso: "2026-10-13T23:38:26.835Z",
        final: true,
        id: ANSWERED_QUESTION_SEGMENT,
        kind: "segment",
        open: CARD,
        openBy: "voice",
        text: ` ${ANSWERED_QUESTION}`,
        who: "voice",
        writeId: "e61574ac-eb20-4db2-a48c-710fe80b5103",
      },
      {
        atIso: "2026-10-13T23:38:47.623Z",
        beganIso: "2026-10-13T23:38:45.095Z",
        final: true,
        id: ANSWERED_OWNER_SEGMENT,
        kind: "segment",
        open: CARD,
        openBy: "voice",
        text: ` ${ANSWERED_WORDS}`,
        who: OWNER_SPEAKER,
        writeId: "dddafe84-751e-4e42-a181-fc2ef2f95db3",
      },
      {
        about: CARD,
        atIso: "2026-10-13T23:38:49.275Z",
        detail: "running talk relay",
        heard: ANSWERED_WORDS,
        kind: "relay",
        outcome: "sending",
        say: "(dropped: only the owner's words were sent)",
        turnId: ANSWERED_TURN,
        writeId: "0bebbe08-7db9-4fec-a9be-363a45972816",
      },
      {
        atIso: "2026-10-13T23:38:50.385Z",
        beganIso: "2026-10-13T23:38:47.624Z",
        final: true,
        id: "turn_000000000000000000024",
        kind: "segment",
        open: CARD,
        openBy: "voice",
        text: " Yep, on it.",
        who: "voice",
        writeId: "83907a8a-f37d-44c9-96bd-324ecbee07fc",
      },
    ],
  });
}

/** The relay turn, carrying no `triageRuling`: it predates relays storing one. */
function relayTurn(): string {
  const turn = {
    about: CARD,
    anchor: `talk:${ANSWERED_TURN}`,
    digest: "a".repeat(64),
    heard: ANSWERED_WORDS,
    heardTruncated: false,
    delivery: {
      atIso: "2026-10-13T23:38:53.764Z",
      detail: "typed into the supervisor's chat, queued behind its running turn",
      kind: "queued",
    },
    picture: { kind: "none", reason: "not-taken-this-turn" },
    readsAfter: ["context_pack", "web_search", "code_mode", "collaboration", "open_card_draft"],
    registeredAtIso: "2026-10-13T23:38:51.884Z",
    slug: "talk-a00000250000",
    stagedAtIso: "2026-10-13T23:38:51.584Z",
    state: "registered",
    turnId: ANSWERED_TURN,
    typed: false,
    words: "",
    wordsAlone: false,
  };
  return `${JSON.stringify(turn, null, 2)}\n`;
}

/** The relay's landing on the card the voice had open. */
function cardLandings(): string {
  return jsonl({
    records: [
      {
        anchor: `talk:${ANSWERED_TURN}`,
        atIso: "2026-10-13T23:38:51.895Z",
        cardKey: CARD,
        decidedIso: "2026-10-13T23:38:51.584Z",
        kind: "landed",
        source: "relay",
        words: ANSWERED_WORDS,
        workSlug: "talk-a00000250000",
      },
    ],
  });
}

/** The parked draft the owner's yes was read as approving, before any approval was recorded. */
function slackDrafts(): string {
  return jsonl({
    records: [
      {
        schemaVersion: 1,
        id: "sd-ffab16e8",
        kind: "parked",
        tsIso: "2026-10-13T11:02:10.240Z",
        draft: {
          advisory: [],
          channel: "C0123456789",
          digest: "0123456789abcdef0123456789abcdef",
          form: "{}",
          id: "sd-ffab16e8",
          mentions: [],
          payload: {
            form: "plain",
            text: "a proposed post, its words not kept here",
            unfurl_links: false,
            unfurl_media: false,
          },
          shape: "top-level",
          tsIso: "2026-10-13T11:02:10.240Z",
          why: "proposed post",
        },
      },
    ],
  });
}

/**
 * Write the incident's records into a home: the call, its index, the relay turn and its card landing under `talk/`,
 * and the parked draft under `queue/`. Every path comes from the store that reads it, so the home matches theirs.
 *
 * @param home the throwaway home to write into, created with its directories when absent
 */
export function writeAnsweredTriageHome({ home }: { home: string }): void {
  const { queue, talkTurns } = stateHomePaths({ home });
  const calls = callsDir({ home });
  mkdirSync(calls, { recursive: true });
  mkdirSync(talkTurns, { recursive: true });
  mkdirSync(queue, { recursive: true });
  writeFileSync(callIndexPath({ home }), `${ANSWERED_CALL}\n`);
  writeFileSync(join(calls, `${ANSWERED_CALL}.jsonl`), callLines());
  writeFileSync(join(talkTurns, `${ANSWERED_TURN}.json`), relayTurn());
  writeFileSync(cardLandingsPath({ home }), cardLandings());
  writeFileSync(slackDraftLogPath({ home }), slackDrafts());
}
