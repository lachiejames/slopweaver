/**
 * The one call every as-me Slack verb taking NEW words in the owner's name makes before it reads stdin, a token or
 * Slack: `slack draft record --as me`, `slack draft revise`, `slack post|reply --as me` (not a `--draft` release,
 * whose bytes were admitted when they were recorded, unless it carries a new `--thanks-instead` line), `slack edit
 * --as me` and `slack correct --as me`. The policy is
 * `../../../outbound/voice/briefingAdmission.ts`; this prints its refusal and picks the exit code.
 */
import { logger } from "../../../lib/logger.js";
import { admitVoiceBriefing } from "../../../outbound/voice/briefingAdmission.js";
import { EXIT_ERROR } from "../../exitCodes.js";

/**
 * Refuse, with the brief printed, when this session has not been shown the owner's current voice brief.
 *
 * @param applies whether this invocation takes new words in the owner's name at all; `false` admits without a read
 * @param env the environment the visible session and the `voice-briefing` grant are read from
 * @param home the Slopweaver home holding the owner's profile and the receipts
 * @param now the clock the grant and a new receipt are judged at, read only once a session is named
 * @returns `undefined` when the verb may go on, else the exit code once the refusal is printed
 */
export function voiceBriefingExit({
  applies,
  env,
  home,
  now,
}: {
  applies: boolean;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  now: () => string;
}): number | undefined {
  if (!applies) {
    return undefined;
  }
  const admitted = admitVoiceBriefing({
    env,
    home,
    now,
    print: (line) => {
      logger.error({ msg: line });
    },
  });
  if (admitted.isOk()) {
    return undefined;
  }
  for (const line of admitted.error) {
    logger.error({ msg: line });
  }
  return EXIT_ERROR;
}
