/**
 * The pure decision behind the hook-level half of the cmux-send-into-the-supervisor refusal: given a raw
 * shell command line and who is recorded as holding the supervisor pin, decide whether the command names
 * `slopweaver cmux send --workspace <the pinned supervisor>` and, if so, whether the CALLER is that same
 * session. The console voice's sender, `slopweaver talk relay --deliver-to-supervisor`, types into the same
 * box and is refused here on the same terms ({@link talkRelayRefusalMessage}), and so are the chair's wake, `slopweaver
 * talk wake-chair` ({@link talkWakeChairRefusalMessage}), and the relay courier, `slopweaver talk courier`
 * ({@link talkCourierRefusalMessage}), which only the pinned chair itself runs.
 *
 * Text-matched against the recorded pin file (`../sessions/supervisorPinStore.ts`), never a live `cmux list
 * --json` round trip — same reasoning as `../sessions/supervisorPin.ts`'s own header: a `PreToolUse` hook
 * runs on every `Bash` call and cannot afford a socket hop, nor block on a transport that is allowed to be
 * down. `../cli/commands/cmux/send.ts` still resolves the target LIVE and carries the same refusal — this is
 * the shell-level trip-wire that fires before that verb's own process even starts, so a session that shells
 * out to the governed verb gets the same answer without either side paying for it twice. Every message here
 * is `../cmux/supervisorWorkspace.ts`'s `supervisorSendRefusalMessage`, so a session sees one wording
 * whichever door it tried.
 *
 * A RAW `cmux send` (bypassing `slopweaver` entirely) is a different gap, already closed: `./rawTools.ts`'s
 * classifier blocks every raw `cmux` subcommand by default, targeted or not.
 */
import { supervisorSendRefusalMessage } from "../cmux/supervisorWorkspace.js";
import { isRegisteredSupervisor, type SupervisorPinRecord } from "../sessions/supervisorPin.js";
import { stripEnvPrefix, toolName } from "./commandTokens.js";
import { shellSegments } from "./shellSegments.js";

/**
 * The refusal for a session shelling out to the console voice's sender.
 *
 * @param workspaceRef the pinned supervisor's workspace ref
 * @returns the message the hook prints
 */
export function talkRelayRefusalMessage({ workspaceRef }: { workspaceRef: string }): string {
  return (
    `${workspaceRef} is the pinned supervisor workspace — the box the owner types into, and ` +
    "`talk relay --deliver-to-supervisor` types there as the owner's turn. Only the console's two relay routes run it — " +
    "the voice's, after its gate heard the owner speak, and the steer composer's, with what the owner typed. Drop the flag to leave only the board row, or report with SendMessage."
  );
}

/**
 * `talk relay`, then the flag, anywhere in one segment, in any case, whatever launches it. Deliberately not
 * anchored to how the CLI is named: the fallback review got past a name or entry-file match with
 * `bin/Slopweaver` (a case-insensitive disk), `tsx src/cli`, `tsx src/cli/index` and a `cd` into `src/cli`
 * before `tsx index.ts`. The verb's two words and the flag are the one thing every route must spell.
 */
const TALK_RELAY_DELIVERY = /\btalk\s+relay\b.*--deliver-to-supervisor\b/isu;

/**
 * Whether one segment runs `slopweaver talk relay … --deliver-to-supervisor` — the console voice's sender,
 * which types into the pinned supervisor's chat. Only the console's own relay route runs it, after the page's
 * gate; a session reaching it from a shell would type its own words into the owner's box, the exact harm `cmux
 * send` is refused for, so it gets the same refusal.
 *
 * Matched on the segment's TEXT with every quote and backslash removed, not on its first token: review
 * passes r1 to r3 of this branch ran the verb past a token match through quoting, `bash -c`, `yarn`, `node`,
 * `tsx` and the entry file spelled four ways. A `grep` for the flag alone never says `talk relay`, so
 * reading about the verb is not refused; a commit message quoting the whole command is, which a tripwire
 * can afford. The residue is what only a session deliberately dodging the guard writes — a flag or a verb
 * assembled at run time (`$F`, `xargs`, `$'\x2d…'`) — and a session that runs the verb on the real home
 * leaves a record no reader can tell from the console's: nothing a same-user shell can reach authenticates a
 * caller here. So this is a tripwire, like `cmux send`'s, and says so.
 *
 * @param text one shell segment, as written
 * @returns whether this segment asks `talk relay` to type into the supervisor
 */
function isTalkRelayDelivery({ text }: { text: string }): boolean {
  return TALK_RELAY_DELIVERY.test(text.replaceAll(/["'\\]/gu, ""));
}

/** `talk wake-chair`, anywhere in one segment, however launched — matched the way {@link TALK_RELAY_DELIVERY} is. */
const TALK_WAKE_CHAIR = /\btalk\s+wake-chair\b/isu;

/** A flag that makes `talk wake-chair` type nothing. */
const WAKE_CHAIR_INERT = /--dry-run\b|--help\b|(?:^|\s)-h\b/u;

/**
 * Whether one segment runs `slopweaver talk wake-chair` in the shape that types into the pinned chair — no
 * `--dry-run`, no `--help`. The line it types is fixed and carries no words (`../talk/chairWake.ts`), so a session
 * reaching it cannot put its words in the owner's box; it can still type into the box the owner types into, which only the
 * console's transcript route does on purpose. Same tripwire as {@link isTalkRelayDelivery}, same residue.
 *
 * @param text one shell segment, as written
 * @returns whether this segment would type a wake
 */
function isTalkWakeChair({ text }: { text: string }): boolean {
  const plain = text.replaceAll(/["'\\]/gu, "");
  return TALK_WAKE_CHAIR.test(plain) && !WAKE_CHAIR_INERT.test(plain);
}

/**
 * The refusal for a session shelling out to the chair's wake.
 *
 * @param workspaceRef the pinned supervisor's workspace ref
 * @returns the message the hook prints
 */
export function talkWakeChairRefusalMessage({ workspaceRef }: { workspaceRef: string }): string {
  return (
    `${workspaceRef} is the pinned supervisor workspace — the box the owner types into, and \`talk wake-chair\` ` +
    "types a wake there. Only the console's transcript route runs it, after a finished stretch of the owner's speech lands. Add " +
    "--dry-run to see what it would type, or report with SendMessage."
  );
}

/** `talk courier`, anywhere in one segment, however launched — matched the way {@link TALK_RELAY_DELIVERY} is. */
const TALK_COURIER = /\btalk\s+courier\b/isu;

/** A flag that makes `talk courier` print its usage and type nothing. */
const COURIER_INERT = /--help\b|(?:^|\s)-h\b/u;

/**
 * Whether one segment runs `slopweaver talk courier` in a shape that may type a relay into the pinned chair.
 *
 * @param text one shell segment, as written
 * @returns whether it runs the courier
 */
function isTalkCourier({ text }: { text: string }): boolean {
  const plain = text.replaceAll(/["'\\]/gu, "");
  return TALK_COURIER.test(plain) && !COURIER_INERT.test(plain);
}

/**
 * The refusal for a session other than the pinned chair starting the relay courier.
 *
 * @param workspaceRef the pinned supervisor's workspace ref
 * @returns the message the hook prints
 */
export function talkCourierRefusalMessage({ workspaceRef }: { workspaceRef: string }): string {
  return (
    `${workspaceRef} is the pinned supervisor workspace — the box the owner types into, and \`talk courier\` types ` +
    "voice relays there that a console outside cmux could not. Only the pinned chair runs it, as a background task. " +
    "Read what it would take with `slopweaver talk log --json`, or report with SendMessage."
  );
}

/**
 * The refusal for one segment that runs a verb only the console or the chair may run into the pinned chair — the
 * relay's delivery, the chair's wake or the relay courier — or `undefined` when it runs none of them.
 *
 * @param text one shell segment, as written
 * @param workspaceRef the pinned supervisor's workspace ref, named in the refusal
 * @returns the refusal message, or `undefined`
 */
function consoleVerbRefusal({ text, workspaceRef }: { text: string; workspaceRef: string }): string | undefined {
  if (isTalkRelayDelivery({ text })) {
    return talkRelayRefusalMessage({ workspaceRef });
  }
  if (isTalkWakeChair({ text })) {
    return talkWakeChairRefusalMessage({ workspaceRef });
  }
  if (isTalkCourier({ text })) {
    return talkCourierRefusalMessage({ workspaceRef });
  }
  return undefined;
}

/**
 * Whether one segment's tokens are a `slopweaver cmux send` invocation. Basename-matched on the first token,
 * same as every other guard here, so an absolute path to `bin/slopweaver` and a bare `slopweaver` are the
 * same call.
 *
 * @param tokens the segment's whitespace-split tokens, env prefix already stripped
 * @returns whether this segment invokes `cmux send`
 */
function isCmuxSendInvocation({ tokens }: { tokens: readonly string[] }): boolean {
  const first = tokens[0];
  if (first === undefined) {
    return false;
  }
  return toolName({ first }) === "slopweaver" && tokens[1] === "cmux" && tokens[2] === "send";
}

/**
 * The `--workspace <value>` / `--workspace=<value>` a `cmux send` segment names, or `undefined` when it
 * names none.
 *
 * @param tokens the tokens FOLLOWING `cmux send` in the segment
 * @returns the flag's value, or `undefined`
 */
function workspaceFlagValue({ tokens }: { tokens: readonly string[] }): string | undefined {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!; // index < tokens.length ⇒ in-bounds
    if (token === "--workspace") {
      return tokens[index + 1];
    }
    const inline = /^--workspace=(.+)$/.exec(token);
    if (inline !== null) {
      return inline[1];
    }
  }
  return undefined;
}

/**
 * Whether a ref/id names the recorded supervisor pin's own workspace — matched against BOTH the ref
 * (`workspace:936`) and the raw id, since a caller may spell either.
 *
 * @param ref the `--workspace` value a command named
 * @param pin the recorded supervisor pin
 * @returns whether `ref` names the pinned workspace
 */
function namesSupervisorWorkspace({ ref, pin }: { ref: string; pin: SupervisorPinRecord }): boolean {
  return ref === pin.workspaceRef || ref === pin.workspaceId;
}

/**
 * Decide one `Bash` command against the recorded supervisor pin.
 *
 * INERT when nothing is registered — same failure-open reasoning as every guard built on
 * `../sessions/supervisorPin.ts`: being unregistered can only ever make this guard do nothing, never block
 * the wrong session.
 *
 * @param command the raw shell command line
 * @param pin the recorded supervisor pin, or `undefined` when none is registered
 * @param callerSessionId the calling Claude session's own id, from the hook payload
 * @returns the refusal message, or `undefined` to allow
 */
export function cmuxSendSupervisorRefusal({
  command,
  pin,
  callerSessionId,
}: {
  command: string;
  pin: SupervisorPinRecord | undefined;
  callerSessionId: string;
}): string | undefined {
  if (pin === undefined) {
    return undefined;
  }
  // The pinned supervisor reaching its own workspace is not the reach this guards against.
  const callerIsPinned = isRegisteredSupervisor({ record: pin, session: { host: "claude-code", id: callerSessionId } });
  for (const segment of shellSegments({ command })) {
    const tokens = stripEnvPrefix({
      tokens: segment.command
        .trim()
        .split(/\s+/)
        .filter((token) => token.length > 0),
    });
    const consoleRefusal = consoleVerbRefusal({ text: segment.command, workspaceRef: pin.workspaceRef });
    if (consoleRefusal !== undefined && !callerIsPinned) {
      return consoleRefusal;
    }
    if (!isCmuxSendInvocation({ tokens })) {
      continue;
    }
    const ref = workspaceFlagValue({ tokens: tokens.slice(3) });
    if (ref === undefined || !namesSupervisorWorkspace({ pin, ref }) || callerIsPinned) {
      continue;
    }
    return supervisorSendRefusalMessage({ workspaceRef: pin.workspaceRef });
  }
  return undefined;
}
