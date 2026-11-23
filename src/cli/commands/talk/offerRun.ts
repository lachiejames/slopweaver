/**
 * `slopweaver talk offer` — what a Talk call is minted with. Every call rides the owner's ChatGPT plan, never platform.openai usage.
 *
 * It prints what the console launches `codex app-server` with and tells it — the thread, the realtime start, the
 * argv, the credentials to strip, and the `$CODEX_HOME` of the register row that pays — and reads no SDP: the
 * browser's offer goes to the app-server the console holds for the call (`site/lib/talkPlanLaunch.ts`).
 * `src/talk/planSession.ts` carries the measurement.
 *
 * Which row pays is the same decision a Codex seat takes (`src/codex/seatDecision.ts`: one plan
 * of either provider runs all of Slopweaver). That decision's bounded fleet read asks each Codex store for its
 * account and rate limits; it starts no model thread and no realtime session. No row may pay — paused, at the owner's
 * usage limit, monthly-spend, signed out, or none registered — and the verb refuses with that row's reason
 * (`src/talk/planRoute.ts`), never the ambient home.
 */
import { readFileSync, statSync } from "node:fs";

import { cachePaths } from "../../../cacheHome.js";
import type { CodexSeatRoute } from "../../../cmux/seatRoute.js";
import { decodeUpdateOutcome, openerAfterUpdate, updateOpenerLines } from "../../../desktop/updateOutcome.js";
import { logger } from "../../../lib/logger.js";
import { loadVoiceRuleBrief } from "../../../outbound/voice/briefStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { CONTINUITY_LOOKBACK_MS, type TalkContinuity, withStoredKnowledge } from "../../../talk/continuity.js";
import { newestSpokenOf } from "../../../talk/continuityCalls.js";
import { readContinuity, readTestCalls } from "../../../talk/continuityRead.js";
import { renderContinuity } from "../../../talk/continuityRender.js";
import { processAlive, readReopenProbe, reopenProbeArmed } from "../../../talk/e2eReopenProbe.js";
import { mintOpener } from "../../../talk/mintOpener.js";
import { type MintVoiceBrief, mintVoiceBriefOf } from "../../../talk/mintVoiceBrief.js";
import { planLaunchFacts, readMcpListLive } from "../../../talk/planLaunch.js";
import { talkPlanRefusal } from "../../../talk/planRoute.js";
import { planOfferComposition } from "../../../talk/planSession.js";
import { type ReopenReminder, reopenReminderFrom, reopenReminderOf } from "../../../talk/reopenReminder.js";
import { type PackAtMint, packForMint, packPastBound } from "../../../talk/storedPack.js";
import { decideTalkSeat } from "../../../talk/talkSeat.js";
import { type TypedConversation, typedConversationOf } from "../../../talk/typedConversation.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { type OfferArgs, parseOfferArgs, talkHomeOf } from "./args.js";
import { supervisorForContinuity } from "./supervisorRun.js";
import { TALK_OFFER_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "offer", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Run the `talk offer` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkOffer(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_OFFER_USAGE });
    return EXIT_OK;
  }
  const parsed = parseOfferArgs({ rest });
  if (parsed.isErr()) {
    logger.error({ msg: parsed.error.message });
    logger.error({ msg: TALK_OFFER_USAGE });
    return EXIT_USAGE;
  }
  return printPlanOffer({ args: parsed.value });
}

/**
 * The register row this call takes, through the same decision a Codex seat takes. No `--force` exists here, so a
 * pause, a usage limit and a monthly-spend row all hold; a refusal is printed here.
 *
 * @param home the state home whose plan register is read
 * @returns the routed seat, or undefined once the refusal is printed
 */
async function routeTalkCall({ home }: { home: string }): Promise<CodexSeatRoute | undefined> {
  const routed = await decideTalkSeat({ home, nowIso: new Date().toISOString() });
  if (routed.isErr()) {
    logger.error({ msg: `talk offer: ${talkPlanRefusal({ error: routed.error })}` });
    return undefined;
  }
  return routed.value;
}

/**
 * Resolve the vendored CLI and the owner's MCP servers, compose the call, print it. No provider is called.
 *
 * @param args the parsed arguments
 * @returns the process exit code
 */
async function printPlanOffer({ args }: { args: OfferArgs }): Promise<number> {
  const home = talkHomeOf({ home: args.home });
  // Routed FIRST, before any launch fact or the stored pack is read: a call no register row may pay for does
  // no other work.
  const routed = await routeTalkCall({ home });
  if (routed === undefined) {
    return EXIT_ERROR;
  }
  const { destination } = routed;
  const facts = planLaunchFacts({ codexHome: destination.codexHome, env: process.env, readMcpList: readMcpListLive });
  if (facts.isErr()) {
    logger.error({ msg: `talk offer: ${facts.error.message}` });
    return EXIT_ERROR;
  }
  const pack = storedPack({ home });
  const { block, continuity, continuityBlock, conversation } = await continuityAtMint({ home, pack });
  // Read fresh and ridden whatever the pack did, ahead of the continuity block's "everything below is DATA".
  const voiceBrief = mintVoiceBriefOf({ brief: loadVoiceRuleBrief({ home }) });
  const composition = planOfferComposition({
    codexHome: destination.codexHome,
    context: `${voiceBrief.block}\n\n${block}`,
    executable: facts.value.executable,
    mcpServers: facts.value.mcpServers,
    opener: openerAfterUpdate({
      lines: lastUpdateLines(),
      opener: mintOpener({ continuity, conversation, mode: args.mode }),
    }),
    planAlias: destination.alias,
    surface: args.typed ? "typed" : "voice",
    unsetEnv: facts.value.unsetEnv,
    voice: args.voice,
  });
  const report = {
    ...composition,
    continuity: continuityReport({ continuity, continuityBlock }),
    pack: packReport({ pack }),
    reopenReminder: reopenReminderAtMint({ args, continuity, home }),
    voiceBrief: voiceBriefReport({ voiceBrief }),
  };
  if (args.json) {
    logger.out({ line: JSON.stringify(report) });
    return EXIT_OK;
  }
  logger.out({
    line: `talk offer: plan-funded ${report.surface === "typed" ? "typed conversation" : `call on ${report.model} (voice ${report.voice})`}, through codex app-server`,
  });
  logger.out({ line: `  backend: ${report.backendModel}` });
  logger.out({ line: `  plan: ${destination.alias} (CODEX_HOME=${destination.codexHome}) — ${routed.why}` });
  logger.out({
    line: `  app-server: ${report.appServer.executable} (${String(facts.value.mcpServers.length)} MCP server(s) stubbed)`,
  });
  printCarried({ report });
  logger.out({ line: `  tools: ${report.tools.join(", ")}` });
  logger.out({ line: `  writers: ${report.writers.join(", ")}` });
  return EXIT_OK;
}

/**
 * The reminder this mint carries. A typed conversation has no opening silence to wait out, so only a call is ever a
 * reopen. A call the desktop test instance placed (`--test-instance e2e`) is none unless the `call-reopen` scenario
 * armed its window (`../../../talk/e2eReopenProbe.ts`), and then is judged against the test instance's OWN calls
 * alone, so a walk proves the real window and wording while nothing the owner said can reach it, and the owner's continuity never
 * sees a walk's call; every other call is judged against the owner's.
 *
 * @param args the parsed arguments
 * @param continuity the owner's read, whose `builtIso` is the mint's instant
 * @param home the state home
 * @returns the reminder, or `null`
 */
function reopenReminderAtMint({
  args,
  continuity,
  home,
}: {
  args: OfferArgs;
  continuity: TalkContinuity;
  home: string;
}): ReopenReminder | null {
  if (args.typed) {
    return null;
  }
  if (args.testInstance !== "e2e") {
    return reopenReminderOf({ continuity, mode: args.mode });
  }
  if (!reopenProbeArmed({ alive: processAlive, nowIso: continuity.builtIso, text: readReopenProbe({ home }) })) {
    return null;
  }
  const sinceIso = new Date(Date.parse(continuity.builtIso) - CONTINUITY_LOOKBACK_MS).toISOString();
  const test = readTestCalls({ home, sinceIso });
  return reopenReminderFrom({
    builtIso: continuity.builtIso,
    callsUnread: test.unread,
    last: newestSpokenOf({ calls: test.calls }),
    mode: args.mode,
  });
}

/**
 * What the last desktop update left (`slopweaver desktop update`), as the lines a call minted soon after it is told:
 * the call the app restarts after an update is the one the owner asks "what happened?". Nothing to tell — no record, an
 * unreadable one, or one too old — is no lines. The record is the machine's, under the cache root, not a home's.
 *
 * @returns the lines, or none
 */
function lastUpdateLines(): readonly string[] {
  let text: string;
  try {
    text = readFileSync(cachePaths().desktopLastUpdateJson, "utf8");
  } catch {
    return [];
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  const outcome = decodeUpdateOutcome({ value });
  if (outcome === undefined) {
    return [];
  }
  return updateOpenerLines({ nowMs: Date.now(), outcome });
}

/**
 * Where the last calls left off, read FRESH rather than taken from the stored pack: the pack is rebuilt once a
 * sweep, and the steer a call most needs is the one the previous call relayed minutes ago. Its lessons half opens the store, which costs seconds, so that half comes from the pack's own read.
 *
 * @param home the state home
 * @param pack the stored pack, whose lessons the read takes
 * @returns the read, the block it renders to, that block ahead of the pack's — what the delegated model gets — and
 *   what the owner typed since the owner's last call, which the voice itself is told
 */
async function continuityAtMint({ home, pack }: { home: string; pack: PackAtMint }): Promise<{
  block: string;
  continuity: TalkContinuity;
  continuityBlock: string;
  conversation: TypedConversation;
}> {
  const supervisor = supervisorForContinuity({ home });
  const continuity = withStoredKnowledge({
    fresh: await readContinuity({
      handoverDir: resolveHandoverDir({ dir: undefined, home }),
      home,
      knowledge: "skip",
      lookbackMs: CONTINUITY_LOOKBACK_MS,
      nowIso: new Date().toISOString(),
      supervisor,
    }),
    stored: pack.kind === "embedded" ? pack.lessons : undefined,
  });
  const conversation = typedConversationOf({
    continuity,
    window: typeof supervisor === "string" ? undefined : supervisor,
  });
  const continuityBlock = renderContinuity({ continuity });
  if (pack.kind === "embedded") {
    return { block: `${continuityBlock}\n\n${pack.block}`, continuity, continuityBlock, conversation };
  }
  return { block: continuityBlock, continuity, continuityBlock, conversation };
}

/**
 * What the report says of the continuity block. Always present: the block always rides, so the page's relay gate
 * treats it as data held from the start.
 *
 * @param continuity the read
 * @param continuityBlock the text it rendered to
 * @returns the report's continuity field
 */
function continuityReport({ continuity, continuityBlock }: { continuity: TalkContinuity; continuityBlock: string }): {
  bytes: number;
  steers: number;
  typed: number;
  unread: readonly string[];
} {
  return {
    bytes: Buffer.byteLength(continuityBlock, "utf8"),
    steers: continuity.steers.length,
    typed: continuity.typed.length,
    unread: continuity.unread.map((entry) => entry.section),
  };
}

/**
 * The context pack `talk pack --write` stored, as this mint will carry it. Read here rather than gathered,
 * because gathering composes the whole board and a call that waits for that to connect is the wait the pack
 * exists to remove (`./packRun.ts`).
 *
 * @param home the state home the pack is stored under
 * @returns the block to carry, or why none rides in
 */
function storedPack({ home }: { home: string }): PackAtMint {
  const path = stateHomePaths({ home }).talkPackJson;
  const nowIso = new Date().toISOString();
  // Stat before reading, and read only a regular file of a sane size: a FIFO at this path would block a
  // synchronous read forever, and this read sits in front of the mint.
  let size: number;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) {
      return { kind: "left-out", why: `${path} is not a regular file` };
    }
    size = stat.size;
  } catch {
    return packForMint({ nowIso, text: undefined });
  }
  const pastBound = packPastBound({ bytes: size, path });
  if (pastBound !== undefined) {
    return { kind: "left-out", why: pastBound };
  }
  try {
    return packForMint({ nowIso, text: readFileSync(path, "utf8") });
  } catch (cause) {
    return { kind: "left-out", why: `could not read ${path}: ${String(cause)}` };
  }
}

/**
 * What the offer report says about the pack: its age and size when it rode in, the reason when it did not.
 *
 * @param pack what the mint did with the pack
 * @returns the report's `pack` field
 */
function packReport({
  pack,
}: {
  pack: PackAtMint;
}): { builtIso: string; ageMinutes: number; bytes: number } | { leftOut: string } {
  if (pack.kind === "left-out") {
    return { leftOut: pack.why };
  }
  return { ageMinutes: pack.ageMinutes, builtIso: pack.builtIso, bytes: pack.bytes };
}

/**
 * What the offer report says of the owner's voice brief: which state and how big, never a word of it.
 *
 * @param voiceBrief what the mint did with the owner's voice rules
 * @returns the report's `voiceBrief` field
 */
function voiceBriefReport({ voiceBrief }: { voiceBrief: MintVoiceBrief }): {
  kind: MintVoiceBrief["kind"];
  bytes: number;
  why?: string;
} {
  const { bytes, kind } = voiceBrief;
  return voiceBrief.kind === "broken" ? { bytes, kind, why: voiceBrief.why } : { bytes, kind };
}

/**
 * The human-readable lines for what rides in at mint: the owner's voice brief, the context pack, where the last calls left
 * off, and the reminder a reopened call carries.
 */
function printCarried({
  report,
}: {
  report: {
    continuity: { bytes: number; steers: number; typed: number; unread: readonly string[] };
    pack: ReturnType<typeof packReport>;
    reopenReminder: { previousCallId: string; previousEndedIso: string } | null;
    voiceBrief: ReturnType<typeof voiceBriefReport>;
  };
}): void {
  const { voiceBrief } = report;
  if (voiceBrief.why !== undefined) {
    logger.out({ line: `  voice brief: NOT READ, any draft is unbriefed — ${voiceBrief.why}` });
  } else {
    logger.out({ line: `  voice brief: ${voiceBrief.kind}, ${String(voiceBrief.bytes)} bytes` });
  }
  if ("leftOut" in report.pack) {
    logger.out({ line: `  context pack: left out — ${report.pack.leftOut}` });
  } else {
    logger.out({
      line: `  context pack: ${String(report.pack.bytes)} bytes, built ${report.pack.builtIso} (${String(report.pack.ageMinutes)} min old)`,
    });
  }
  logger.out({
    line: `  where you left off: ${String(report.continuity.steers)} steer(s), ${String(report.continuity.typed)} typed turn(s), ${String(report.continuity.bytes)} bytes${report.continuity.unread.length === 0 ? "" : `, not read: ${report.continuity.unread.join(", ")}`}`,
  });
  if (report.reopenReminder !== null) {
    const { previousCallId, previousEndedIso } = report.reopenReminder;
    logger.out({ line: `  reopen: call ${previousCallId} ended ${previousEndedIso}, so a silent opening is reminded` });
  }
}

export const talkOfferCommand = defineCommand({ run: runTalkOffer });
