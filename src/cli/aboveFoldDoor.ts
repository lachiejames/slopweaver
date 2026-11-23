/**
 * The above-the-fold gate, at every outbound door.
 *
 * Rule 7 says a message is concise above the fold with everything else collapsed, and that shape is enforced
 * by the SCHEMA rather than by review. The word caps did the LENGTH half. This is the PACKING half, and the
 * voice exercise measured that packing, not length, was what made a cell unreadable — one
 * rewrite came out a word longer and read far better.
 *
 * Four surfaces share it: a pull-request description, a Linear issue or comment, a Slack bot card, and a
 * Notion page's lead. Each supplies its own cells, because only that form knows which of its fields a reader
 * sees before expanding anything. Everything after that is identical, which is the point of one module.
 *
 * ## Why this is a door, not a schema
 *
 * Two reasons, both about honesty rather than convenience. The operator's banned characters and words are
 * private `profile.json` configuration, which a schema shipped in this repository cannot see. And the
 * override is a grant one session holds for thirty minutes, which an always-on schema cannot honour — so a
 * form admitted under one deliberate exception would be refused again by whatever ran the schema next.
 *
 * The override is the SAME one the as-me lane uses, the journalled `voice-rules` hatch. One way past for one
 * class of refusal, named in every refusal it can lift, admitting the artifact unchanged.
 *
 * ## Both sides of the fold, with different consequences
 *
 * The name is now half the story. Each surface also supplies its BELOW-the-fold cells, where the operator's
 * vocabulary rules run and nothing else does — the packing rules are about whether a reader will expand at
 * all, so they have no business inside what a reader already chose to read. That half WARNS and never
 * refuses (no hard blocks for voice), and the same override silences it.
 * `../outbound/voice/aboveFold.ts` carries the measurement that shaped it.
 *
 * ## A refusal here leaves a ROW
 *
 * This gate runs before the door, so a body it refuses never reaches `throughDoor` and the door ledger used
 * to record nothing at all about it — the ledger answered "what did we send" and could not answer "what did
 * we try to send and get stopped on". `../admit/ledger.ts` carries the measurement and the row's shape;
 * {@link printedAboveFoldRefusals} is where it is written, and {@link aboveFoldRefusalRow} builds it purely
 * so the two Slack sites that return a `Result` rather than printing can write the same row.
 */
import { randomUUID } from "node:crypto";

import { err, ok, type Result } from "#lib/result.js";
import type { DoorLedgerPort } from "../admit/doorLedgerPort.js";
import { type PreDoorRefusal, recordPreDoorRefusal } from "../admit/ledger.js";
import { readCachedVoiceRegister } from "../context/cache.js";
import { grantEnvOf } from "../hatch/grantSession.js";
import { hatchOpen } from "../hatch/open.js";
import {
  type AboveFoldCell,
  type AboveFoldFinding,
  aboveFoldFindings,
  belowFoldFindings,
} from "../outbound/voice/aboveFold.js";
import { VOICE_RULES_ESCAPE, VOICE_RULES_HATCH } from "../outbound/voice/exactRules.js";
import { type LengthCalibration, lengthVerdictFor, type VoiceSurface } from "../outbound/voice/lengthRegister.js";
import { type ProfileReadError, readExactVoiceRules } from "../profileStore.js";
import { stateHomePaths } from "../stateHome.js";

/** What the gate decided, and what it found even when the override let it through. */
export interface AboveFoldVerdict {
  /** One operator-facing refusal per violation. Empty when the override is active. */
  readonly refusals: readonly string[];
  /**
   * Every violation, override or not.
   *
   * Kept rather than counted, so a bypass can say what it bypassed and a caller can report WHICH rule fired.
   * The as-me lane learned the same thing: a finding the override admitted is still composition friction
   * worth recording, and a bare count cannot tell anyone what to write differently next time.
   */
  readonly findings: readonly AboveFoldFinding[];
  /**
   * One line per voice rule that fired BELOW the fold. Never a refusal, and empty when the override is on.
   *
   * A separate field rather than a `code`-tagged member of {@link findings}, because the two halves have
   * different consequences and a caller that treated them as one list would either block on a warning or
   * bury a refusal. Below the fold WARNS — no hard blocks for voice.
   */
  readonly warnings: readonly string[];
  /**
   * One line when the body is far longer than the owner measurably writes on this surface. Never a refusal.
   *
   * Its OWN field rather than a member of {@link warnings}, for the same reason `warnings` is its own
   * field rather than a tagged member of {@link findings}: the below-fold warning renderer prefixes every
   * line it prints with "below the fold", and a length warning is about the whole body. Folding them
   * together would print a true sentence under a false label.
   */
  readonly lengthWarnings: readonly string[];
  /**
   * Whether the measured register had a threshold for this surface at all.
   *
   * `uncalibrated` is not the same as no warnings, and this field exists so a dry run can say which. A
   * surface nothing has measured has not been checked, and reporting that as clean is the shape a check
   * that cannot fail takes.
   */
  readonly lengthCalibration: LengthCalibration;
  /**
   * Which outbound surface this body was judged for.
   *
   * Carried ON the verdict rather than threaded separately, so the one seam that records a refusal
   * ({@link printedAboveFoldRefusals}) gets it from the argument that decided the check. A surface the
   * recorder had to be told separately is a surface a caller could tell it wrongly.
   */
  readonly surface: VoiceSurface;
}

/**
 * Check one surface's cells against the voice and packing rules, on both sides of its fold.
 *
 * `belowFoldCells` is REQUIRED rather than optional, and that is the whole point of this change. The class
 * it closes is `voice-rules-run-late-and-only-on-one-lane`, whose 26 anchored instances are all the same
 * shape: the check ran on ONE lane and the prose a reader actually reads went out unread. An optional field
 * is how a surface silently rejoins the uncovered set. A surface with genuinely no fold — a Linear comment,
 * a project update, a GitHub comment, all of which are a summary and nothing else — states `[]` and says so
 * at the call site.
 *
 * @param cells the regions a reader sees before expanding anything, each named by a field a caller can fix
 * @param belowFoldCells the regions a reader sees only after expanding, `[]` on a surface with no fold
 * @param env the injected environment reader, so the override is a decision a test can make rather than
 *   ambient state no test can reach
 * @param home the state home the operator's private rules are loaded from
 * @param surface which outbound surface this body is going to, so the measured length register can pick
 *   the cohort it was measured on. REQUIRED for the reason `belowFoldCells` is: an optional field is how
 *   a surface silently rejoins the unchecked set.
 * @returns the refusals to print, the below-fold warnings, the length warning, and every finding the
 *   override may have admitted — or, when `profile.json` is there but corrupt, why no verdict can be reached.
 *   The voice override does not lift that one: it waives a rule that fired, never not knowing the rules.
 */
export function aboveFoldVerdictFor({
  cells,
  belowFoldCells,
  env,
  home,
  surface,
}: {
  cells: readonly AboveFoldCell[];
  belowFoldCells: readonly AboveFoldCell[];
  env: (args: { name: string }) => string | undefined;
  home: string;
  surface: VoiceSurface;
}): Result<AboveFoldVerdict, ProfileReadError> {
  const read = readExactVoiceRules({ home });
  if (read.isErr()) {
    return err(read.error);
  }
  const rules = read.value;
  const findings = aboveFoldFindings({ cells, rules });
  const length = lengthVerdictFor({
    cells: [...cells, ...belowFoldCells],
    cohorts: readCachedVoiceRegister({ path: stateHomePaths({ home }).profileContextJson }),
    surface,
  });
  if (hatchOpen({ env: grantEnvOf({ read: env }), home, id: VOICE_RULES_HATCH, nowIso: new Date().toISOString() })) {
    return ok({
      findings,
      lengthCalibration: length.calibration,
      lengthWarnings: [],
      refusals: [],
      surface,
      warnings: [],
    });
  }
  return ok({
    findings,
    lengthCalibration: length.calibration,
    lengthWarnings: length.warnings,
    surface,
    refusals: findings.map(
      (finding) =>
        `${finding.path}: ${finding.message} For one deliberate exception run ` +
        `${VOICE_RULES_ESCAPE}; the grant sends the original content unchanged.`,
    ),
    warnings: belowFoldFindings({ cells: belowFoldCells, rules }).map(
      (finding) => `${finding.path}: ${finding.message}`,
    ),
  });
}

/**
 * The dry-run report for one verdict, in the same shape a validator line uses.
 *
 * A clean verdict still prints a line. A gate that says nothing when it passes is indistinguishable from a
 * gate that never ran, and this one is new enough that a reader needs to see it working.
 *
 * @param verdict what the gate decided
 * @returns the lines to print, ending in a blank one
 */
export function aboveFoldLines({ verdict }: { verdict: AboveFoldVerdict }): readonly string[] {
  const warnings = [...voiceWarningLines({ verdict }), lengthStateLine({ verdict })];
  if (verdict.refusals.length > 0) {
    return [
      `above-the-fold gate: REFUSES this body:\n${verdict.refusals.map((r) => `  - ${r}`).join("\n")}`,
      ...warnings,
      "",
    ];
  }
  if (verdict.findings.length > 0) {
    return [
      `above-the-fold gate: ${String(verdict.findings.length)} violation(s) OVERRIDDEN by this session's live ${VOICE_RULES_HATCH} grant`,
      ...warnings,
      "",
    ];
  }
  return ["above-the-fold gate: ACCEPTS this body", ...warnings, ""];
}

/**
 * One line saying whether the length register could judge this surface at all.
 *
 * Printed only on a DRY RUN, where somebody is reading a report, rather than on every live send. A
 * surface nothing has measured is unchecked rather than clean, and the difference has to be visible
 * somewhere a reader looks — but printing it on every send would be the wall of text rule 7 bans.
 *
 * @param verdict what the gate decided
 * @returns the state line
 */
function lengthStateLine({ verdict }: { verdict: AboveFoldVerdict }): string {
  if (verdict.lengthCalibration === "uncalibrated") {
    return "measured length register: NOT CALIBRATED for this surface — the length half of the gate did not run";
  }
  return verdict.lengthWarnings.length > 0
    ? "measured length register: over the measured threshold, warned above"
    : "measured length register: within the measured threshold";
}

/**
 * Every warning this gate produced, as the lines a door prints — both families, one wording.
 *
 * Prefixed `warning:` rather than `refused:` on purpose: a caller greps the refusal prefix to decide whether
 * a write happened, and a warning that shared it would read as a block that never blocked.
 *
 * **Exported, and that is a change of shape rather than a convenience.** This used to be private, so that
 * every door reached it through {@link aboveFoldLines} or {@link printedAboveFoldRefusals} and no surface
 * could report the refusals while dropping the warnings. MEASURED, that is exactly what two
 * surfaces did: `slack/runAdmit.ts` and `slack/lifecycleRunGuards.ts` call
 * {@link aboveFoldVerdictFor} directly, return a `Result` rather than printing, and read only `refusals` —
 * so every below-fold voice warning on the bot's own card lane went to nobody. Privacy did not prevent the
 * bypass; it only removed the correct way through. One exported function both printers and both Slack
 * sites call keeps the single wording, which is what the privacy was actually protecting.
 *
 * @param verdict what the gate decided
 * @returns one line per rule that fired below the fold, then the measured-length line if there is one
 */
export function voiceWarningLines({ verdict }: { verdict: AboveFoldVerdict }): readonly string[] {
  return [
    ...verdict.warnings.map(
      (warning) =>
        `warning: below the fold, ${warning} This never blocks the write; silence it with ${VOICE_RULES_ESCAPE}.`,
    ),
    ...verdict.lengthWarnings.map((warning) => `warning: measured length register, ${warning}`),
  ];
}

/**
 * The door-ledger row for a refused body, or `undefined` when nothing was refused. Pure.
 *
 * Built from the verdict alone, which is what lets the ONE recording seam below hold: every caller already
 * has a verdict, and nothing else has to be threaded to it. The row carries each finding's `code`, `path`
 * and `message` and no authored prose, exactly as `doorDecisionRecord` carries a finding's `summary` — a
 * refusal's whole value is the reason it fired, and a row reading `voice-rule` and nothing else would
 * record that something was stopped without recording why.
 *
 * Worth stating rather than leaving to be discovered: a `voice-rule` finding's `message` embeds the
 * operator's own configured rule VALUE, because `../outbound/voice/aboveFold.ts` builds it with
 * `JSON.stringify(finding.rule.value)`. The pain-point ledger already writes that same value locally
 * (`../admit/painPoint.ts`'s `recordExactVoicePainPoints`), so this is the established boundary rather
 * than a new one — but it is the operator's private `profile.json` configuration, and both ledgers stay
 * on-device.
 *
 * @param verdict what the gate decided
 * @param runId the id to record
 * @param tsIso the instant to record
 * @returns the row, or `undefined` when there is nothing to record
 */
export function aboveFoldRefusalRow({
  verdict,
  runId,
  tsIso,
}: {
  verdict: AboveFoldVerdict;
  runId: string;
  tsIso: string;
}): PreDoorRefusal | undefined {
  if (verdict.refusals.length === 0) {
    return undefined;
  }
  return {
    findings: verdict.findings.map((finding) => ({
      code: finding.code,
      message: finding.message,
      path: finding.path,
    })),
    gate: "above-the-fold-voice",
    hatch: VOICE_RULES_HATCH,
    runId,
    surface: verdict.surface,
    tsIso,
  };
}

/**
 * Print every refusal on the door's own `refused:` channel and every below-the-fold warning beside them,
 * RECORD the refusal in the door ledger, and say whether anything was refused.
 *
 * One helper rather than the same three lines at every call site: it keeps each flow's branch count under
 * the repository's cognitive-complexity ceiling, and it keeps the refusal PREFIX identical across every
 * surface, which is what a caller greps for. The warnings print HERE rather than at each door for the same
 * reason the below-fold cells are a required argument — a surface that has to opt in to reporting is a
 * surface that will not.
 *
 * ## Why the ledger row is written HERE
 *
 * This function's name already means "a refusal was printed", which is exactly the event the door ledger
 * had no row for, and every one of its callers is a LIVE path by construction: {@link aboveFoldGateRefused}
 * reaches it only on `!dryRun`, `commands/github/stackPushBodyVerdict.ts` passes `refuseFindings: !args.dryRun`, and
 * `commands/github/updateFlow.ts` sits after its own dry-run branch has returned. A dry run did not try to
 * send, so it must not leave a row.
 *
 * Writing it here rather than at each door is the same argument as the warnings above it, and the same one
 * {@link voiceWarningLines} was exported for. That class already bit this module: MEASURED, two
 * Slack surfaces read only `refusals` and dropped every below-fold warning. An opt-in would not hold.
 *
 * The two Slack sites still cannot reach this function — they return a `Result` rather than printing — so
 * they call {@link aboveFoldRefusalRow} and {@link recordPreDoorRefusal} themselves. Nothing GATES that
 * today, so a third such site would go unrecorded in silence. The check is one command:
 * `grep -rln aboveFoldVerdictFor src | grep -v __tests__` returns this file, those two, and
 * `commands/github/aboveFoldGate.ts`, which only BUILDS a verdict its callers then hand to this function.
 * A fifth name in that list is a site to read.
 *
 * @param verdict what the gate decided
 * @param out the caller's output sink
 * @param home the state home whose store records the refusal
 * @param ledger the door ledger the refusal row is written through
 * @param runId the id to record, injected so a test can pin the row
 * @param tsIso the instant to record, injected for the same reason
 * @returns true when the write must not proceed
 */
export async function printedAboveFoldRefusals({
  verdict,
  out,
  home,
  ledger,
  runId = randomUUID(),
  tsIso = new Date().toISOString(),
}: {
  verdict: AboveFoldVerdict;
  out: (args: { line: string }) => void;
  home: string;
  ledger: DoorLedgerPort;
  runId?: string;
  tsIso?: string;
}): Promise<boolean> {
  for (const refusal of verdict.refusals) {
    out({ line: `refused: ${refusal}` });
  }
  for (const line of voiceWarningLines({ verdict })) {
    out({ line });
  }
  const row = aboveFoldRefusalRow({ runId, tsIso, verdict });
  if (row !== undefined) {
    await recordPreDoorRefusal({ home, ledger, refusal: row });
  }
  return verdict.refusals.length > 0;
}

/**
 * Run the gate at one door, report it, and say whether the write must stop.
 *
 * The whole block rather than its pieces, because the pieces were being copied verbatim into every verb and
 * the clone detector caught the third copy. A dry run PRINTS the verdict (a gate that says nothing when it
 * passes is indistinguishable from one that never ran); a live invocation prints only refusals.
 *
 * @param cells the regions a reader sees before expanding anything
 * @param belowFoldCells the regions a reader sees only after expanding, `[]` on a surface with no fold
 * @param env the injected environment reader
 * @param home the state home the operator's private rules are loaded from
 * @param dryRun whether this invocation stops before every effect
 * @param surface which outbound surface this body is going to
 * @param out the caller's output sink
 * @param ledger the door ledger a live refusal is recorded through
 * @returns true when the verb must refuse
 */
export async function aboveFoldGateRefused({
  cells,
  belowFoldCells,
  env,
  home,
  dryRun,
  surface,
  out,
  ledger,
}: {
  cells: readonly AboveFoldCell[];
  belowFoldCells: readonly AboveFoldCell[];
  env: (args: { name: string }) => string | undefined;
  home: string;
  dryRun: boolean;
  surface: VoiceSurface;
  out: (args: { line: string }) => void;
  ledger: DoorLedgerPort;
}): Promise<boolean> {
  const read = aboveFoldVerdictFor({ belowFoldCells, cells, env, home, surface });
  if (read.isErr()) {
    // A fact about the install, not a rule that fired: no door row, and no override named, because none lifts it.
    out({ line: `refused: ${read.error.message}` });
    return true;
  }
  const verdict = read.value;
  if (!dryRun) {
    return printedAboveFoldRefusals({ home, ledger, out, verdict });
  }
  for (const line of aboveFoldLines({ verdict })) {
    out({ line });
  }
  return verdict.refusals.length > 0;
}
