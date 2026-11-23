/**
 * Small effectful helpers shared between `./lifecycleRun.ts` (the bot-card lane) and `./lifecycleRunAsMe.ts`
 * (the human lane), split into their own leaf so the two run files can share them without importing EACH
 * OTHER — a helper defined in either run file would make the other's import of it a cycle.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { doorRefusalLines, type NotPerformed, notPerformedLines } from "../../../admit/doorRefusal.js";
import type { DoorDecision, DoorGate } from "../../../admit/types.js";
import { type VoiceGateInput, voiceProfileGate } from "../../../admit/voiceProfileGate.js";
import { hatchOpen } from "../../../hatch/open.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { AuthoredProse } from "../../../outbound/voice/exactRules.js";
import type { ProfileReadError } from "../../../profileStore.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../exitCodes.js";
import type { LifecycleDeps } from "./lifecycleRunTypes.js";

/** Where a stderr line goes; the logger's error channel unless a test supplies its own. */
type ErrorWriter = (args: { msg: string }) => void;

/**
 * Print usage errors and return the usage exit code.
 *
 * @param errors every rejection to report, one per line
 * @param writeError the stderr sink; omitted writes through the logger
 * @returns the usage exit code
 */
export function usage({
  errors,
  writeError = ({ msg }) => {
    logger.error({ msg });
  },
}: {
  errors: readonly string[];
  writeError?: ErrorWriter;
}): number {
  for (const error of errors) {
    writeError({ msg: error });
  }
  return EXIT_USAGE;
}

/**
 * Report a door refusal on stderr.
 *
 * @param decision the door's refusal, carrying every finding and its correction
 * @param writeError the stderr sink; omitted writes through the logger
 * @returns nothing
 */
export function reportRefusal({
  decision,
  writeError = ({ msg }) => {
    logger.error({ msg });
  },
}: {
  decision: DoorDecision;
  writeError?: ErrorWriter;
}): void {
  for (const line of doorRefusalLines({ command: "this slack lifecycle operation", decision })) {
    writeError({ msg: line });
  }
}

/**
 * Report a lifecycle write the door did not perform on stderr, and say which exit it earns.
 *
 * A policy refusal is `EXIT_EXPECTED_EMPTY` (the door working as designed); a store that could not record the
 * decision is `EXIT_ERROR`, because nothing was performed for a reason the owner did not choose.
 *
 * @param through the not-performed outcome of `throughDoor`
 * @param writeError the stderr sink; omitted writes through the logger
 * @returns the process exit code
 */
export function reportNotPerformed({
  through,
  writeError = ({ msg }) => {
    logger.error({ msg });
  },
}: {
  through: NotPerformed;
  writeError?: ErrorWriter;
}): number {
  for (const line of notPerformedLines({ command: "this slack lifecycle operation", through })) {
    writeError({ msg: line });
  }
  return through.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
}

/**
 * The gate list. `DEFAULT_GATES` plus the voice gate, and the ONE omission is deliberate: the
 * duplicate-send gate is NOT installed for any lifecycle mutation except the final card post, per the
 * exemption table in `lifecycleGuards.ts`. Installing it on a progress edit would block every tick after
 * the first.
 *
 * The voice gate is installed on every one of them, including the mutations that author nothing. A delete
 * and a progress tick pass `NO_AUTHORED_PROSE`, which the gate answers with no findings — so the parameter
 * is a claim each call site makes about its own content rather than a lane quietly opting out, which is
 * exactly the shape that left the bot with no voice check at all.
 *
 * @param voice the operator's rules, this mutation's authored prose and whether the named hatch is open
 * @returns the gates every lifecycle mutation routes through
 */
export function gatesFor({ voice }: { voice: VoiceGateInput }): readonly DoorGate[] {
  return [...DEFAULT_GATES, voiceProfileGate(voice)];
}

/**
 * The voice input for one BOT edit: the operator's rules, this form's own prose, and the named hatch.
 *
 * Shared by every bot edit path — card, answer, checklist and poll — because each is the same question with a
 * different walker, and reading the hatch once per path, in separate files, is how they would come to disagree
 * about whether an invocation had opened it. A profile that cannot be trusted is the failure, never an empty
 * rule list.
 *
 * Every path calls it BEFORE the ownership read-back, which is a Slack call, so a profile that cannot be trusted
 * stops an edit with no call made, and a dry run refuses exactly what the real edit would.
 *
 * @param deps the injected world, for the rules, the hatch environment and the clock
 * @param home the state home holding the operator's private voice rules
 * @param prose this form's authored prose regions
 * @returns the voice input the door judges, or why the profile could not be read
 */
export function editVoice({
  deps,
  home,
  prose,
}: {
  deps: LifecycleDeps;
  home: string;
  prose: readonly AuthoredProse[];
}): Result<VoiceGateInput, ProfileReadError> {
  return deps.voiceRules({ home }).map((rules) => ({
    allowVoiceRules: hatchOpen({
      env: deps.doorEnv(),
      home,
      id: "voice-rules",
      nowIso: deps.nowIso(),
    }),
    prose,
    rules,
  }));
}
