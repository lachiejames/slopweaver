/**
 * `slopweaver talk pack` — gather the console voice's context pack, and with `--write` keep it where
 * `talk offer` reads it at mint.
 *
 * What the pack holds and why is `src/talk/contextPack.ts`. This file is the reading: the board as
 * `handover list --json` composes it, cmux's workspace list, the pinned supervisor's transcript tail, the
 * base branch's recent commits, the owner's check-ins off the autonomy register, the card-landing ledger that dates a card
 * the owner's words took off the owner's Queue, and the lessons recorded since the
 * continuity window's floor (`src/talk/continuityRead.ts` — `talk offer` reads every other half of where the last
 * calls left off fresh at mint, so the lessons are the only half stored). A source that cannot be read is named in
 * the pack's `unread` list rather than left empty, so the voice says "I could not read the seats" instead of
 * "nothing is running". A pack past the mint's byte bound is refused rather than written.
 *
 * It is not run at mint, and that is measured rather than chosen: composing the board is the slow part —
 * `time slopweaver handover list --json` took 15.4s on 2,934 docs — and a call that waits
 * fifteen seconds to connect is the wait this pack exists to remove. So the console server keeps it fresh with
 * `--write --if-older-than` (`site/lib/packKeeper.ts`), the supervisor refreshes it on each sweep
 * (`skills/supervisor/reference/sweep-contract.md`), and `talk offer` reads the file.
 *
 * `--if-older-than` is the keeper's half: the age is decided here, so the console never parses the pack. A pack
 * older than its bound that stays the stored one means every call minted meanwhile rides with no pack at all. Repro: `jq -r .builtIso ~/.slopweaver/talk/pack.json`.
 */
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { type AutonomyLedgerPort, autonomyLedgerPort } from "../../../autonomy/port.js";
import { foldAutonomy } from "../../../autonomy/query.js";
import { logger } from "../../../lib/logger.js";
import { botSelfHandlesFromProfile } from "../../../profileStore.js";
import { listLiveCmuxWorkspaces } from "../../../sessionHarness/cmuxHost.js";
import { stateHomePaths } from "../../../stateHome.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { resolveTalkCheckout } from "../../../talk/checkout.js";
import {
  type PackLanding,
  type PackSeat,
  type PackTurn,
  type PackUnread,
  packForStorage,
  type TalkContextPack,
} from "../../../talk/contextPack.js";
import { CONTINUITY_LOOKBACK_MS, lessonsForStorage } from "../../../talk/continuity.js";
import { readContinuity } from "../../../talk/continuityRead.js";
import { installGlossary } from "../../../talk/glossary.js";
import { type PackCheckIn, packCheckInsOf } from "../../../talk/packCheckIns.js";
import { readLandingsSince } from "../../../talk/packLandings.js";
import { PACK_LOOKBACK_MS, withinLookback } from "../../../talk/packText.js";
import { packPastBound } from "../../../talk/storedPack.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { parsePackArgs, talkHomeOf } from "./args.js";
import { readAsks, readProofs } from "./packAsksRead.js";
import { storedPackStillFresh } from "./packFreshness.js";
import { readRecentlyLeft } from "./packRecentlyLeftRead.js";
import { readSupervisorWindow, supervisorForContinuity } from "./supervisorRun.js";
import { TALK_PACK_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "pack", ...]`. */
const VERB_ARG_OFFSET = 4;

/** How much of the supervisor conversation is read before the owner's last day of turns is picked out of it. */
const TURNS_READ_BYTES = 512 * 1024;

/** The ref whose commits are the landings when `--base` names none. */
const DEFAULT_BASE = "origin/main";

/**
 * The check-ins half: the owner's register folded, every card still waiting on the owner's word as a rule, each tagged from the
 * board row it was done under.
 *
 * @param home the state home the ledger answers for
 * @param ledger the autonomy ledger
 * @param tagsBySlug each board row's tags, or `undefined` when the board could not be read
 * @returns the check-ins, or why the ledger could not be read
 */
async function readCheckIns({
  home,
  ledger,
  tagsBySlug,
}: {
  home: string;
  ledger: AutonomyLedgerPort;
  tagsBySlug: ReadonlyMap<string, readonly string[]> | undefined;
}): Promise<readonly PackCheckIn[] | PackUnread> {
  // Whole, as `./checkInsRun.ts` is: the port refuses the read on one unreadable row, so the section goes unread
  // naming it rather than reading as nothing waiting on the owner.
  const records = await ledger.readRecords({ home });
  const actions = records.andThen((held) => foldAutonomy({ records: held }));
  if (actions.isErr()) {
    return { section: "checkIns", why: actions.error.message };
  }
  return packCheckInsOf({ actions: actions.value, tagsOf: ({ slug }) => tagsBySlug?.get(slug) });
}

/**
 * The seats half: every cmux workspace, one line each.
 *
 * @returns the seats, or why cmux could not be read
 */
async function readSeats(): Promise<readonly PackSeat[] | PackUnread> {
  const listed = await listLiveCmuxWorkspaces();
  if (listed.isErr()) {
    return { section: "seats", why: listed.error.message };
  }
  return listed.value.map((workspace) => ({
    directory: workspace.currentDirectory,
    lastAtIso: workspace.latestSubmittedAtIso,
    lastMessage: workspace.latestConversationMessage,
    pinned: workspace.pinned,
    ref: workspace.workspaceRef,
    title: workspace.title,
  }));
}

/**
 * The owner's half of the supervisor conversation over the last day, newest first.
 *
 * @param home the state home the chair is resolved from
 * @param nowIso the end of the look-back window
 * @returns the owner's turns and how far back the read reached, or why the transcript could not be read
 */
function readTurns({
  home,
  nowIso,
}: {
  home: string;
  nowIso: string;
}): { turns: readonly PackTurn[]; sinceIso: string | undefined } | PackUnread {
  const read = readSupervisorWindow({
    claudeHome: claudeHomeDir(),
    home,
    maxBytes: TURNS_READ_BYTES,
    session: undefined,
  });
  if (read.isErr()) {
    return { section: "turns", why: read.error.message };
  }
  const exchanges = read.value.exchanges;
  const turns = exchanges
    .filter((exchange) => exchange.who === "owner" && withinLookback({ atIso: exchange.atIso, nowIso }))
    .map((exchange) => ({ atIso: exchange.atIso, text: exchange.text, viaVoice: exchange.viaVoice }));
  // How far back the read reached is the oldest exchange it actually decoded — never the window's start, since
  // a tail of tool records alone, or a chair that began after the window opened, reaches nothing earlier.
  return { sinceIso: exchanges.at(-1)?.atIso, turns };
}

/**
 * The landings half: first-parent commits on the base ref over the last day.
 *
 * @param base the ref to read
 * @param nowIso the end of the look-back window
 * @returns the landings, or why git could not answer
 */
function readLandings({ base, nowIso }: { base: string; nowIso: string }): readonly PackLanding[] | PackUnread {
  const root = resolveTalkCheckout({ cwd: process.cwd() });
  if (root.isErr()) {
    return { section: "landings", why: root.error.message };
  }
  const sinceIso = new Date(Date.parse(nowIso) - PACK_LOOKBACK_MS).toISOString();
  const landings = readLandingsSince({ base, root: root.value, sinceIso });
  if (landings.isErr()) {
    return { section: "landings", why: landings.error.join("; ") };
  }
  return landings.value;
}

/**
 * Whether a half came back as the reason it could not be read.
 *
 * @param value what the half returned
 * @returns whether it is a {@link PackUnread}
 */
function isUnread(value: unknown): value is PackUnread {
  return typeof value === "object" && value !== null && "section" in value && "why" in value;
}

/**
 * Every half of the pack that could not be read, then the board docs the asks' scan skipped.
 *
 * @param halves each half as read: its value, or why it could not be
 * @param asks the asks half, which also names the docs its scan could not read
 * @returns the unread marks, in the halves' order
 */
function unreadHalves({
  halves,
  asks,
}: {
  halves: readonly unknown[];
  asks: { skipped: PackUnread | undefined } | PackUnread;
}): PackUnread[] {
  const unread = halves.filter((half) => isUnread(half));
  if (!isUnread(asks) && asks.skipped !== undefined) {
    unread.push(asks.skipped);
  }
  return unread;
}

/**
 * Gather the whole pack.
 *
 * @param home the state home
 * @param dir the board directory, when named
 * @param base the ref the landings are read from
 * @returns the pack, every unreadable half named in it
 */
export async function gatherContextPack({
  home,
  dir,
  base,
}: {
  home: string;
  dir: string | undefined;
  base: string;
}): Promise<TalkContextPack> {
  const builtIso = new Date().toISOString();
  const seats = await readSeats();
  const proofs = readProofs({ home });
  const asks = readAsks({ dir, home, proofs });
  const turns = readTurns({ home, nowIso: builtIso });
  const landings = readLandings({ base, nowIso: builtIso });
  const checkIns = await readCheckIns({
    home,
    ledger: autonomyLedgerPort(),
    tagsBySlug: isUnread(asks) ? undefined : asks.tagsBySlug,
  });
  const continuity = await readContinuity({
    handoverDir: resolveHandoverDir({ dir, home }),
    home,
    knowledge: "read",
    lookbackMs: CONTINUITY_LOOKBACK_MS,
    nowIso: builtIso,
    supervisor: supervisorForContinuity({ home }),
  });
  const recentlyLeft = readRecentlyLeft({ home, nowIso: builtIso, rows: isUnread(asks) ? undefined : asks.rows });
  const proofsUnread: PackUnread | undefined =
    proofs.kind === "unread" ? { section: "proofs", why: proofs.why } : undefined;
  const unread = unreadHalves({
    asks,
    halves: [seats, asks, turns, landings, checkIns, recentlyLeft.unread, proofsUnread],
  });
  return {
    asks: isUnread(asks) ? [] : asks.asks,
    boardObservedIso: isUnread(asks) ? undefined : asks.observedIso,
    builtIso,
    checkIns: isUnread(checkIns) ? [] : checkIns,
    lessons: lessonsForStorage({ continuity }),
    glossary: installGlossary({ botHandles: botSelfHandlesFromProfile({ home, reader: "talk pack" }) }),
    landings: isUnread(landings) ? [] : landings,
    recentlyLeft: recentlyLeft.left,
    seats: isUnread(seats) ? [] : seats,
    turns: isUnread(turns) ? [] : turns.turns,
    turnsSinceIso: isUnread(turns) ? undefined : turns.sinceIso,
    unread,
  };
}

/**
 * Run the `talk pack` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkPack(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_PACK_USAGE });
    return EXIT_OK;
  }
  const parsed = parsePackArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_PACK_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = talkHomeOf({ home: args.home });
  let base = DEFAULT_BASE;
  if (args.base !== undefined) {
    base = args.base;
  }
  if (storedPackStillFresh({ home, olderThanMinutes: args.ifOlderThanMinutes })) {
    return EXIT_OK;
  }
  const pack = packForStorage({ pack: await gatherContextPack({ base, dir: args.dir, home }) });
  const text = JSON.stringify(pack);
  if (args.write) {
    const path = stateHomePaths({ home }).talkPackJson;
    // A pack past the mint's bound is left out of every call, so writing it would only hide that it grew.
    const pastBound = packPastBound({ bytes: Buffer.byteLength(text, "utf8"), path });
    if (pastBound !== undefined) {
      logger.error({ msg: `talk pack: not written — ${pastBound}, so every call would leave it out` });
      return EXIT_ERROR;
    }
    try {
      writeFileAtomic({ contents: text, fileMode: 0o600, path });
    } catch (cause) {
      logger.error({ msg: `talk pack: could not write ${path}: ${String(cause)}` });
      return EXIT_ERROR;
    }
  }
  if (args.json) {
    logger.out({ line: text });
    return EXIT_OK;
  }
  logger.out({
    line: `talk pack: ${String(pack.asks.length)} ask(s), ${String(pack.seats.length)} seat(s), ${String(pack.turns.length)} turn(s), ${String(pack.landings.length)} landing(s), ${String(pack.checkIns?.length)} check-in rule(s), ${String(pack.recentlyLeft?.length)} card(s) recently off the owner's Queue, ${String(pack.lessons?.knowledge.length)} lesson(s), built ${pack.builtIso}`,
  });
  pack.unread.forEach((half) => {
    logger.out({ line: `  not read — ${half.section}: ${half.why}` });
  });
  if (args.write) {
    logger.out({ line: `  written to ${stateHomePaths({ home }).talkPackJson}` });
  }
  return EXIT_OK;
}

export const talkPackCommand = defineCommand({ run: runTalkPack });
