/**
 * The `talk relay` argv one parsed relay becomes — split from `site/app/api/talk/relay/route.ts` so every flag the
 * route hands the verb, a candidate ruling's included, is a unit test rather than a spawn. Pure.
 *
 * The owner's words are never in it: they go on the verb's stdin (`--heard-stdin`), because an argv value is bounded by
 * `getconf ARG_MAX` together with the whole inherited environment, and a stretch the route accepts must never be one
 * the spawn then refuses.
 */
import type { ParsedTalkRelay } from "./talkRelayRequestWire";

/** A steer is p1, the same as one typed into the Queue's steer box. */
const STEER_PRIORITY = "p1";

/** The verb's own spelling of the argv, for the spawn's log title — never the owner's words. */
export const TALK_RELAY_ARGV_TITLE =
  "slopweaver talk relay --turn <turnId> --heard-stdin [--heard-tail <cut|whole>] (--say <say> | --read-after <reads> | --words-alone) --about <key> [--also-answers <key>]... [--covers <rule|this>] [--candidate <id> --reaction <word>] [--triage <verdict> [--label <label>] [--feedback <feedback>]] [--workspace <w> --workspace-because <line>] [--discuss-first <put|override> --team-fix <owner/repo> [--fix-thread <url>] [--discuss-first-turn <turnId>]] [--offered-file <file>] --screen <file> --console-root <root> --console-port <n> --console-default-port <n> --priority p1 --deliver-to-supervisor --json";

/**
 * The verb's argv for one parsed relay, given where its picture and its copy-tray offer were written. The offer goes
 * as a FILE for the reason the owner's words go on stdin: up to 8,192 code points is no argv value.
 *
 * @param relay the parsed request
 * @param screenPath the picture's temp file, or `undefined` when none was attached
 * @param offeredPath the copy-tray offer's temp file, or `undefined` when the relay carries none
 * @param originArgv where the server is serving from (`./consoleOrigin.ts`), so the verb refuses a console that is not the owner's
 * @returns the argv after `slopweaver`
 */
export function talkRelayArgv({
  relay,
  screenPath,
  offeredPath,
  originArgv,
}: {
  relay: ParsedTalkRelay;
  screenPath: string | undefined;
  offeredPath: string | undefined;
  originArgv: readonly string[];
}): string[] {
  const argv = ["talk", "relay", "--turn", relay.turnId, "--heard-stdin"];
  if (relay.heardTail !== undefined) {
    argv.push("--heard-tail", relay.heardTail);
  }
  if (relay.wordsAlone) {
    argv.push("--words-alone");
  } else if (relay.say === undefined) {
    argv.push("--read-after", relay.readsAfter.join(","));
  } else {
    argv.push("--say", relay.say);
  }
  if (relay.about !== "") {
    argv.push("--about", relay.about);
  }
  for (const key of relay.alsoAnswers) {
    argv.push("--also-answers", key);
  }
  if (relay.covers !== undefined) {
    argv.push("--covers", relay.covers);
  }
  if (relay.candidateRuling !== undefined) {
    argv.push("--candidate", relay.candidateRuling.candidate, "--reaction", relay.candidateRuling.reaction);
  }
  if (relay.triageRuling !== undefined) {
    argv.push("--triage", relay.triageRuling.verdict);
    if (relay.triageRuling.label !== undefined) {
      argv.push("--label", relay.triageRuling.label);
    }
    if (relay.triageRuling.feedback !== undefined) {
      argv.push("--feedback", relay.triageRuling.feedback);
    }
  }
  if (relay.workspace !== undefined) {
    argv.push("--workspace", relay.workspace.workspace, "--workspace-because", relay.workspace.because);
  }
  if (relay.discussFirst !== undefined) {
    argv.push("--discuss-first", relay.discussFirst.status, "--team-fix", relay.discussFirst.repository);
    if (relay.discussFirst.thread !== undefined) {
      argv.push("--fix-thread", relay.discussFirst.thread);
    }
    if (relay.discussFirst.status === "override") {
      argv.push("--discuss-first-turn", relay.discussFirst.priorTurnId);
    }
  }
  if (offeredPath !== undefined) {
    argv.push("--offered-file", offeredPath);
  }
  if (screenPath !== undefined) {
    argv.push("--screen", screenPath);
  } else if (relay.screen.kind === "none" && relay.screen.reason === "capture-failed") {
    argv.push("--screen-failed");
  } else if (relay.screen.kind === "none" && relay.screen.reason === "not-taken-this-turn") {
    argv.push("--screen-not-taken");
  } else if (relay.screen.kind === "none" && relay.screen.reason === "screen-recording-off") {
    argv.push("--screen-recording-off");
  }
  argv.push(...originArgv, "--priority", STEER_PRIORITY, "--deliver-to-supervisor", "--json");
  return argv;
}
