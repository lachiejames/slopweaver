/**
 * `slopweaver slack voice-rules` — the effectful shell: read `profile.json` and the response-shape memory it
 * points at, print the brief, then write this visible session's receipt for it — a digest, never a word of the
 * brief — which every as-me draft and send checks (`../../../outbound/voice/briefingAdmission.ts`). `--check-stdin`
 * prints no brief and writes no receipt, and neither does `--json`: the receipt's digest is of the rendered text brief.
 *
 * This is the pre-briefing half of the fix described in `../../../outbound/voice/composerBrief.ts`: the
 * `--as me` gate (`./dripSourceAssessment.ts`) already refuses authored prose that matches an exact rule, but only after
 * the composer has drafted it. Running this FIRST — before drafting anything — is what turns that refusal
 * from routine into rare, and since the brief carries the operator's response SHAPE as well as their banned
 * vocabulary, it is also what makes the three skills promising "the operator's full voice guidance" resolve
 * to something that is actually full.
 *
 * A configured-but-broken source FAILS rather than degrading. `../../../outbound/voice/briefStore.ts`'s
 * header says why: a brief that quietly omits rules it could not read tells a composer it may write freely,
 * and the send door then refuses it on rules it was told did not exist.
 *
 * `--check-stdin` judges one message instead of printing the brief: the talk console's running list pipes every offer
 * through it (`site/app/api/talk/copy-voice/route.ts`), so words they paste themselves meet the same rules a send does,
 * and `--slack-draft` holds a Slack message to the shape `slack draft record --as me` parks, plus the tray's own refusal
 * of one dense paragraph.
 */
import { logger } from "../../../lib/logger.js";
import { readStdin } from "../../../lib/readStdin.js";
import type { Result } from "../../../lib/result.js";
import { recordVoiceBriefing } from "../../../outbound/voice/briefingAdmission.js";
import { loadExactVoiceRules, loadVoiceRuleBrief, type VoiceRuleBrief } from "../../../outbound/voice/briefStore.js";
import { voiceRuleBriefLines } from "../../../outbound/voice/composerBrief.js";
import { copyVoiceVerdict } from "../../../outbound/voice/copyVerdict.js";
import type { ExactVoiceRule } from "../../../outbound/voice/exactRules.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { slackArgumentErrorLines } from "./argumentErrors.js";
import { SLACK_VOICE_RULES_USAGE } from "./verbUsage.js";
import { parseSlackVoiceRulesArgs } from "./voiceRulesCore.js";

/** The argv index the `slack <verb>` tail starts at — past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The injected edges, so the shell is testable with plain fakes and no filesystem. */
export interface SlackVoiceRulesDeps {
  readonly loadBrief: (args: { home: string }) => Result<VoiceRuleBrief>;
  /** The exact rules alone, for `--check-stdin` — a broken shape file must not stop a rule being applied. */
  readonly loadExactRules: (args: { home: string }) => Result<readonly ExactVoiceRule[]>;
  /** The whole message `--check-stdin` judges, read off stdin so it never appears in argv or `ps`. */
  readonly readStdin: () => Promise<string>;
  readonly writeOut: (line: string) => void;
  /**
   * Record that this session was just shown the whole brief (`../../../outbound/voice/briefingAdmission.ts`), so its
   * as-me drafts are admitted. `no-session` when no single visible session can be named.
   */
  readonly recordBriefing: (args: { brief: VoiceRuleBrief; home: string }) => Result<"recorded" | "no-session">;
}

/**
 * `--check-stdin`: judge the message on stdin against the `me`-lane exact rules and print the verdict. A broken
 * rule is a successful read whose verdict is `refused`; only an unreadable profile fails, printing no verdict, so
 * a caller can never read "no rules" off a profile nobody could parse. The message itself is never printed, logged
 * or recorded: only the rule and the line it broke leave this function.
 *
 * With `slackDraft`, the message is one they will post in Slack as themselves, so the earns-its-place shape and the
 * per-paragraph word cap bind it too (`../../../outbound/voice/copyVerdict.ts`).
 *
 * @param deps the injected edges
 * @param home the Slopweaver home holding `profile.json`
 * @param slackDraft true for a Slack message as them (`--slack-draft`)
 * @returns the process exit code
 */
async function runVoiceCheck({
  deps,
  home,
  slackDraft,
}: {
  deps: SlackVoiceRulesDeps;
  home: string;
  slackDraft: boolean;
}): Promise<number> {
  const rules = deps.loadExactRules({ home });
  if (rules.isErr()) {
    for (const problem of rules.error) {
      logger.error({ msg: `voice-rules could not read the configured voice rules: ${problem}` });
    }
    return EXIT_ERROR;
  }
  const text = await deps.readStdin();
  deps.writeOut(JSON.stringify(copyVoiceVerdict({ rules: rules.value, slackDraft, text })));
  return EXIT_OK;
}

/**
 * Run the verb against injected dependencies.
 *
 * Nothing reaches stdout until the whole brief has loaded, so a failed read cannot leave half a document or a
 * truncated JSON object behind for a caller that is parsing one.
 *
 * The `--json` document carries an `enforcement` map beside the values for the same reason the text brief
 * labels its blocks: `shape` is advisory and `rules`/`paragraphSpacing` are refused at the send door, and a
 * machine consumer given the three values alone cannot tell which is which.
 *
 * @param rest the argv tail after `slack voice-rules`
 * @param deps the injected edges
 * @returns the process exit code
 */
export async function runSlackVoiceRules({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: SlackVoiceRulesDeps;
}): Promise<number> {
  const parsed = parseSlackVoiceRulesArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of [...slackArgumentErrorLines({ error: parsed.error }), SLACK_VOICE_RULES_USAGE]) {
      logger.warn({ msg: problem });
    }
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: parsed.value.home });
  if (parsed.value.checkStdin) {
    return runVoiceCheck({ deps, home, slackDraft: parsed.value.slackDraft });
  }
  const brief = deps.loadBrief({ home });
  if (brief.isErr()) {
    for (const problem of brief.error) {
      logger.error({ msg: `voice-rules could not read the configured voice state: ${problem}` });
    }
    return EXIT_ERROR;
  }
  const { paragraphSpacing, rules, shape } = brief.value;
  if (parsed.value.json) {
    // `enforcement` carries what the text brief's block headers carry, because a machine consumer reading
    // `shape` beside `rules` has no other way to tell that one is refused at the send door and the other is
    // the operator's advice. Additive rather than a reshape: the three existing keys stay where they are.
    deps.writeOut(
      JSON.stringify(
        {
          enforcement: { paragraphSpacing: "enforced", rules: "enforced", shape: "advisory" },
          paragraphSpacing,
          rules,
          shape,
        },
        null,
        2,
      ),
    );
    // No receipt: the digest covers the RENDERED brief, and this document is not that rendering.
    return EXIT_OK;
  }
  for (const line of voiceRuleBriefLines({ paragraphSpacing, rules, shape })) {
    deps.writeOut(line);
  }
  return recordedExit({ brief: brief.value, deps, home });
}

/**
 * Write this session's receipt for the brief just printed. A receipt that could not be written is an error: the
 * session would be refused at its next as-me draft while believing itself briefed.
 *
 * @param brief the brief that was printed in full
 * @param deps the injected edges
 * @param home the Slopweaver home the receipt lives under
 * @returns the process exit code
 */
function recordedExit({
  brief,
  deps,
  home,
}: {
  brief: VoiceRuleBrief;
  deps: SlackVoiceRulesDeps;
  home: string;
}): number {
  const recorded = deps.recordBriefing({ brief, home });
  if (recorded.isErr()) {
    for (const problem of recorded.error) {
      logger.error({ msg: `voice-rules printed the brief but ${problem}` });
    }
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/**
 * The production edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionSlackVoiceRulesDeps(): SlackVoiceRulesDeps {
  return {
    loadBrief: ({ home }) => loadVoiceRuleBrief({ home }),
    loadExactRules: ({ home }) => loadExactVoiceRules({ home }),
    readStdin: () => readStdin(),
    recordBriefing: ({ brief, home }) =>
      recordVoiceBriefing({ brief, env: process.env, home, nowIso: new Date().toISOString() }),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver slack voice-rules` — print the operator's current voice brief and record that this session saw it. */
export const slackVoiceRulesCommand = defineCommand({
  run: (argv) => runSlackVoiceRules({ deps: productionSlackVoiceRulesDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
