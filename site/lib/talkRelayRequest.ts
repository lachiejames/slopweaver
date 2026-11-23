/**
 * What `/api/talk/relay` accepts, parsed in one pure function so every refusal is a unit test.
 *
 * A relay carries the owner's transcribed words (`heard`), the item they had open (`about`), the page-minted turn id,
 * and then one of three shapes: FULL, with the voice's reading (`say`), or HEARD-ONLY, with the names of what
 * the voice read after the owner spoke (`readsAfter`) and NO reading — the two the page's gate chooses between
 * (`site/lib/relayGate.ts`) — or WORDS-ALONE (`wordsAlone: true`), the page's one retry after the verb refused a
 * relay, which carries the owner's words and neither of the others (`site/lib/relayRetry.ts`). A `say` beside
 * `readsAfter`, or either beside `wordsAlone`, is refused rather than dropped: a page that sent both has not
 * done what the mode means, and the verb refuses the same pairs (`src/talk/relayDraft.ts`).
 *
 * It also carries the picture: a frame of the screen the owner shared, as a WebP data URL, or why there is none —
 * no share open, or a share that gave no frame. Two separate arms, because "nothing was shared" and "the share
 * failed" are different facts for the supervisor reading the row.
 *
 * And, when the voice judged the owner's words answer other Queue cards than the open one, those keys
 * (`alsoAnswers`), shape checked here; that each was served to the owner this call is the page's check
 * (`./alsoAnsweredCards.ts`).
 *
 * And, when one landed since the last relay, the copy-tray offer the owner was reacting to (`offered`), byte for byte,
 * so the row carries the exact text beside their words. Never a verdict on it: the owner's words say that.
 *
 * ## The byte checks are on BYTES
 *
 * The body is measured as UTF-8, not as `string.length` (UTF-16 code units, which undercounts every non-ASCII
 * character the owner's words carry). The picture passes `./webpDataUrl.ts` before a byte of it is written.
 */
import { alsoAnswersShapeOf } from "./alsoAnsweredCards";
import { discussFirstWireFrom } from "./discussFirst";
import {
  candidateRulingOf,
  coversOf,
  offeredOf,
  pictureOf,
  readingOf,
  readSourcesOf,
  triageRulingOf,
  workspaceOf,
} from "./talkRelayRequestFields";
import {
  ABOUT_KEY,
  RELAY_BODY_MAX_BYTES,
  RELAY_HEARD_MAX,
  RELAY_READS_MAX,
  refused,
  type TalkRelayParse,
  testInstanceRefusal,
  UUID_V4,
} from "./talkRelayRequestWire";

/**
 * Parse one relay request body.
 *
 * @param raw the request body as text
 * @returns the relay to spawn, or why it is refused
 */
export function parseTalkRelayRequest({ raw }: { raw: string }): TalkRelayParse {
  const bodyBytes = new TextEncoder().encode(raw).length;
  if (bodyBytes > RELAY_BODY_MAX_BYTES) {
    return refused({
      status: 413,
      why: `the relay is ${String(bodyBytes)} bytes; this route carries up to ${String(RELAY_BODY_MAX_BYTES)}`,
    });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return refused({ status: 400, why: "the body is not JSON" });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return refused({ status: 400, why: "the body is not an object" });
  }
  const held: Record<string, unknown> = { ...body };
  const marked = testInstanceRefusal({ value: held["instance"] });
  if (marked !== undefined) {
    return marked;
  }
  const { turnId, heard, about, say, readsAfter, screen, wordsAlone, covers, candidate, reaction, workspace, offered } =
    held;
  const { triage, label, feedback, discussFirst } = held;
  if (typeof turnId !== "string" || !UUID_V4.test(turnId)) {
    return refused({
      status: 400,
      why: "turnId is not a v4 UUID; the widget mints one per window of the owner's speech",
    });
  }
  if (typeof heard !== "string" || heard.trim() === "") {
    return refused({
      status: 400,
      why: "heard must carry the owner's transcribed words; a relay without them is not their steer",
    });
  }
  if (heard.length > RELAY_HEARD_MAX) {
    return refused({
      status: 413,
      why: `heard is ${String(heard.length)} characters; this route carries ${String(RELAY_HEARD_MAX)}`,
    });
  }
  // The owner's words reach the verb on stdin, so a leading hyphen is theirs to keep: no flag parser reads them. A
  // control character is a space, never a refusal: speech-to-text means none, and the row and the chair's line are
  // printed to a terminal, as a typed steer's are. A lone surrogate becomes U+FFFD here rather than in the
  // UTF-8 the verb reads, so what this route accepts is exactly what the turn records.
  const words = heard.toWellFormed().replace(/\p{Cc}/gu, " ");
  if (words.trim() === "") {
    return refused({ status: 400, why: "heard carries no words once its control characters are spaces" });
  }
  const heardTail = held["heardTail"];
  if (heardTail !== undefined && heardTail !== "cut" && heardTail !== "whole") {
    return refused({ status: 400, why: "heardTail must be cut or whole when present" });
  }
  if (typeof about !== "string" || (about !== "" && !ABOUT_KEY.test(about))) {
    return refused({ status: 400, why: "about must be a queue key such as ask:<slug>, or empty" });
  }
  // The page held each key to what it served the owner; the route re-checks the shape it can see without that record.
  const also = alsoAnswersShapeOf({ about, value: held["alsoAnswers"] });
  if (also.kind === "refused") {
    return refused({ status: 400, why: also.why });
  }
  const reach = coversOf({ about, value: covers });
  if (reach.kind === "refused") {
    return reach;
  }
  const ruling = candidateRulingOf({ candidate, covers: reach.covers, reaction });
  if (ruling.kind === "refused") {
    return ruling;
  }
  const triaged = triageRulingOf({
    about,
    feedback,
    label,
    otherRuling: reach.covers !== undefined || ruling.ruling !== undefined,
    triage,
  });
  if (triaged.kind === "refused") {
    return triaged;
  }
  const stated = workspaceOf({ value: workspace });
  if (stated.kind === "refused") {
    return stated;
  }
  // A refusal of the reading or the reads alone is one the owner's words alone would pass, so the page may retry it.
  const retryable = wordsAlone === undefined;
  const reads = readSourcesOf({ value: readsAfter });
  if (reads === undefined) {
    const why = `readsAfter must be a list of up to ${String(RELAY_READS_MAX)} read-tool names, each lowercase letters and underscores`;
    return { ...refused({ status: 400, why }), wordsAloneRetry: retryable };
  }
  const reading = readingOf({ reads, say, wordsAlone });
  if (reading.kind === "refused") {
    return { ...reading, wordsAloneRetry: retryable };
  }
  // The offer is text the voice wrote, so a words-alone retry carries none, and a refusal of it is one that retry passes.
  const offer = offeredOf({ value: offered, wordsAlone: reading.wordsAlone });
  if (offer.kind === "refused") {
    return { ...offer, wordsAloneRetry: retryable };
  }
  const picture = pictureOf({ value: screen });
  if (picture.kind === "refused") {
    return picture;
  }
  // What the owner's words concern rather than the voice's prose, as a check-in target is, so a words-alone retry keeps it.
  const fix = discussFirstWireFrom({ value: discussFirst });
  if ("why" in fix) {
    return refused({ status: 400, why: fix.why });
  }
  return {
    kind: "relay",
    relay: {
      about,
      alsoAnswers: also.keys,
      candidateRuling: ruling.ruling,
      covers: reach.covers,
      discussFirst: fix.discussFirst,
      heard: words,
      heardTail,
      offered: offer.offered,
      readsAfter: reads,
      say: reading.say,
      screen: picture.screen,
      triageRuling: triaged.ruling,
      turnId,
      wordsAlone: reading.wordsAlone,
      workspace: stated.workspace,
    },
  };
}
