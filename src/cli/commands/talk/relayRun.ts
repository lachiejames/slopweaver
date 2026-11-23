/**
 * `slopweaver talk relay` — the ONE writer in this noun, and the only thing that puts a Talk conversation
 * on the board.
 *
 * ## The voice reaches this through ONE tool, behind a gate the page owns
 *
 * A steer the owner talks through with the console voice lands as if they had given it directly to the supervisor,
 * with no button between. So `relay_steer` is the one tool of kind
 * `"relay"` in `src/talk/talkToolSchemas.ts`, and the widget runs this verb when the model calls it. What
 * the model supplies is only `--say`, its reading. The page mints `--turn`, attaches their own words from the input
 * transcript (on stdin, `--heard-stdin`, so no length of them meets an argv limit), `--about` (the record on screen) and `--screen` (a WebP of the screen
 * they shared, or `--screen-failed`), and refuses the call outright unless they have spoken since the last relay
 * (`site/lib/relayGate.ts`). When something third-party was read back to the model after they spoke, the page
 * sends `--read-after <tools>` INSTEAD of `--say`: the model's reading is dropped and only their words travel.
 * When this verb refuses a relay before claiming its turn (exit 2), the page retries it once with
 * `--words-alone`, which carries their words and neither of the others (`site/lib/relayRetry.ts`).
 * `docs/security/voice-relays-and-retention.md` states the residue.
 *
 * ## A typed steer rides the same relay
 *
 * The supervisor is the owner's one single entry point, because its flow has generally worked well. So a steer TYPED to the supervisor is
 * this verb with `--typed`: `--heard` carries the typed words, there is no reading, `--screen` is an attached
 * image rather than a frame of a share, and the row, the kept picture, the once-per-turn delivery and `talk log` are
 * the ones a spoken relay gets. The console itself has no typed-steer box any more — its one text input is the
 * call's chat — so `--typed` is a session's, never a page's.
 *
 * ## The picture is kept before the row names it
 *
 * A steer carries the owner's exact words and an image of what they are looking at, since that is often how they
 * communicate directly. `--screen` is validated (size, WebP magic) before the turn is
 * claimed, and written to `talk/turns/<turnId>.webp` before the row is registered, so no row ever points at
 * a missing file. The digest binds the image: a retry with the same frame replays, a different frame for
 * the same turn is refused and the first is never replaced, and every write is this run's own bytes, so the
 * file a row names is never one the verb merely found there (`src/talk/relayPicture.ts`).
 *
 * ## Why `--dispatch` and not `--finding`
 *
 * A relay is THEIR word arriving on the board as ready work, which is what `--dispatch` means: an instruction
 * that asks them to pick nothing. `--finding` would claim a session OBSERVED something, which changes the
 * downstream authority a row carries (`AGENTS.md` rule 10) and would be a lie about
 * where the words came from. The card says "registers ready work" for the same reason — which is also why this verb never uses an ambiguous "share this thought" wording.
 *
 * ## Recovery reconciles on the ANCHOR, never on the slug's existence
 *
 * `handover register` can exit non-zero AFTER writing the row — `mirrorAfterWrite`'s result is folded into
 * the exit code. So a non-zero exit is not evidence nothing was written, and this verb goes and LOOKS: the
 * row exists, at the turn's own slug, carrying `talk:<turnId>`. Matching the anchor rather than the name is
 * what stops an unrelated row being adopted; `src/talk/relayStore.ts` carries the whole argument.
 *
 * ## A relay about a card lands on that card
 *
 * Words the owner says to an open card land on it. The
 * page sets `--about` only when the voice judged them its answer (`relay_steer`'s `answers_open_card`), so once the
 * row is on the board, a relay whose `--about` names a card lands their words on it — never a hand step, nor greeting or
 * filler alone (`src/talk/cardAnswer.ts`) — pointing at this
 * row as the work (`./relayCardLand.ts`) — on a replay too, so a landing a crash cut short is finished by the
 * retry. A landing that fails is said on stderr and never fails the relay: the row already carries every word.
 *
 * When the same words also decide other Queue cards, the voice
 * names them in `also_answers`, the page holds each to the cards its latest `action_items` read served them this call
 * and still on their Queue (`site/lib/alsoAnsweredCards.ts`), and each `--also-answers` card lands the same way, judged
 * against its own text. The keys are bound into the turn's digest, so a replay cannot change the targets.
 *
 * ## A reaction to a check-in is a ruling
 *
 * The owner walks their check-ins by voice, away from the screen, and the rulings they give clear batches. So a relay
 * about an `act:` check-in with `--covers rule|this` also records their words as their
 * word on every card it covers (`../../../talk/checkInRuling.ts`), and the `--json` report's `ruling` says how many.
 *
 * ## A reaction to a copy-tray draft carries the draft
 *
 * A relayed reaction to a tray draft once reached the
 * board with their words and not the text they were about. So the page sends the newest offer since the last relay, the
 * route stages it as `--offered-file`, and the draft binds every byte of it into the turn's digest — a retry carrying
 * another offer, or none, is a `RELAY_CONFLICT`. The row is registered as before, the offer nowhere in its summary,
 * and then given a marked section carrying it exactly (`./relayOfferAttach.ts`) before the turn is marked registered.
 * Their heard words stay the authority on what they made of it; nothing here reads approval out of them.
 *
 * ## A channel they name for the held draft on screen steers it
 *
 * A held draft moved to another channel on a call, with the steer the END of their words, can be cut off by the chair's
 * line and go out in the channel it was parked for, in public. So before the row is registered
 * the relay is read against the draft register and the card (`./relayChannelRun.ts`): a `post:<id>` card held for
 * another channel than their words name gets a `steered` event, which refuses a release outside it, and the row's
 * summary and the chair's line both OPEN on a lead saying so. Words naming a draft or channel the card on screen never
 * mentions are not landed on it — the acme-admin card that took their next two relays — and the lead says where they went.
 *
 * ## A relay made before the owner finished lands and rules nothing
 *
 * A voice relay whose words may end before the owner did — `--heard-tail cut`, or no `--heard-tail` at all — lands no
 * card, records no check-in or candidate ruling, stands no discuss-first go-ahead, and so puts no triage verdict on the
 * Queue (`../../../talk/relayCutHold.ts`). The row still carries every word and opens on a HELD
 * clause; the channel steer alone still appends, because it only ever refuses a release.
 */
import { randomUUID } from "node:crypto";

import { autonomyLedgerPort } from "../../../autonomy/port.js";
import { logger } from "../../../lib/logger.js";
import { readStdin } from "../../../lib/readStdin.js";
import type { Result } from "../../../lib/result.js";
import { readOrganisation } from "../../../organisation/read.js";
import {
  type DiscussFirstStanding,
  discussFirstLead,
  discussFirstStandingOf,
  joinedLead,
  type PriorPutRead,
} from "../../../talk/discussFirst.js";
import type { TalkError } from "../../../talk/errors.js";
import type { RelayCardDisposition } from "../../../talk/relayChannelSteer.js";
import { heldCardKeys, relayCutHold, relayHeldLead } from "../../../talk/relayCutHold.js";
import { formRelayDraft, type RelayDraft } from "../../../talk/relayDraft.js";
import { holdTurnRun, processStartOf } from "../../../talk/relayLease.js";
import { type PreparedRelayPicture, persistRelayPicture, prepareRelayPicture } from "../../../talk/relayPicture.js";
import { claimTurn, markRegistered, readTurn, type TurnRecord, withDraftPicture } from "../../../talk/relayStore.js";
import { productionWorkstreamRegister } from "../../../workstreams/store/register.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { talkHomeOf } from "./args.js";
import { parseRelayArgs, type RelayArgs } from "./relayArgs.js";
import { type CandidateRulingOutcome, recordCandidateRuling } from "./relayCandidateRuling.js";
import { landRelayCards } from "./relayCardLand.js";
import { appendSteerLead, readRelayChannelPlan, rowSteerLead } from "./relayChannelRun.js";
import { deliverOnce } from "./relayDeliverOnce.js";
import { ensureRow } from "./relayEnsureRow.js";
import { carryRelayOffer } from "./relayOfferAttach.js";
import { readOfferedFlag } from "./relayOfferFile.js";
import { type RelayOrganisationRead, refuseBeforeRelay } from "./relayPrechecks.js";
import { type RulingOutcome, relayReportLines } from "./relayReport.js";
import { recordRuling } from "./relayRuling.js";
import { TALK_RELAY_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "relay", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Run the `talk relay` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkRelay(argv: readonly string[]): Promise<number> {
  return runTalkRelayWith({ argv, readOrganisation });
}

/**
 * `talk relay` with its one store read injected: the organisation a team fix is judged against. The unit lane has
 * no store, so a test passes the organisation it means; the verb passes {@link readOrganisation}.
 *
 * @param argv the full process argv
 * @param readOrganisation reads the organisation under the relay's home
 * @returns the process exit code
 */
export async function runTalkRelayWith({
  argv,
  readOrganisation: readOrg,
}: {
  argv: readonly string[];
  readOrganisation: RelayOrganisationRead;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_RELAY_USAGE });
    return EXIT_OK;
  }
  const parsed = parseRelayArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_RELAY_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value.heardStdin ? { ...parsed.value, heard: await readStdin() } : parsed.value;
  const home = talkHomeOf({ home: args.home });
  const refused = await refuseBeforeRelay({ args, home, readOrganisation: readOrg });
  if (refused !== undefined) {
    return refused;
  }
  const formed = formRelay({ args, home });
  if (formed.isErr()) {
    logger.error({ msg: `talk relay: ${formed.error.message}` });
    return EXIT_USAGE;
  }
  const { draft, prepared } = formed.value;
  // The run lease is held BEFORE the claim, so a second run of this turn while this one lives reads nothing
  // and writes nothing: a resume is for a DEAD run, never a racing one (`relayStore.ts` § the run lease).
  const lease = holdTurnRun({
    home,
    pid: process.pid,
    startOf: (pid) => processStartOf({ pid }),
    turnId: draft.turnId,
  });
  if (lease.isErr()) {
    logger.error({ msg: `talk relay: ${lease.error.message}` });
    return lease.error.code === "RELAY_IN_FLIGHT" ? EXIT_DEFERRED : EXIT_ERROR;
  }
  try {
    return await relayHeld({ args, draft, home, prepared });
  } finally {
    lease.value.release();
  }
}

/**
 * The relay once this run holds the turn's lease: claim, keep the picture, register once, deliver once.
 *
 * @returns the process exit code
 */
async function relayHeld({
  args,
  draft,
  home,
  prepared,
}: {
  args: RelayArgs;
  draft: RelayDraft;
  home: string;
  prepared: PreparedRelayPicture;
}): Promise<number> {
  const dir = resolveHandoverDir({ dir: args.dir, home });
  const { heldLead, hold, standing } = relayHoldOf({ args, draft, home });
  const claim = claimTurn({ draft, home, nowIso: new Date().toISOString() });
  if (claim.isErr()) {
    logger.error({ msg: `talk relay: ${claim.error.message}` });
    return EXIT_ERROR;
  }
  // The picture is kept BEFORE the row names it, so no row ever points at a file that is not there. A crash
  // between the two leaves the file for this same turn's retry, which rewrites it only if its bytes match. A
  // REPLAY checks it too, before it reports or delivers: a kept file since removed is restored from the same
  // bytes (the digest bound them), and one since altered refuses the replay rather than naming it. A turn
  // claimed just now replaces whatever is at its path, because nothing there can be this turn's yet.
  const kept = persistRelayPicture({ claimedNow: claim.value.outcome === "claimed", prepared });
  if (kept.isErr()) {
    logger.error({ msg: `talk relay: ${kept.error.message}` });
    return EXIT_ERROR;
  }
  // Every later step names THIS run's picture, never the stored record's copy of it.
  const turn = withDraftPicture({ draft, record: claim.value.record });
  // Read BEFORE the row is registered, so the row's summary and the chair's line both open on what it found.
  const { also, disposition, governing, plan } = readRelayChannelPlan({ dir, draft, home, nowIso: turn.stagedAtIso });
  if (claim.value.outcome === "already-registered") {
    // A registered turn's row was given its offer before it was marked; this confirms it is still the exact one.
    if (!(await carryRelayOffer({ dir, draft, home }))) {
      return EXIT_ERROR;
    }
    const lead = chairLead({ heldLead, standing, steerLead: appendSteerLead({ hold, home, plan }) });
    const channel = { also, disposition, lead };
    return finishRelay({ args, channel, dir, draft, hold, home, record: turn, replayed: true });
  }
  const rowLead = joinedLead({
    first: discussFirstLead({ linked: true, standing }),
    second: joinedLead({ first: heldLead, second: rowSteerLead({ governing, hold, plan }) }),
  });
  const onBoard = await ensureRow({ args, dir, disposition, draft, home, lead: rowLead, record: turn });
  if (onBoard === undefined) {
    return EXIT_ERROR;
  }
  // After the row exists and before the turn is marked, so a crash between leaves it `registering` and the retry
  // appends the steer then.
  const lead = chairLead({ heldLead, standing, steerLead: appendSteerLead({ hold, home, plan }) });
  const marked = markRegistered({ home, nowIso: new Date().toISOString(), record: onBoard });
  if (marked.isErr()) {
    logger.error({ msg: `talk relay: ${marked.error.message}` });
    return EXIT_ERROR;
  }
  const channel = { also, disposition, lead };
  return finishRelay({ args, channel, dir, draft, hold, home, record: marked.value, replayed: false });
}

/**
 * Whether this relay's words may end before the owner did, the nudge's standing under that hold, and the line the
 * chair and the row open on when the hold keeps a card or a ruling from landing.
 *
 * @returns the hold, its standing and its lead
 */
function relayHoldOf({ args, draft, home }: { args: RelayArgs; draft: RelayDraft; home: string }): {
  heldLead: string | undefined;
  hold: string | undefined;
  standing: DiscussFirstStanding | undefined;
} {
  // Off the DRAFT, whose digest binds a stated end, so a replay of this turn cannot turn cut words whole.
  const hold = relayCutHold({ heardTailCut: draft.heardTailCut });
  const heldLead = relayHeldLead({
    cardKeys: heldCardKeys({ about: draft.about, alsoAnswers: draft.alsoAnswers }),
    hold,
    ruled: args.covers !== undefined || args.candidateVerdict !== undefined || args.triageRuling !== undefined,
  });
  return { heldLead, hold, standing: discussFirstStandingFor({ args, hold, home }) };
}

/**
 * What the relay may say about the nudge, an answer checked against the turn it names, or `undefined` when it names no
 * team fix. Read before the claim, so a replay states exactly what the first run did unless that turn's record changed.
 *
 * @param hold why this relay's words may end before the owner did, which holds an answer that would stand
 * @returns the standing
 */
function discussFirstStandingFor({
  args,
  hold,
  home,
}: {
  args: RelayArgs;
  hold: string | undefined;
  home: string;
}): DiscussFirstStanding | undefined {
  if (args.discussFirst === undefined) {
    return undefined;
  }
  return discussFirstStandingOf({
    hold,
    readPrior: ({ turnId }): PriorPutRead =>
      readTurn({ home, turnId }).match<PriorPutRead>(
        (prior) => ({ discussFirst: prior.discussFirst, kind: "read" }),
        () => ({ kind: "unreadable" }),
      ),
    record: args.discussFirst,
  });
}

/**
 * The lead the chair's line opens on: the discuss-first clause first, since it decides whether anything starts,
 * then that a relay made before the owner finished landed and ruled nothing, then what the relay's channel read found.
 *
 * @param heldLead the HELD clause (`../../../talk/relayCutHold.ts`), or `undefined`
 * @param steerLead the channel read's lead, or `undefined`
 * @returns the lead, or `undefined` when there is none
 */
function chairLead({
  heldLead,
  standing,
  steerLead,
}: {
  heldLead: string | undefined;
  standing: DiscussFirstStanding | undefined;
  steerLead: string | undefined;
}): string | undefined {
  return joinedLead({
    first: discussFirstLead({ linked: false, standing }),
    second: joinedLead({ first: heldLead, second: steerLead }),
  });
}

/**
 * What every relay does once its row is registered, a replay included: land their words on the cards they belong on,
 * record a ruling, type the line into the chair once, and report.
 *
 * @param channel whether their words land on the card on screen and on each card they also answer, and the lead the
 *   chair's line opens on
 * @param hold why the relay's words may end before the owner did, which holds every landing and ruling below
 * @param record the registered turn
 * @param replayed whether the turn was already registered before this run
 * @returns the process exit code
 */
async function finishRelay({
  args,
  channel,
  dir,
  draft,
  hold,
  home,
  record,
  replayed,
}: {
  args: RelayArgs;
  channel: {
    also: ReadonlyMap<string, RelayCardDisposition>;
    disposition: RelayCardDisposition;
    lead: string | undefined;
  };
  dir: string;
  draft: RelayDraft;
  hold: string | undefined;
  home: string;
  record: TurnRecord;
  replayed: boolean;
}): Promise<number> {
  const { also, disposition, lead } = channel;
  const decidedIso = record.stagedAtIso;
  await landRelayCards({ also, decidedIso, dir, disposition, draft, hold, home, workspace: args.workspace });
  const ruling = await recordRuling({
    args,
    draft,
    hold,
    home,
    ledger: autonomyLedgerPort(),
    nowIso: new Date().toISOString(),
  });
  const candidateRuling = await recordCandidateRuling({
    args,
    draft,
    hold,
    home,
    mintId: () => randomUUID(),
    nowIso: new Date().toISOString(),
    store: productionWorkstreamRegister(),
  });
  const delivered = await deliverOnce({ args, home, lead, record });
  printReport({ candidateRuling, json: args.json, record: delivered, replayed, ruling });
  return EXIT_OK;
}

/**
 * Check the picture, then form the draft that names it: a picture that fails its checks never reaches a draft.
 *
 * @returns the draft and the prepared picture it names, or the first check that failed
 */
function formRelay({
  args,
  home,
}: {
  args: RelayArgs;
  home: string;
}): Result<{ draft: RelayDraft; prepared: PreparedRelayPicture }, TalkError> {
  return prepareRelayPicture({
    home,
    screenFailed: args.screenFailed,
    screenNotTaken: args.screenNotTaken,
    screenRecordingOff: args.screenRecordingOff,
    sourcePath: args.screen,
    turnId: args.turn,
    typed: args.typed,
  }).andThen((prepared) =>
    readOfferedFlag({ offeredFile: args.offeredFile }).andThen((offered) =>
      formRelayDraft({
        about: args.about,
        alsoAnswers: args.alsoAnswers,
        candidateVerdict: args.candidateVerdict,
        discussFirst: args.discussFirst,
        heard: args.heard,
        heardTailCut: args.heardTailCut,
        offered,
        picture: prepared.picture,
        readsAfter: args.readAfter,
        say: args.say,
        triageRuling: args.triageRuling,
        turnId: args.turn,
        typed: args.typed,
        wordsAlone: args.wordsAlone,
        workspace: args.workspace,
      }).map((draft) => ({ draft, prepared })),
    ),
  );
}

/** Write the report's lines to stdout — the one effect `./relayReport.ts` leaves to the verb. */
function printReport({
  record,
  replayed,
  json,
  ruling,
  candidateRuling,
}: {
  record: TurnRecord;
  replayed: boolean;
  json: boolean;
  ruling: RulingOutcome | undefined;
  candidateRuling: CandidateRulingOutcome | undefined;
}): void {
  for (const line of relayReportLines({ candidateRuling, json, record, replayed, ruling })) {
    logger.out({ line });
  }
}

export const talkRelayCommand = defineCommand({ run: runTalkRelay });
