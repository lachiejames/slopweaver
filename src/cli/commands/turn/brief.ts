/**
 * `slopweaver turn brief` — turn one addressed message into a question the VISIBLE SESSION judges.
 *
 * This is the read half of the split that removed the headless child. It builds the capability inventory
 * this context can reach, writes the brief, and prints it. It posts nothing, opens no socket, reads no
 * world model, and — the point of the whole exercise — runs no model. Its one Slack read confirms, for a
 * high-stakes channel only, that the thread every post of the turn replies into is real
 * (`./briefHighStakes.ts`, asked from `./briefTarget.ts`). Deciding whether to respond, at what tier, is the visible session's own judgement now, composed after reading this brief and handed to
 * `slopweaver turn dispatch` — never a keyword match this verb makes for it.
 *
 * ## Why it writes a FILE as well as printing
 *
 * The printed form is for the session to read; the file is for `turn dispatch`/`turn answer` to ground
 * against. They carry the same facts and they are not interchangeable: prose is what the session reasons
 * over, and the file is what the later verbs re-parse at the process boundary rather than trust.
 */
import { existsSync } from "node:fs";
import { type OwnerDirectivePort, ownerDirectivePort } from "../../../judgement/ownerDirectivePort.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { renderCapabilityContracts } from "../../../live/turn/briefCapabilityContracts.js";
import type { TurnInvocationMode } from "../../../live/turn/judgement.js";
import { loadJudgementProfile } from "../../../live/turn/judgementProfileStore.js";
import { routingInputForTurn } from "../../../live/turn/routingContext.js";
import { censusLinesFor } from "../../../route/censusReadings.js";
import type { SkippedCapability, SourceCapability } from "../../../route/profile.js";
import { loadCapabilityProfile } from "../../../route/profileStore.js";
import { detectSupervisorSession, type VisibleSessionHost } from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { routingCapabilitiesFor } from "./briefCapabilities.js";
import { resolvedStarted, ridesFromFlags, startedFromFlags } from "./briefCardFlags.js";
import { ownerDirectivesForBrief } from "./briefOwnerJudgement.js";
import { admittedTargetOrRefusal, type BriefTarget } from "./briefTarget.js";
import { writeAndRenderBrief } from "./briefWrite.js";
import { briefOutPath, str, TURN_BRIEF_FLAG_SPEC, TURN_BRIEF_USAGE } from "./core.js";

/** Where this verb's own arguments start in `process.argv`: `[node, cli, turn, brief, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Parse the verb's argv tail. Pure — no filesystem, no network, so a bad flag is refused before any effect.
 *
 * @param rest the argv tail after `turn brief`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnBriefArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: { boolean: [...TURN_BRIEF_FLAG_SPEC.boolean], string: [...TURN_BRIEF_FLAG_SPEC.string] },
  });
}

/**
 * The `--mode` flag, validated rather than coerced — an unrecognised value is a usage error, never silently
 * defaulted, because a caller that typed `continous-drain` deserves to be told so rather than getting
 * `single-turn`'s admissibility rules by accident.
 *
 * @param values the parsed flag values
 * @returns the invocation mode (defaulting to `single-turn`), or the one reason the given value is invalid
 */
export function invocationModeFromFlags({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): { readonly mode: TurnInvocationMode } | { readonly error: string } {
  const raw = str({ key: "mode", values });
  if (raw === undefined) {
    return { mode: "single-turn" };
  }
  if (raw === "continuous-drain" || raw === "single-turn") {
    return { mode: raw };
  }
  return { error: `--mode must be \`continuous-drain\` or \`single-turn\`, but got \`${raw}\`` };
}

/**
 * The visible host actually judging this brief — `--host` overrides detection, for the rare case (or a
 * test) with no `CLAUDE_CODE_SESSION_ID`/`CODEX_THREAD_ID` set. `explicit` has no model behind it, so a
 * detected `explicit` session maps to Claude Code.
 *
 * @param values the parsed flag values
 * @returns the visible host, or the one reason neither the override nor detection resolved one
 */
export function visibleSessionHostOfFlags({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): { readonly host: VisibleSessionHost } | { readonly error: string } {
  const override = str({ key: "host", values });
  if (override !== undefined) {
    return override === "claude-code" || override === "codex"
      ? { host: override }
      : { error: `--host must be \`claude-code\` or \`codex\`, but got \`${override}\`` };
  }
  const detection = detectSupervisorSession({ env: process.env });
  if (detection.kind === "missing") {
    return {
      error:
        "turn brief: no visible supervisor session was found — start this command inside Claude Code or Codex, or pass --host explicitly",
    };
  }
  if (detection.kind === "ambiguous") {
    return {
      error:
        "turn brief: both a Claude Code and a Codex session variable are set, so the visible supervisor is ambiguous",
    };
  }
  return { host: detection.session.host === "codex" ? "codex" : "claude-code" };
}

/**
 * Run the brief verb over the store's owner-judgement port — the composition root.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runTurnBrief(argv: readonly string[]): Promise<number> {
  return runTurnBriefWith({ argv, ownerJudgement: ownerDirectivePort() });
}

/** One turn-brief run: the FULL process argv, and the door the owner's active directives are read through. */
interface TurnBriefRequest {
  readonly argv: readonly string[];
  readonly ownerJudgement: OwnerDirectivePort;
}

/**
 * Run the brief verb over an injected owner-judgement port, so a test reaches no store.
 *
 * @param argv the FULL process argv, as {@link runTurnBrief} receives it
 * @param ownerJudgement the door the owner's active directives are read through
 * @returns the process exit code
 */
export async function runTurnBriefWith({ argv, ownerJudgement }: TurnBriefRequest): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_BRIEF_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnBriefArgs({ rest });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: error });
    }
    logger.error({ msg: TURN_BRIEF_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const home = resolveHome({ named: str({ key: "home", values }) });
  if (values["contracts"] === true) {
    return printCapabilityContracts({ home, values });
  }
  const target = await admittedTargetOrRefusal({ home, values });
  if ("code" in target) {
    return target.code;
  }
  const execution = executionContextFromFlags({ values });
  if ("error" in execution) {
    logger.error({ msg: execution.error });
    return EXIT_USAGE;
  }
  return compose({ home, host: execution.host, mode: execution.mode, ownerJudgement, target, values });
}

/**
 * The read-only door: print the capability contracts for `--text` and write NOTHING — no brief, no
 * lifecycle row, no responder check. This is what closes the gap the data-loss defect exposed: reading what
 * a capability covers used to have no entrance except a full `turn brief`, so a session that only wanted to
 * read a contract had to write one, and a throwaway question overwrote a live turn's own brief.
 *
 * @param home the resolved state home
 * @param values the parsed flag values
 * @returns the process exit code
 */
async function printCapabilityContracts({
  home,
  values,
}: {
  home: string;
  values: Readonly<Record<string, string | boolean>>;
}): Promise<number> {
  const question = str({ key: "text", values });
  if (question === undefined) {
    logger.error({ msg: "--text is required" });
    logger.error({ msg: TURN_BRIEF_USAGE });
    return EXIT_USAGE;
  }
  const capabilityOutcome = loadCapabilityProfile({ home });
  if (capabilityOutcome.kind === "unreadable") {
    logger.error({
      msg:
        `turn brief --contracts: capability-profile.json could not be used — ${capabilityOutcome.why}; ` +
        "showing the generic table only",
    });
  }
  const capabilities = await routingCapabilitiesFor({ capabilityOutcome, home, question });
  for (const line of renderCapabilityContracts({
    available: capabilities.available,
    historical: capabilities.historical,
    unavailable: capabilities.unavailable,
  })) {
    logger.out({ line });
  }
  for (const line of censusLinesFor({ home, question })) {
    logger.out({ line });
  }
  // On stdout beside the contracts, not on stderr. A skipped row is part of the ANSWER to "what can you
  // reach" — a reader who sees only the contracts that survived cannot tell a capability was never
  // declared from one that was declared and thrown away.
  if (capabilityOutcome.kind === "profile" && capabilityOutcome.skipped.length > 0) {
    logger.out({ line: "" });
    logger.out({
      line: `SKIPPED CAPABILITIES — declared in capability-profile.json and NOT usable (${capabilityOutcome.skipped.length}):`,
    });
    for (const row of capabilityOutcome.skipped) {
      logger.out({ line: `    - ${row.id} — ${row.reason}` });
    }
  }
  return EXIT_OK;
}

/** The `--mode`/`--host` pair, resolved together so {@link runTurnBrief} stays a flat sequence of refusals. */
function executionContextFromFlags({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): { readonly mode: TurnInvocationMode; readonly host: VisibleSessionHost } | { readonly error: string } {
  const modeOutcome = invocationModeFromFlags({ values });
  if ("error" in modeOutcome) {
    return { error: `${modeOutcome.error}\n${TURN_BRIEF_USAGE}` };
  }
  const hostOutcome = visibleSessionHostOfFlags({ values });
  if ("error" in hostOutcome) {
    return { error: hostOutcome.error };
  }
  return { host: hostOutcome.host, mode: modeOutcome.mode };
}

/**
 * Build the routing-judgement input for one brief, folding in the private capability/judgement profiles.
 *
 * ## Two of the three overlays degrade; the owner's judgement REFUSES. That asymmetry is the point.
 *
 * An unreadable capability profile costs breadth — routing falls back to the generic table, and the turn is
 * worse but not wrong. An unreadable judgement profile costs voice. Both are honestly degraded and loudly
 * reported, and continuing is the right call: refusing a whole turn because a persona file is corrupt would
 * be a worse failure than the one it prevents. The owner's directives and corrections are not like that, and
 * an unreadable store stops the turn — the reasoning is `./briefOwnerJudgement.ts`'s.
 */
async function judgementInputFor({
  home,
  host,
  mode,
  ownerJudgement,
  target,
}: {
  home: string;
  host: VisibleSessionHost;
  mode: TurnInvocationMode;
  ownerJudgement: OwnerDirectivePort;
  target: BriefTarget;
}): Promise<
  | { readonly kind: "refusal"; readonly message: string }
  | {
      readonly kind: "input";
      readonly routingInput: ReturnType<typeof routingInputForTurn>;
      readonly unavailableCapabilities: readonly SourceCapability[];
      /** Overlay rows declared and NOT usable — carried into the brief so a reader sees them, not stderr. */
      readonly skippedCapabilities: readonly SkippedCapability[];
    }
> {
  const capabilityOutcome = loadCapabilityProfile({ home });
  if (capabilityOutcome.kind === "unreadable") {
    logger.error({
      msg: `turn brief: capability-profile.json could not be used — ${capabilityOutcome.why}; routing with the generic table only`,
    });
  }
  const judgementOutcome = loadJudgementProfile({ home });
  if (judgementOutcome.kind === "unreadable") {
    logger.error({
      msg: `turn brief: judgement profile.json could not be used — ${judgementOutcome.why}; judging with no persona/voice overlay`,
    });
  }
  const directiveOutcome = await ownerDirectivesForBrief({ home, port: ownerJudgement });
  if (directiveOutcome.kind === "refusal") {
    return directiveOutcome;
  }
  const capabilities = await routingCapabilitiesFor({ capabilityOutcome, home, question: target.text });
  const routingInput = routingInputForTurn({
    briefTarget: { ...target, question: target.text },
    capabilities,
    execution: { mode, supervisorHost: host },
    ...(directiveOutcome.directives.length > 0 ? { ownerDirectives: directiveOutcome.directives } : {}),
    ...(judgementOutcome.kind === "profile" ? { profile: judgementOutcome.profile } : {}),
  });
  return {
    kind: "input",
    routingInput,
    skippedCapabilities: capabilityOutcome.kind === "profile" ? capabilityOutcome.skipped : [],
    unavailableCapabilities: capabilities.unavailable,
  };
}

/**
 * The refusal message for overwriting a brief whose ask already has a started turn — or `undefined` when the
 * write is safe. Extracted so {@link compose} stays a flat sequence of refusals rather than growing a nested
 * conditional inline.
 *
 * MEASURED: a session that only wanted to read a capability contract re-ran `turn brief` with a
 * throwaway `--text` on an ask that already had a started turn, and the write silently destroyed the live
 * turn's pinned question and evidence — `src/__tests__/fixtures/replay/brief-clobbered-by-read`. `turn brief
 * --contracts` is the door for reading a contract without writing; this refusal is the door for everything
 * else that would otherwise clobber a brief already in flight.
 *
 * @param force whether the caller passed `--force`, which overrides this refusal
 * @param path where this brief would be written
 * @param startedRef the started ref resolved for this brief, when one was recovered or passed explicitly
 * @param target the brief's target, for the refusal message's own identity
 * @returns the refusal message, or `undefined` when nothing stops the write
 */
function overwriteOfStartedBriefRefusal({
  force,
  path,
  startedRef,
  target,
}: {
  force: boolean;
  path: string;
  startedRef: { readonly turnId: string; readonly workingTs: string } | undefined;
  target: BriefTarget;
}): string | undefined {
  if (startedRef === undefined || force || !existsSync(path)) {
    return undefined;
  }
  return (
    `turn brief: refuses to overwrite a brief whose ask has a started turn (${target.channel}/` +
    `${target.messageTs}, turn ${startedRef.turnId}) at ${path} — pass --force to overwrite it anyway, ` +
    "or use `turn brief --contracts --text <question>` to read a capability without writing a brief"
  );
}

/** Build the brief, write it, print it — no world model is loaded here, or by anything a live turn calls. */
async function compose({
  home,
  host,
  mode,
  ownerJudgement,
  target,
  values,
}: {
  home: string;
  host: VisibleSessionHost;
  mode: TurnInvocationMode;
  ownerJudgement: OwnerDirectivePort;
  target: BriefTarget;
  values: Readonly<Record<string, string | boolean>>;
}): Promise<number> {
  const started = startedFromFlags({ values });
  if ("error" in started) {
    logger.error({ msg: started.error });
    logger.error({ msg: TURN_BRIEF_USAGE });
    return EXIT_USAGE;
  }
  const reconciledStarted = resolvedStarted({ flagsStarted: started.started, home, target });
  if (reconciledStarted.isErr()) {
    logger.error({ msg: reconciledStarted.error.message });
    return EXIT_ERROR;
  }
  const startedRef = reconciledStarted.value;
  const rides = ridesFromFlags({ target, values });
  if ("error" in rides) {
    logger.error({ msg: rides.error });
    return EXIT_USAGE;
  }
  const path = briefOutPath({ askIdentity: target, home, values });
  const overwriteRefusal = overwriteOfStartedBriefRefusal({
    force: values["force"] === true,
    path,
    startedRef,
    target,
  });
  if (overwriteRefusal !== undefined) {
    logger.error({ msg: overwriteRefusal });
    return EXIT_ERROR;
  }
  const judgementInput = await judgementInputFor({ home, host, mode, ownerJudgement, target });
  if (judgementInput.kind === "refusal") {
    logger.error({ msg: judgementInput.message });
    return EXIT_ERROR;
  }
  return writeAndRenderBrief({
    home,
    path,
    ridesOn: rides.ridesOn,
    routingInput: judgementInput.routingInput,
    skippedCapabilities: judgementInput.skippedCapabilities,
    startedRef,
    target,
    unavailableCapabilities: judgementInput.unavailableCapabilities,
  });
}

export const turnBriefCommand = defineCommand({ run: runTurnBrief });
