/**
 * The bot-turn live-write guard: refuse a Bash or Monitor command that runs a migration or writes to a live
 * system when the session running it is a bot turn.
 *
 * The rule: the bot never runs a migration, nor takes an action on staging or prod, unless the owner
 * explicitly asks it to. The case it was built for: an engineer asks the bot about a failed deployment, the investigation
 * finds the fix is a production migration rerun, and the bot posts the diagnosis without running it.
 *
 * ## The order, and why each step is where it is
 *
 * 1. Classify the command first (`./liveWrite.ts`, pure). Nearly every call is a read, and a read never
 *    touches the state home — this row runs ahead of `admit` on every shell call on the machine.
 * 2. Ask whether this session is a bot turn (`./botTurnAsk.ts`). A fleet seat, the supervisor and the owner's own
 *    sessions are not, and the guard says nothing to them: the ruling is about the bot.
 * 3. The hatch opens ONLY when every ask this session holds is the owner's. Another person's ask is a HOLD with no
 *    hatch at all — the owner's rule, carried into the row: the explicit ask must be the owner's own, and another
 *    person's request never opens it. A profile naming no owner is the same hold: the exception cannot be
 *    proved, so it is not taken.
 *
 * The code cannot tell whether the owner's words asked for EXACTLY this command; the variable is the session's
 * attestation that they did, and the loop-bot rule says when to give it. Ahead of `admit` on purpose: the
 * generic raw-tool refusal would otherwise answer first and offer `SLOPWEAVER_ALLOW_RAW` or a reach grant,
 * neither of which this ruling lets a bot turn use.
 */
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { slopweaverHomeOf } from "../homeDir.js";
import { ownerUserIdFromProfile } from "../profileStore.js";
import { readShellSessionCommand } from "./bashToolCommandPayload.js";
import { type BotTurnAsk, botTurnAskForSession } from "./botTurnAsk.js";
import { classifyLiveWrite } from "./liveWrite.js";
import type { LiveWriteFinding } from "./liveWriteTypes.js";
import { EXIT_ALLOW, EXIT_BLOCK } from "./preToolUseDispatch.js";
import { hasInlineEnvironmentOverride } from "./shellSegments.js";

/**
 * What the turn does instead, on every refusal — the safe lane the owner named. It names no waiting flow: whether a
 * write ask waits on the owner is the board row on write asks waiting visibly in the thread's to decide, and any go-ahead
 * still opens this guard only as an ask the owner tags the bot with personally.
 */
const INSTEAD =
  "Instead: post the diagnosis — what failed, why, and the exact command a person with access would run — and " +
  "do not offer to run it. Only an ask the owner tags the bot with personally opens this; another person's ask, or a " +
  "go-ahead recorded on it, does not.";

/**
 * The refusal for one finding, worded for who asked: the owner's own ask names the hatch; anyone else's is a hold with
 * none, and says so.
 *
 * @internal — {@link runBotLiveWriteGuard} is this module's public surface; exported for its own unit test.
 * @param finding what the classifier found, and the segment it sits in
 * @param asks every ask this session is the dispatched worker for
 * @param ownerUserId the owner's Slack user id from the profile, or `null` when it declares none
 * @returns the refusal text, newline-joined
 */
export function botLiveWriteRefusal({
  finding,
  asks,
  ownerUserId,
}: {
  finding: LiveWriteFinding & { readonly segment: string };
  asks: readonly [BotTurnAsk, ...BotTurnAsk[]];
  ownerUserId: string | null;
}): string {
  const hatch = hatchFor({ id: "bot-live-write" });
  const what = finding.kind === "migration" ? "runs a migration" : "writes to a live system";
  const detail = `\`${finding.segment.slice(0, 120)}\` ${what} — ${finding.tool} ${finding.operation}`;
  const others = asks.filter((ask) => ask.askerUserId !== ownerUserId).map((ask) => `<@${ask.askerUserId}>`);
  if (ownerUserId !== null && others.length === 0) {
    return [hatchRefusal({ detail, hatch }), INSTEAD].join("\n");
  }
  const whose =
    ownerUserId === null
      ? "the profile names no owner, so whether the owner asked cannot be checked"
      : `this turn was asked by ${others.join(", ")}, not the owner`;
  return [
    `${hatch.command} held because ${hatch.caught} (${detail}).`,
    `This hold has no escape hatch on this turn: ${whose}.`,
    INSTEAD,
  ].join("\n");
}

/**
 * The hold when the bot-turn state is there but unreadable, so whose turn this is cannot be told. No hatch: a
 * hatch would open it for a colleague's turn too, and the fix — read access, or a torn line repaired — names itself.
 *
 * @param finding what the classifier found, and the segment it sits in
 * @param what the state file, or the ask-log line, that exists and could not be read
 * @returns the hold text, newline-joined
 */
function botTurnStateUnreadableHold({
  finding,
  what,
}: {
  finding: LiveWriteFinding & { readonly segment: string };
  what: string;
}): string {
  const hatch = hatchFor({ id: "bot-live-write" });
  return [
    `${hatch.command} held because \`${finding.segment.slice(0, 120)}\` is ${finding.tool} ${finding.operation}, ` +
      `and whether this session is a bot turn cannot be told: ${what} exists but cannot be read.`,
    `This hold has no escape hatch: make that state readable, then re-run.`,
    INSTEAD,
  ].join("\n");
}

/**
 * Run the guard over one `PreToolUse` payload.
 *
 * @param readStdin reads the raw payload
 * @param writeError writes the refusal (stderr in production)
 * @param env the hook process's environment — the hatch and the state home are read from it
 * @returns the exit code (2 refuse, 0 allow)
 */
export async function runBotLiveWriteGuard({
  env,
  readStdin,
  writeError,
}: {
  env: Readonly<Record<string, string | undefined>>;
  readStdin: () => Promise<string>;
  writeError: (line: string) => void;
}): Promise<number> {
  const call = await readShellSessionCommand({ readStdin });
  if (call === undefined) return EXIT_ALLOW;
  const verdict = classifyLiveWrite({ command: call.command });
  if (verdict.kind === "allowed") return EXIT_ALLOW;
  const home = slopweaverHomeOf({ env });
  const match = botTurnAskForSession({ home, sessionId: call.sessionId });
  if (match.kind === "not-bot-turn") return EXIT_ALLOW;
  if (match.kind === "unreadable") {
    writeError(`${botTurnStateUnreadableHold({ finding: verdict, what: match.what })}\n`);
    return EXIT_BLOCK;
  }
  const ownerUserId = ownerUserIdFromProfile({ home });
  const ownerAsk = ownerUserId !== null && match.asks.every((ask) => ask.askerUserId === ownerUserId);
  // Spelled out rather than derived, because the `escape-hatch` gate joins the row to this reader by the key.
  // The inline read is the shared helper every hatch uses; it reads `export X=1 X=0` as open.
  // Reaching that takes the session spelling the hatch itself, and only on the OWNER's ask, which opens it.
  const hatchName = "SLOPWEAVER_ALLOW_BOT_LIVE_WRITE";
  const opened = env[hatchName] === "1" || hasInlineEnvironmentOverride({ command: call.command, name: hatchName });
  if (ownerAsk && opened) return EXIT_ALLOW;
  writeError(`${botLiveWriteRefusal({ asks: match.asks, finding: verdict, ownerUserId })}\n`);
  return EXIT_BLOCK;
}
