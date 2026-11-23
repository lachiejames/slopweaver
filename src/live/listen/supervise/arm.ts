/**
 * Composing the command a VISIBLE session runs to arm the listener. Pure — this module starts nothing.
 *
 * ## The listener is a child of the loop session, on purpose
 *
 * The rule: the Slack listener runs only while the live loop runs in a Claude session. That session holds one
 * shell process running the socket listener, and if the process is killed the session says something killed it
 * and the owner reruns it.
 *
 * So nothing here spawns the listener — an earlier draft of this module did exactly that, and "reparented to
 * launchd" is the no-daemon rule this repository set on purpose. What this module emits is a line the session
 * runs itself, and the two forms of that line do not have the same lifetime:
 *
 * - **The default, foreground form** runs inside the session's own shell call. It is not detached and not a
 *   session leader, so it lives as long as that call does.
 * - **The `background: true` form CAN OUTLIVE THE SHELL THAT LAUNCHED IT.** It ends in a bare `&`, and once
 *   the tool-call shell exits the job is reparented to PID 1 and keeps running. {@link armCommandLine} carries
 *   the measurement. Nothing in this module bounds that form's lifetime by the session's.
 *
 * A tag arriving when no loop session is running remains a no-op BY DESIGN, and that is the wanted behaviour
 * rather than the gap.
 *
 * What survives from that draft is everything that was actually about NOTICING: the heartbeat, the liveness
 * verdicts (including "process alive, socket dead", which a pidfile can never see), and the bounded re-arm
 * counter that stops rather than cycling. The session does the re-running; this code decides whether it
 * should, and hands over the exact command.
 *
 * ## Nothing started BESIDE the listener can be its watchdog
 *
 * A consequence of hosting the listener from the session's own shell, and the reason the deaths in `arms.jsonl` are RECONCILED rather than
 * watched. Measured: the Claude Code harness stopped the loop session's background tasks three times
 * in one day and each time took the listener AND the death-watch on it in the same
 * event, 7–10 ms apart — they were sibling background tasks of one session, so whatever reaped one reaped the
 * other. The journal ended the day with eight `armed` lines and zero deaths, which reads exactly like a stable
 * day.
 *
 * A different watchdog shape does not fix that: rule 2 permits a process only as a child of a visible
 * session, so every process this repository may legally start is in the class that gets reaped. So death
 * accounting does not depend on anything being alive at the moment of death — `slopweaver listen reconcile`
 * derives deaths from the heartbeat and the journal afterwards, from any session, at any later time. See
 * `./reconcile.ts`.
 *
 * ## Why the listener registers ITSELF
 *
 * Nothing here writes the arm record either. The listener does, from inside its own process, on startup —
 * see `../../../cli/commands/listen/run.ts`. That is not a stylistic choice: measured, the bundled
 * launcher `exec`s `tsx` and `tsx` then FORKS the process that opens the socket, so a pid captured by
 * whoever started the command is the launcher's, not the listener's. Self-registration is the only way the
 * recorded pid and the heartbeat's pid are the same process.
 */
import { dirname } from "node:path";

import { type ListenScope, scopeArgs } from "../scope.js";
import { threadReplyArgs } from "../threadReply.js";

/**
 * The argv a supervised listener is started with. `--follow` is not optional here: a supervised one-shot
 * would be re-armed forever by its own supervisor.
 *
 * @param armId the arm id the listener stamps its self-registration and every heartbeat with
 * @param home the Slopweaver home to pass through, or `undefined` to let the listener resolve its own
 * @param queuePath the durable JSONL capture path, or `undefined` for none
 * @param scope the conversations the listener acts on — carried onto the line, or a scoped arm's re-arm
 *   would go live everywhere
 * @param threadReplyChannels the conversations a reply under one of the bot's own posts is an address in —
 *   carried for the same reason the scope is, in the other direction: an arm that dropped it would take the
 *   feature away from a channel somebody had switched it on for, and nothing would say so
 * @returns the arguments after the launcher itself
 */
export function listenerArgs({
  armId,
  home,
  queuePath,
  scope,
  threadReplyChannels,
}: {
  armId: string;
  home: string | undefined;
  queuePath: string | undefined;
  scope: ListenScope;
  threadReplyChannels: readonly string[];
}): readonly string[] {
  return [
    "listen",
    "--follow",
    "--heartbeat",
    armId,
    ...scopeArgs({ scope }),
    ...threadReplyArgs({ channels: threadReplyChannels }),
    ...(queuePath === undefined ? [] : ["--queue", queuePath]),
    ...(home === undefined ? [] : ["--home", home]),
  ];
}

/**
 * The one shell line a visible session runs to arm the listener.
 *
 * ## Foreground by default
 *
 * The listener runs as one long-lived FOREGROUND shell call inside whichever session runs the live loop, so
 * that is what this emits by default: the bare invocation, output going wherever the session's own call
 * sends it. Nothing is backgrounded, nothing is detached.
 *
 * One measured caveat the caller should know, because it decides nothing here but changes what a session
 * should expect: in Claude Code a foreground Bash call that outlives its timeout is **moved to a
 * harness-tracked background task** rather than killed (observed three times in one session, running
 * `yarn lint` and `yarn typecheck`), and that ceiling is 600 seconds. So a listener meant to run for hours
 * becomes a background task within ten minutes whichever way it starts. Foreground is not a different
 * lifetime; it is the same one reached more slowly — which is exactly why the answer to a dying socket is a
 * death-watch rather than a better way to host it.
 *
 * ## `background: true`
 *
 * For a session that wants its shell back, this appends a bare `&` and redirects — a bare `&` with NOTHING
 * else. No `nohup`, no `setsid`, no `disown`: each buys nothing here, and typing one makes the next reader
 * believe in a protection that is not there.
 *
 * **It does not keep the listener a child of the session, and this comment used to say it did.** MEASURED
 * on darwin, two tool calls apart: a bare `&` job reported its tool-call shell as its ppid and
 * had **ppid 1** by the next call, the shell gone. That is the same class `docs/listener-supervision/failure-and-evidence.md`
 * measured for this listener, and its conclusion is the one that holds: what the listener
 * needs is not immortality but for its death to be NOTICED, which is what `listen supervise` is. The claim
 * that an operator choice keeps it parented was never true of any of them.
 *
 * **The two streams are redirected to two different files, never merged.** `skills/loop/SKILL.md` requires it in
 * as many words — *"Never redirect stderr into stdout for this command (no `2>&1`), and never watch anything
 * but stdout"* — because stdout is pure JSONL, one admitted mention per line, and that line is what the loop
 * wakes on. An earlier revision of this function emitted `2>&1`, which merged narration into the trigger
 * stream and left the loop with nothing safe to watch. "Watch the durable `--queue` copy instead" is not the
 * escape it looks like: AGENTS.md rule 2 makes that copy explicitly NOT a trigger path.
 *
 * A FRESH pair of files per arm is what makes `lsof` or a `tail` mean anything. Measured: a re-armed listener
 * appending to its predecessor's log left `tail` showing "connected to Slack over Socket Mode" from a process
 * that no longer existed. The line creates its own directory, which keeps `listen arm` free of every side
 * effect and lets a command saved from an earlier tick still work.
 *
 * @param args the listener's own arguments
 * @param background whether to background the call and redirect the two streams
 * @param command the launcher to run
 * @param logPath where STDERR goes — the arm's narration, and the evidence kept when it dies
 * @param mentionsPath where STDOUT goes — pure JSONL, the stream the loop watches
 * @returns the shell line, ready to run in the session's own shell
 */
export function armCommandLine({
  args,
  background,
  command,
  logPath,
  mentionsPath,
}: {
  args: readonly string[];
  background: boolean;
  command: string;
  logPath: string;
  mentionsPath: string;
}): string {
  const invocation = `${command} ${args.join(" ")}`;
  if (!background) {
    return invocation;
  }
  return `mkdir -p ${dirname(logPath)} && ${invocation} >> ${mentionsPath} 2> ${logPath} &`;
}
