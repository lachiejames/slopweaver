/**
 * A relay typed into the supervisor's chat as a turn from the owner — the delivery half of `talk relay`.
 *
 * The relay types a paraphrase of what the owner asked into the supervisor console, in the cmux terminal, as if the
 * owner had sent it, with as few logistical hazards as possible. The board row stays the record; this is the
 * delivery.
 *
 * ## Why this is not a hole in the supervisor guard
 *
 * `cmux send` refuses the pinned supervisor for every other session, and the hook refuses the shell form
 * (`src/cmux/supervisorWorkspace.ts`, `src/admit/cmuxSendSupervisorGuard.ts`): a spawned session's REPORT
 * typed into the owner's box reads as the owner's own words. Both refusals stand. This module is one narrow sender: it runs
 * only inside `talk relay --deliver-to-supervisor`, after the row is on the REAL board (the flag refuses
 * `--dir` and `--home`), and every line it types opens with the relay's own slug so the chair can check it
 * against `talk log`. The page's gate — the owner just spoke, and the voice's reading is dropped if anything
 * third-party reached it since — runs in the browser, so the verb cannot re-check it; what keeps a session's shell off this sender is the same
 * hook that guards `cmux send` (`src/admit/cmuxSendSupervisorGuard.ts`), which refuses the flag from every
 * session but the pinned supervisor. That is a tripwire, not a fence, exactly as the `cmux send` half is: a
 * flag built at run time still reaches this verb, and nothing a same-user shell reaches authenticates a
 * caller. What a `SLOPWEAVER_HOME` pointed elsewhere writes, the chair declines: it acts on a line only when
 * the real `talk log` lists its slug as delivered and it is not a repeat
 * (`skills/supervisor/reference/routing.md` § 3a′). A typed turn is attributable, never authenticated
 * (`.claude/rules/cross-session-messages.md`), and the line says where to verify it.
 *
 * ## The logistical nightmares, and the branch that answers each
 *
 * - **Which workspace.** Resolved live by cmux's pin flag AND the fixed title, never a stored ref, because
 *   refs renumber as workspaces close. None, or more than one, and nothing is typed.
 * - **The owner's own half-typed words.** A paste into a composer holding the owner's unsent text splices the two together.
 *   The composer is read first; `typed` — or `unreadable`, since not knowing is not "empty" — types nothing.
 * - **A chair mid-turn.** Never interrupted: the line queues behind the running turn, and says so.
 * - **An Enter the paste swallowed.** `reachSession` reads the composer back and presses Enter once more;
 *   a line still sitting there is reported `stranded`, never `typed`.
 * - **A long steer losing its middle.** The line and its newline are bounded under `RELAY_INLINE_MAX_CHARS` here, the owner's
 *   words cut at the END with the cut stated; the turn record carries every word, and the row names it. Only the
 *   owner's words are cut: the picture's path, a dropped-reading notice, the triage verdict and the verify tail always
 *   survive, so the chair can open what the owner was looking at and never reads the owner's yes without the verdict
 *   it came under.
 * - **Typing it twice.** One delivery claim per turn is created with `O_EXCL` before anything is typed
 *   (`relayDeliveryClaim.claimDelivery`), so two runs of one turn racing each other type once; the outcome is then
 *   recorded on the turn (`relayStore.markDelivered`), so a retry reports the first delivery.
 * - **Keys inside the owner's words.** Control characters become spaces and the owner's quotes cannot close the quoted
 *   words ({@link relayTurnLine}), so no byte of the steer reaches the terminal as a keystroke.
 * - **A console started outside cmux.** It holds no capability token and cmux's `cmuxOnly` layer refuses it
 *   (`docs/cmux-client/socket-and-measured-facts.md` § 1). Every relay after a `docs-site.sh --refresh` run from
 *   outside cmux is refused that way. So the relay hands the turn to the pinned chair's
 *   courier, a process inside cmux (`./relayCourierStore.ts`), which types this same line with `via: "courier"`;
 *   no courier taking it is `failed` with `courier-unavailable`, the voice says plainly it is NOT in the chat, and
 *   `handover reconcile` names it every pass until it is acted on (`./relayIntake.ts`).
 * - **Why nothing was typed.** A `failed` or `skipped` delivery carries a closed {@link DeliveryRefusal}, so a
 *   reader branches on the class and shows `detail`, cmux's own words.
 */
import type { CmuxTarget, CmuxWorkspaceSummary } from "../cmux/client.js";
import { type ComposerReading, readComposer } from "../cmux/composer.js";
import type { ReachWaits } from "../cmux/reach.js";
import { RELAY_INLINE_MAX_CHARS } from "../cmux/relayFile.js";
import { isPinnedSupervisorWorkspace } from "../cmux/supervisorWorkspace.js";
import type { CmuxHostReach, CmuxHostSurface } from "../sessionHarness/cmuxHost.js";

/** What a supervisor delivery reads and types through: the inventory, the styled grid and the reach. */
export type SupervisorDeliveryHost = Pick<CmuxHostSurface, "listWorkspaces" | "readScreenGrid"> & CmuxHostReach;

import type { AnswerContext } from "./answerContext.js";
import {
  composerRefusal,
  type Delivery,
  type DeliveryRefusal,
  type DeliveryVia,
  deliveryOfDisposition,
  listRefusalOf,
  sendFailureOf,
} from "./deliveryOutcome.js";
import { normaliseTyped } from "./relayAskText.js";
import { relayLineHead, relayLineVerify } from "./relayLine.js";
import { answerClause, cutField, LINE_SLUG_CHARS, typeable } from "./relayLineAnswer.js";
import type { RelayPicture } from "./relayPicture.js";
import { droppedReadingWhy } from "./relayReadSources.js";
import type { SteerCallContext } from "./steerCallContext.js";

/** The part of a relay turn the line is built from. */
export interface RelayLineInput {
  readonly slug: string;
  readonly heard: string;
  /** Whether {@link heard} was relayed while a stretch of speech was still open; the line says so. */
  readonly heardTailCut?: boolean;
  readonly words: string;
  /** What the voice read after the owner spoke; non-empty means its reading was dropped and the line says so. */
  readonly readsAfter: readonly string[];
  /** Whether a first relay of this turn was refused and this one carries the owner's words alone; the line says so. */
  readonly wordsAlone: boolean;
  /** Whether the owner typed the steer on the console, where `heard` is their typed words; the line says typed, not said. */
  readonly typed: boolean;
  /** The frame of the owner's screen or the image they attached, whose path the line carries so the chair opens it. */
  readonly picture: RelayPicture;
  /** For a typed steer, what the owner said on a call that the chair has not read; the line names it. */
  readonly callContext: SteerCallContext;
  /**
   * What the relay read out of the owner's words for a held draft or the card on screen (`./relayChannelSteer.ts`),
   * placed before them so a cut never takes it: a steer to a channel can be the END of the owner's words, and the
   * line's cut would drop it.
   */
  readonly lead?: string | undefined;
  /**
   * What the owner's words answered: the voice's turn before them and the verdict the relay stored
   * (`./answerContext.ts`). A bare yes read without the "Needs more info here too?" it answered is how the chair could
   * approve a draft the owner had sent back, so the line always carries the verdict, and the voice's turn in the room
   * the owner's words leave.
   */
  readonly answer: AnswerContext;
}

/**
 * The longest line this module composes: {@link RELAY_INLINE_MAX_CHARS} counts the newline `sendLine` appends, so the
 * line itself is one shorter, and a line of exactly that bound would split on paste (`pastesWhole`).
 */
const LINE_MAX_CHARS = RELAY_INLINE_MAX_CHARS - 1;

/** The most characters a lead takes on the line, so the owner's words always keep room. */
const RELAY_LEAD_MAX_CHARS = 240;

/** Where a relay would be typed, or why there is nowhere. */
export type SupervisorTarget =
  | { readonly kind: "one"; readonly workspace: CmuxWorkspaceSummary }
  | {
      readonly kind: "none";
      readonly why: string;
      readonly refusal: Extract<DeliveryRefusal, "no-pinned-supervisor" | "multiple-pinned-supervisors">;
    };

/**
 * The pinned supervisor among every workspace, when there is exactly one.
 *
 * @param workspaces every workspace cmux listed
 * @returns the one pinned supervisor, or why a relay has nowhere to be typed
 */
export function supervisorTargetOf({ workspaces }: { workspaces: readonly CmuxWorkspaceSummary[] }): SupervisorTarget {
  const pinned = workspaces.filter((workspace) =>
    isPinnedSupervisorWorkspace({ pinned: workspace.pinned, title: workspace.title }),
  );
  const [only] = pinned;
  if (only === undefined) {
    return { kind: "none", refusal: "no-pinned-supervisor", why: "no workspace is the pinned supervisor" };
  }
  if (pinned.length > 1) {
    return {
      kind: "none",
      refusal: "multiple-pinned-supervisors",
      why: `${String(pinned.length)} workspaces claim to be the pinned supervisor (${pinned.map((w) => w.workspaceRef).join(", ")})`,
    };
  }
  return { kind: "one", workspace: only };
}

/**
 * The one line typed into the supervisor's chat for a relay: the slug first, the owner's words next, then — for a typed
 * steer — the call it follows, then the picture to open and where to verify — bounded so it always pastes whole.
 * The picture's path, the verify pointer and what the owner's words answered — the verdict, and where the voice's turn is —
 * always survive, because a path cut short opens nothing and a yes without its question is misread; the owner's words come
 * next, cut at the end and marked; the voice's turn is quoted in the room they leave; the call's quotes take only the room left, cut from the front so the newest
 * words stay, and are dropped whole rather than shown as a fragment.
 *
 * @param turn the relay's slug, the owner's transcribed or typed words, the voice's reading, the reads after the owner, the
 *   picture and the call a typed steer follows
 * @returns the line, at most {@link LINE_MAX_CHARS} characters
 */
export function relayTurnLine({ turn }: { turn: RelayLineInput }): string {
  const slug = cutField({ max: LINE_SLUG_CHARS, text: turn.slug });
  const head = `${relayLineHead({ slug })}${leadClause({ lead: turn.lead })}`;
  const { dropped, droppedShort } = droppedReading({ turn });
  const verify = relayLineVerify({ slug });
  let answer = answerClause({ answer: turn.answer, typed: turn.typed });
  let tail = `${dropped} — ${linePicture({ picture: turn.picture, typed: turn.typed })}${verify}`;
  // A picture path or a list of reads that leaves the owner's words no room is named by the row instead, so every part of
  // the tail is a fixed phrase but the slug, and the line stays bounded. Then, still short of
  // room, the answer drops its reason: the owner's words outrank why no voice turn was named.
  if (head.length + answer.fixed.length + tail.length > LINE_MAX_CHARS - MIN_BODY_ROOM) {
    tail = `${droppedShort} — ${shortPicture({ picture: turn.picture, typed: turn.typed })}${verify}`;
  }
  if (head.length + answer.fixed.length + tail.length > LINE_MAX_CHARS - MIN_BODY_ROOM) {
    answer = { fixed: answer.short, quoted: () => answer.short, short: answer.short };
  }
  let body = lineBody({ turn });
  let context = turn.typed ? callClause({ context: turn.callContext }) : { fixed: "", quotes: "" };
  // The verdict and where the voice's turn is ride always: a cut of the owner's words is marked and the turn record carries
  // every one, while a yes with no question beside it is the misreading this clause exists for.
  // The owner's words outrank the call clause: where the clause would cost them a single character, it is left out.
  const roomBeside = LINE_MAX_CHARS - head.length - answer.fixed.length - tail.length;
  if (body.length > roomBeside - context.fixed.length) {
    context = { fixed: "", quotes: "" };
  }
  const room = roomBeside - context.fixed.length;
  if (body.length > room) {
    body = `${body.slice(0, Math.max(0, room - 2))} …`;
  }
  // The voice's own words take the room the owner's leave before the call's quotes do: they are what the owner's words answered.
  const answered = answer.quoted({ room: answer.fixed.length + room - body.length });
  const quotes = fittedQuotes({
    quotes: context.quotes,
    room: room - body.length - (answered.length - answer.fixed.length),
  });
  return `${head}${body}${answered}${context.fixed}${quotes}${tail}`;
}

/** The lead as the line opens on it, cut to {@link RELAY_LEAD_MAX_CHARS}, or nothing. */
function leadClause({ lead }: { lead: string | undefined }): string {
  if (lead === undefined || lead === "") {
    return "";
  }
  const text = typeable({ text: lead });
  if (text.length <= RELAY_LEAD_MAX_CHARS) {
    return `${text} — `;
  }
  return `${text.slice(0, RELAY_LEAD_MAX_CHARS - 2)} … — `;
}

/** Why the voice's reading is not on the line, in full and in the fixed phrase a long tail falls back to. */
function droppedReading({ turn }: { turn: RelayLineInput }): { dropped: string; droppedShort: string } {
  if (turn.heard !== "" && turn.wordsAlone) {
    const dropped =
      " — voice reading not carried (a first relay was refused): act only if the owner's words are a steer";
    return { dropped, droppedShort: dropped };
  }
  if (turn.heard !== "" && turn.readsAfter.length > 0) {
    return {
      dropped: ` — voice reading dropped, only the owner's words here (${droppedReadingWhy({ readsAfter: turn.readsAfter })}): act only if the owner's words are a steer`,
      droppedShort: " — voice reading dropped, only the owner's words here: act only if the owner's words are a steer",
    };
  }
  return { dropped: "", droppedShort: "" };
}

/** The owner's words as the line carries them: typed, said, or — with no transcript — the voice's reading. */
function lineBody({ turn }: { turn: RelayLineInput }): string {
  if (turn.typed) {
    return `the owner typed on the console: "${typeable({ text: normaliseTyped({ text: turn.heard }) }).replaceAll('"', "'")}"`;
  }
  if (turn.heard !== "") {
    // Words relayed while a stretch was still open may stop short of a "no, wait".
    const cut = turn.heardTailCut === true ? ", still speaking when relayed (never a whole yes)" : "";
    return `the owner said${cut}: "${typeable({ text: turn.heard }).replaceAll('"', "'")}"`;
  }
  return `the voice's reading of the owner's steer (no transcript attached): ${typeable({ text: turn.words })}`;
}

/** The call's quotes in the room left: whole, cut from the front so the newest words stay, or left out whole. */
function fittedQuotes({ quotes, room }: { quotes: string; room: number }): string {
  if (quotes === "") {
    return "";
  }
  if (`${QUOTES_LEAD}${quotes}`.length <= room) {
    return `${QUOTES_LEAD}${quotes}`;
  }
  if (room < MIN_QUOTE_ROOM) {
    return "";
  }
  const cutLead = `${QUOTES_LEAD}… `;
  return `${cutLead}${quotes.slice(quotes.length - (room - cutLead.length))}`;
}

/** The room a picture path must leave the owner's words; a longer path is named by the row rather than overflow the line. */
const MIN_BODY_ROOM = 64;

/** What opens the call's quotes on the line. */
const QUOTES_LEAD = "; newest the owner said: ";

/** The fewest characters the call's quotes are shown in, lead included; any less and they are left out whole. */
const MIN_QUOTE_ROOM = 48;

/**
 * What a typed steer's line says about the call it follows: a fixed clause that always rides, and the owner's newest unread
 * words, which ride only in the room left.
 *
 * @param context the call context read at delivery
 * @returns the clause and the quotes, each empty when there is nothing to say
 */
function callClause({ context }: { context: SteerCallContext }): { fixed: string; quotes: string } {
  if (context.kind === "none") {
    return { fixed: "", quotes: "" };
  }
  if (context.kind === "unavailable") {
    return {
      fixed: ` — this may follow a call: the owner's call words could not be read (${typeable({ text: context.why }).slice(0, 80)}); check slopweaver talk unread`,
      quotes: "",
    };
  }
  const quotes = context.newest.map((text) => `'${typeable({ text }).replaceAll("'", "’")}'`).join(" / ");
  return {
    fixed: ` — this follows the owner's call ${context.callId}, ${String(context.stretches)} stretch(es) of the owner's you have not read (slopweaver talk unread)`,
    quotes,
  };
}

/**
 * The picture as a line too full for its path names it: a pointer to the row that carries the path, or why there is
 * no picture.
 *
 * @param picture what the relay carried
 * @param typed whether the owner typed the steer, so an attached picture is the owner's image rather than their screen
 * @returns the phrase, of fixed length
 */
function shortPicture({ picture, typed }: { picture: RelayPicture; typed: boolean }): string {
  if (picture.kind === "attached") {
    return `the owner's ${typed ? "image" : "screen"}'s path is too long for this line, so read it off the row`;
  }
  return linePicture({ picture, typed });
}

/**
 * The picture as the line names it: a path the chair opens, or why there is none.
 *
 * @param picture what the relay carried
 * @param typed whether the owner typed the steer, so an attached picture is the owner's image rather than their screen
 * @returns the phrase
 */
function linePicture({ picture, typed }: { picture: RelayPicture; typed: boolean }): string {
  if (picture.kind === "attached" && typed) {
    return `the owner's image: ${typeable({ text: picture.path })}`;
  }
  if (picture.kind === "attached") {
    return `the owner's screen: ${typeable({ text: picture.path })}`;
  }
  if (picture.reason === "not-attached") {
    return "no image attached";
  }
  if (picture.reason === "screen-recording-off") {
    return "no picture: macOS Screen Recording is off for the desktop app, so it could not look at the owner's screen; grant it to Slopweaver, unless a device policy blocks it";
  }
  if (picture.reason === "capture-failed") {
    return "no picture: the look at the owner's screen gave no frame";
  }
  if (picture.reason === "not-taken-this-turn") {
    return "no picture: no screen frame was taken this turn";
  }
  if (picture.reason === "predates-pictures") {
    return "no picture";
  }
  return "no picture: screen not shared";
}

/**
 * Type one relay's line into the pinned supervisor's chat — or say, as a delivery, why nothing was typed.
 *
 * Never interrupts a running turn, and never throws: every failure is a `skipped` or `failed` delivery,
 * because the row is already on the board and the caller only has to report what happened.
 *
 * @param client the cmux host surface the line is typed through
 * @param turn the relay's slug and words
 * @param waits the reach's injected waits
 * @param nowIso the clock, read once per outcome
 * @param via which process is typing it: the relay's own, or the chair's courier
 * @returns what became of the line
 */
export async function deliverRelayToSupervisor({
  client,
  turn,
  waits,
  nowIso,
  via,
}: {
  client: SupervisorDeliveryHost;
  turn: RelayLineInput;
  waits: ReachWaits;
  nowIso: () => string;
  via: DeliveryVia;
}): Promise<Delivery> {
  return deliverLineToSupervisor({ client, line: relayTurnLine({ turn }), nowIso, via, waits });
}

/**
 * Type one fixed line into the pinned supervisor's chat, under every guard a relay's line gets: the one pinned
 * workspace, a composer the owner is not typing in, never an interrupt, an Enter the paste swallowed pressed once more. The
 * relay's line and the chair's wake (`./chairWakeShell.ts`) are its two senders.
 *
 * @param client the cmux host surface: the inventory through the harness, the screen and the never-interrupting reach
 * @param line the line, already made typeable and bounded by its sender
 * @param waits the reach's injected waits
 * @param nowIso the clock, read once per outcome
 * @param via which process is typing it
 * @returns what became of the line — never a throw
 */
export async function deliverLineToSupervisor({
  client,
  line,
  waits,
  nowIso,
  via,
}: {
  client: SupervisorDeliveryHost;
  line: string;
  waits: ReachWaits;
  nowIso: () => string;
  via: DeliveryVia;
}): Promise<Delivery> {
  const listed = await client.listWorkspaces();
  if (listed.isErr()) {
    return {
      atIso: nowIso(),
      detail: `cmux could not list workspaces: ${listed.error.message}`,
      kind: "failed",
      refusal: listRefusalOf({ error: listed.error }),
      via,
    };
  }
  const found = supervisorTargetOf({ workspaces: listed.value });
  if (found.kind === "none") {
    return { atIso: nowIso(), detail: `not typed: ${found.why}`, kind: "skipped", refusal: found.refusal, via };
  }
  const target: CmuxTarget = { workspaceId: found.workspace.workspaceId };
  const grid = await client.readScreenGrid({ target });
  const composer: ComposerReading = grid.isOk()
    ? readComposer({ grid: grid.value })
    : { kind: "unreadable", reason: grid.error.message };
  const refused = composerRefusal({ composer });
  if (refused !== undefined) {
    return { atIso: nowIso(), detail: `not typed: ${refused.why}`, kind: "skipped", refusal: refused.refusal, via };
  }
  const reached = await client.reachSession({ target, text: line, waits });
  if (reached.isErr()) {
    return sendFailureOf({ atIso: nowIso(), error: reached.error, via });
  }
  return deliveryOfDisposition({
    atIso: nowIso(),
    disposition: reached.value.disposition,
    via,
    workspaceRef: found.workspace.workspaceRef,
  });
}
