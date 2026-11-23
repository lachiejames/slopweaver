/**
 * The BRIEF — what a Slack tag becomes when nothing headless is allowed to answer it.
 *
 * ## Why this file exists at all
 *
 * A turn used to answer by spawning a detached `claude -p` child from inside the listener. That produced
 * good answers and it is now forbidden outright: the bot runs only inside a visible agent session the owner
 * started, and the work happens inside that turn where it can be watched, interrupted and paid for
 * once. So the CLI's job stops being "answer the question" and becomes "hand the session everything it
 * needs to answer the question, and nothing it has to guess".
 *
 * That hand-off is this file. It is pure: given a question and the capabilities this context can reach, it
 * renders a brief the visible session judges against. It runs no model, opens no socket and posts nothing.
 *
 * ## v6: routing is agent judgement, not a filter
 *
 * A brief no longer carries a pre-decided `route`/`plan` — `buildSourcePlan`'s keyword match is gone from
 * this path entirely. What it carries instead is a {@link RoutingJudgementInput}: the trust-labelled
 * question plus the capabilities this context can actually reach. The visible session reads it, composes a
 * `RoutingDecision` (`../turn/judgement.ts`), and hands that decision to `turn dispatch` — which is where a
 * tier actually gets executed. This file only builds and renders the QUESTION half of that exchange.
 *
 * ## The brief is also a CONTRACT, not just prose
 *
 * {@link TurnRoutingBrief} is written to disk by `turn brief` and read back by `turn dispatch`/`turn resume`/
 * `turn answer`, so all four verbs stay separate processes with a human-length gap between them — each reads
 * back exactly what the session was actually shown, never re-derives it. {@link parseTurnRoutingBrief} is the
 * ONE decoder every reader calls, so a version check or a field cannot silently drift between call sites.
 *
 * ## Rendering is separate from the payload, deliberately
 *
 * {@link renderTurnRoutingBrief} produces the human/agent-readable form and {@link TurnRoutingBrief} is the
 * machine one. The session reads the rendering; `turn dispatch`/`turn answer` read the payload. Keeping them
 * apart means a change to how the brief READS cannot change what a decision is judged against.
 */

import { z } from "zod";

import { type PainPointEntry, painPointGuidanceLines } from "../../admit/painPoint.js";
import { ownerDirectiveSchema } from "../../judgement/ownerDirective.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type SkippedCapability, type SourceCapability, sourceCapabilitySchema } from "../../route/profile.js";
import type { StartedChecklist } from "../ask/checklist.js";
import type { AskIdentity } from "../ask/identity.js";
import { renderCapabilityContracts } from "./briefCapabilityContracts.js";
import { decisionShapeLines, measuredFigureLines, truthModeLines } from "./briefFixedLines.js";
import * as guidance from "./briefGuidance.js";
import { briefOptionalFields } from "./briefOptionalFields.js";
import { type BriefParseError, BriefParseErrors } from "./errors.js";
import type { RoutingJudgementInput } from "./judgement.js";
import { judgementProfileSchema } from "./judgementProfile.js";
import { ownerDispleasureLines } from "./ownerDispleasure.js";
import { proposalAskLines } from "./proposalAsk.js";
import { replyDisclosureLines } from "./replyDisclosure.js";
import { type CatalogueSkill, skillRoutingLines } from "./skillRouting.js";
import { stoodDownLines } from "./stoodDownGuidance.js";
import { unpromptedHelpLines } from "./unpromptedGuidance.js";

/**
 * The brief's on-disk version. Bumped for incompatible shape changes, so a stale file is refused by name.
 *
 * Bumped to 6 for judgement-based routing: v5 carried `route`/`plan`, the deterministic keyword-matched
 * decision `buildSourcePlan` produced. Neither exists any more — a v6 brief carries a
 * {@link RoutingJudgementInput} instead, and the DECISION is the visible session's own judgement, composed
 * separately and handed to `turn dispatch`. A v5 file parsing as v6 would silently read as "no capabilities
 * offered" for a brief that actually named some, so the version name changes rather than letting the field
 * just go missing.
 */
export const TURN_BRIEF_VERSION = 6;

/** The machine half of the brief: everything a visible session needs to judge and answer one ask. */
export interface TurnRoutingBrief extends AskIdentity {
  readonly version: 6;
  /** The question as asked, tags already stripped. */
  readonly question: string;
  /** Which surface addressed the bot. */
  readonly surface: "channel" | "dm";
  /** Who asked. */
  readonly userId: string;
  /** The trust-labelled input a routing judgement reasons over — never a pre-decided route. */
  readonly routingInput: RoutingJudgementInput;
  /**
   * Capabilities this context knows about but cannot currently reach — kept separate from
   * `routingInput.availableCapabilities` so `turn answer` can check an `unreachable` grounding's surface
   * against a real, current-truth fact rather than trusting the session's own claim alone.
   */
  readonly unavailableCapabilities: readonly SourceCapability[];
  /**
   * Overlay rows this installation DECLARED and that could not be used, each naming why. Optional, so a
   * brief written before this field existed still parses. It is here rather than only on stderr because a
   * session reading the brief cannot otherwise tell a capability that was never declared from one that was
   * declared and thrown away — and the second is a defect in the overlay that someone can fix.
   */
  readonly skippedCapabilities?: readonly SkippedCapability[] | undefined;
  /**
   * The capture-time checklist the listener already posted, when it did. Present exactly when
   * `slopweaver listen` posted a working message right after the capture reaction and handed both fields to
   * `turn brief` as `--turn-id`/`--working-ts`. Absent for a hand-driven brief, which still posts its own
   * working message, unchanged.
   */
  readonly started?: StartedChecklist | undefined;
  /**
   * The `messageTs` of the ask in this SAME thread whose progress card this one rides, when it is a sub-ask
   * the loop re-dispatched from inside that turn — the owner's "add X to the whitelist, and answer their
   * question" (`skills/loop/reference/edge-cases.md`). Intent, not attachment: `turn dispatch`'s card gate
   * (`../../cli/commands/turn/ensureCard.ts`) is what attaches, and only while that ask is still open.
   * Measured: without it, one owner tag put two progress cards in one thread.
   */
  readonly ridesOn?: string | undefined;
  /**
   * The SAME asker's other asks still in flight when this brief was written — the fact that used to be a
   * queue. A burst follow-up is judged like any other tag, so the judge has to be able to see what is already
   * running for this person: measured (`../ask/burst.ts`'s own header), a follow-up admitted
   * beside a live worker produced a second answer claiming "nothing ran". Optional, so a brief written before
   * the field existed still parses, and omitted entirely when the asker has nothing else in flight.
   */
  readonly otherActiveAsks?: readonly InFlightAsk[] | undefined;
  /**
   * `true` when `slopweaver witness help` opened this ask rather than a tag — the bot is helping unprompted
   * in a thread a person tagged it into earlier. Absent on every tagged ask, so a brief written before the
   * field existed still parses. The judge and the worker both print `./unpromptedGuidance.ts`'s block for it.
   */
  readonly unprompted?: true | undefined;
  /**
   * `true` when somebody in this ask's thread stood the bot down earlier (`slopweaver witness stand-down`) —
   * the tag is still answered if it is a question, and a steer gets `no-response`. Absent otherwise, so a brief
   * written before the field existed still parses. The judge and the worker both print
   * `./stoodDownGuidance.ts`'s block for it.
   */
  readonly stoodDown?: true | undefined;
}

/**
 * One of the asker's other in-flight asks, as the brief carries it — `../ask/burst.ts`'s `ActiveAsk` widened
 * at `state`, which this file only ever prints. Declared here rather than imported so the decoder can build
 * one from arbitrary JSON without asserting a narrower union than the bytes prove.
 */
export interface InFlightAsk extends AskIdentity {
  readonly userId: string;
  readonly state: string;
}

/**
 * Build the machine half of the brief.
 *
 * @param channel the channel the tag arrived in
 * @param messageTs the addressing message's own `ts` — never reconstructed from `threadTs`
 * @param question the question as asked, tags stripped
 * @param routingInput the trust-labelled judgement input this context offers
 * @param surface which surface addressed the bot
 * @param threadTs the thread to reply in
 * @param unavailableCapabilities capabilities this context knows of but cannot currently reach
 * @param userId who asked
 * @param skippedCapabilities overlay rows declared and unusable, omitted from the brief when there are none
 * @param started the capture-time checklist's turn id and posted ts, when the listener already posted one
 * @param ridesOn the same-thread ask whose card this sub-ask rides, omitted from the brief when it rides none
 * @param otherActiveAsks the same asker's other in-flight asks, omitted from the brief when there are none
 * @param unprompted whether `witness help` opened this ask, omitted from the brief for a tag
 * @param stoodDown whether somebody in the thread stood the bot down earlier, omitted from the brief when not
 * @returns the brief payload, ready to serialise
 */
export function buildTurnRoutingBrief({
  channel,
  messageTs,
  question,
  routingInput,
  surface,
  threadTs,
  unavailableCapabilities,
  userId,
  otherActiveAsks,
  ridesOn,
  skippedCapabilities,
  started,
  stoodDown = false,
  unprompted = false,
}: {
  channel: string;
  messageTs: string;
  question: string;
  routingInput: RoutingJudgementInput;
  surface: "channel" | "dm";
  threadTs: string;
  unavailableCapabilities: readonly SourceCapability[];
  userId: string;
  otherActiveAsks?: readonly InFlightAsk[] | undefined;
  ridesOn?: string | undefined;
  skippedCapabilities?: readonly SkippedCapability[] | undefined;
  started?: StartedChecklist | undefined;
  stoodDown?: boolean;
  unprompted?: boolean;
}): TurnRoutingBrief {
  return {
    channel,
    messageTs,
    question,
    routingInput,
    surface,
    threadTs,
    unavailableCapabilities,
    userId,
    version: TURN_BRIEF_VERSION,
    ...(otherActiveAsks === undefined || otherActiveAsks.length === 0 ? {} : { otherActiveAsks }),
    ...(skippedCapabilities === undefined || skippedCapabilities.length === 0 ? {} : { skippedCapabilities }),
    ...(started === undefined ? {} : { started }),
    ...(ridesOn === undefined ? {} : { ridesOn }),
    ...(unprompted ? { unprompted: true } : {}),
    ...(stoodDown ? { stoodDown: true } : {}),
  };
}

/** Every field an already-decoded value must carry to be a well-formed {@link TurnRoutingBrief}, by name. */
const REQUIRED_STRING_FIELDS: readonly string[] = ["question", "channel", "messageTs", "threadTs", "userId"];

/** The brief's `surface` — `channel` or `dm`, never anything else. */
function surfaceField({ raw }: { raw: Readonly<Record<string, unknown>> }): Result<"channel" | "dm", BriefParseError> {
  const surface = raw["surface"];
  return surface === "channel" || surface === "dm"
    ? ok(surface)
    : err(BriefParseErrors.invalidSurface({ value: surface }));
}

/** A well-formed source-capability array, or the reason it is not one — decoded through the real schema. */
function capabilityArrayField({
  raw,
  field,
}: {
  raw: Readonly<Record<string, unknown>>;
  field: string;
}): Result<readonly SourceCapability[], BriefParseError> {
  const parsed = z.array(sourceCapabilitySchema).safeParse(raw[field]);
  return parsed.success ? ok(parsed.data) : err(BriefParseErrors.invalidCapabilityArray({ field }));
}

/** A trust-labelled context's own decoder — the two disjoint shapes `judgement.ts`'s `TrustLabeledContext` declares. */
const trustLabeledContextSchema = z.object({
  controlPlane: z.object({
    ownerAddressingText: z.string(),
    structuralMetadata: z.array(z.object({ key: z.string(), value: z.string() })),
  }),
  quotedEvidence: z.array(
    z.object({
      author: z.enum(["owner", "non-owner"]),
      source: z.enum(["thread", "channel", "linked-content"]),
      text: z.string(),
    }),
  ),
});

/** The brief's `routingInput` — decoded through the real schema, never cast wholesale. */
const routingJudgementInputSchema = z.object({
  availableCapabilities: z.array(sourceCapabilitySchema),
  context: trustLabeledContextSchema,
  // Optional on READ alone: every current producer writes the array, and a brief written before the field
  // existed must still parse rather than being refused by version. A PRESENT but malformed value is a
  // refusal like any other — silently dropping it is how the roster lost history in the first place.
  historicalCapabilities: z.array(sourceCapabilitySchema).optional(),
  execution: z.object({
    mode: z.enum(["continuous-drain", "single-turn"]),
    supervisorHost: z.enum(["claude-code", "codex"]),
  }),
  ownerDirectives: z.array(ownerDirectiveSchema).optional(),
  profile: judgementProfileSchema.optional(),
});

/**
 * The brief's `routingInput` field, decoded through {@link routingJudgementInputSchema}.
 *
 * Rebuilt field by field rather than returning `parsed.data` directly: zod's `.optional()` types `profile`
 * as `JudgementProfile | undefined`, so an absent profile decodes with the key explicitly set to
 * `undefined` — which `exactOptionalPropertyTypes` refuses to assign to `RoutingJudgementInput.profile?`.
 * Omitting the key entirely when it is absent is what that strictness actually requires.
 */
function routingInputField({
  raw,
}: {
  raw: Readonly<Record<string, unknown>>;
}): Result<RoutingJudgementInput, BriefParseError> {
  const parsed = routingJudgementInputSchema.safeParse(raw["routingInput"]);
  if (!parsed.success) {
    return err(BriefParseErrors.invalidRoutingInput());
  }
  const { availableCapabilities, context, execution, historicalCapabilities, ownerDirectives, profile } = parsed.data;
  return ok({
    availableCapabilities,
    context,
    execution,
    ...(historicalCapabilities === undefined ? {} : { historicalCapabilities }),
    ...(ownerDirectives === undefined ? {} : { ownerDirectives }),
    ...(profile === undefined ? {} : { profile }),
  });
}

/**
 * Parse an already-decoded value as a {@link TurnRoutingBrief}. The one decoder every reader
 * (`turn dispatch`/`turn resume`/`turn answer`) calls, so a version check cannot drift between call sites.
 *
 * @param raw the decoded JSON value
 * @returns the brief, or every reason it does not parse
 */
export function parseTurnRoutingBrief({ raw }: { raw: unknown }): Result<TurnRoutingBrief, BriefParseError> {
  if (!isRecord(raw)) {
    return err(BriefParseErrors.notAnObject());
  }
  if (raw["version"] !== TURN_BRIEF_VERSION) {
    return err(BriefParseErrors.versionMismatch({ expected: TURN_BRIEF_VERSION, found: raw["version"] }));
  }
  const missing = REQUIRED_STRING_FIELDS.filter((field) => typeof raw[field] !== "string");
  if (missing.length > 0) {
    return err(BriefParseErrors.missingFields({ missing }));
  }
  const surface = surfaceField({ raw });
  if (surface.isErr()) {
    return err(surface.error);
  }
  const routingInput = routingInputField({ raw });
  if (routingInput.isErr()) {
    return err(routingInput.error);
  }
  const unavailableCapabilities = capabilityArrayField({ field: "unavailableCapabilities", raw });
  if (unavailableCapabilities.isErr()) {
    return err(unavailableCapabilities.error);
  }
  const optional = briefOptionalFields({ raw });
  if (optional.isErr()) {
    return err(optional.error);
  }
  // Re-checked (not cast): the `missing` filter above already proved each is a string, but over a generic
  // field-name LIST, which doesn't narrow these individual property reads for the type checker.
  const { channel, messageTs, question, threadTs, userId } = raw;
  if (
    typeof channel !== "string" ||
    typeof messageTs !== "string" ||
    typeof question !== "string" ||
    typeof threadTs !== "string" ||
    typeof userId !== "string"
  ) {
    return err(BriefParseErrors.missingFields({ missing: REQUIRED_STRING_FIELDS }));
  }
  return ok({
    channel,
    messageTs,
    question,
    routingInput: routingInput.value,
    surface: surface.value,
    threadTs,
    unavailableCapabilities: unavailableCapabilities.value,
    userId,
    version: TURN_BRIEF_VERSION,
    ...optional.value,
  });
}

/** Render the full capability inventory: what this context can reach, current and historical, and what it cannot. */
function capabilityLinesOf({ brief }: { brief: TurnRoutingBrief }): readonly string[] {
  return renderCapabilityContracts({
    available: brief.routingInput.availableCapabilities,
    // `?? []` for a brief written before the field existed — it renders an honest empty section rather than
    // crashing a reader of an old file.
    historical: brief.routingInput.historicalCapabilities ?? [],
    unavailable: brief.unavailableCapabilities,
  });
}

/**
 * Render what else this asker already has running, and what the judge is expected to do about it.
 *
 * Nothing at all when the set is empty, which is the ordinary case — every brief stays the length it is
 * today, which the always-on budget cares about. When it is not empty, this tag is a burst follow-up, and it
 * is judged rather than parked: the queue that used to hold it never judged anything.
 */
function otherActiveAskLines({ brief }: { brief: TurnRoutingBrief }): readonly string[] {
  const active = brief.otherActiveAsks;
  if (active === undefined || active.length === 0) {
    return [];
  }
  return [
    `ALREADY IN FLIGHT FOR THIS ASKER — ${String(active.length)} ask(s), so this tag is a follow-up:`,
    ...active.map((ask) => `  - ${ask.channel}/${ask.messageTs} [${ask.state}] thread ${ask.threadTs}`),
    "  Judge it on its own. Answer it when it needs an answer of its own, fold it into the ask above when it",
    "  only adds to that one, and judge `no-response` when it needs nothing — never start a second worker on",
    "  a thread one is already answering, which is the double-answer this section exists to stop.",
    "",
  ];
}

/** Render the execution context and what it means for which tiers are admissible. */
function executionLines({ brief }: { brief: TurnRoutingBrief }): readonly string[] {
  const execution = brief.routingInput.execution;
  const lines = [`EXECUTION CONTEXT: mode=${execution.mode}, host=${execution.supervisorHost}`];
  if (execution.mode === "continuous-drain") {
    lines.push(
      "  This is the continuous drain loop, and this clause binds THE SESSION READING IT: the listener must",
      "  never block on a native subagent call. A tier of `read-only-subagent` will be REFUSED by `turn dispatch`.",
      "  Judge `inline` only when the answer is genuinely instant from context",
      "  alone; otherwise judge `fresh-visible-session`. It does NOT bind the worker that dispatch opens —",
      "  a worker follows `skills/loop-bot`, whose detective fan-out is mandatory (an owner ruling). A",
      '  session that must not spawn one declares it with `slopweaver session no-subagents --why "…"`, which',
      "  is a PreToolUse gate rather than prose (an owner ruling).",
    );
  } else {
    lines.push(
      "  This is a single human-driven turn — all three tiers (inline, read-only-subagent,",
      "  fresh-visible-session) are admissible on either host. A fresh worker posts its own answer, and the",
      "  supervisor tick's `turn dispatch --sweep` reconciles every open dispatch it leaves; a claude-code turn",
      "  may also wake itself to reconcile sooner — see `skills/loop-bot/reference/dispatch-and-wake.md`.",
    );
  }
  return lines;
}

/**
 * Render the brief for the session that will judge it.
 *
 * Written as instructions to an agent rather than as a report to a human, because that is who reads it: the
 * visible supervisor. It states the question, what this context can and cannot reach, and the exact shape
 * of the decision it must compose and hand to `turn dispatch` — the three things whose absence would make
 * the session invent something.
 *
 * @param brief the machine half, already built
 * @param briefPath where the brief was written, so the dispatch command can reference it
 * @param painPoints recent exact-rule observations to expose as bounded composition guidance
 * @param skills the discovered skill catalogue, ranked here against the question (empty renders the stated
 *   "no catalogue was discoverable" line rather than silence — see `./skillRouting.ts`)
 * @param censusLines what the Datadog census says this question names (`../../route/censusReading.ts`), printed
 *   beside the capability contracts so a service-named question is visibly a telemetry question; empty prints nothing
 * @param tagTree the tag decision tree for this asker, rendered by the caller from this install's own files
 *   (`./tagDecisionTreeStore.ts`) — required, because a brief that cannot say would leave steps (b) and (c) to a guess
 * @returns the brief's lines, ready to print
 */
export function renderTurnRoutingBrief({
  brief,
  briefPath,
  painPoints = [],
  skills = [],
  censusLines = [],
  tagTree,
}: {
  brief: TurnRoutingBrief;
  briefPath: string;
  painPoints?: readonly PainPointEntry[];
  skills?: readonly CatalogueSkill[];
  censusLines?: readonly string[];
  tagTree: readonly string[];
}): readonly string[] {
  return [
    `TURN ROUTING BRIEF — ${brief.surface === "dm" ? "direct message" : "channel tag"} from ${brief.userId} in ${brief.channel}`,
    `addressing message: ${brief.messageTs}`,
    `thread: ${brief.threadTs}`,
    "",
    `QUESTION: ${brief.question}`,
    "",
    ...unpromptedHelpLines({ unprompted: brief.unprompted === true }),
    ...stoodDownLines({ stoodDown: brief.stoodDown === true }),
    // Ahead of the profile and the directives, because it is the only one of the three that cannot be
    // absent: the standing answer-scope rule binds a turn on a machine whose overlay was never built. See `./briefGuidance.js`.
    ...guidance.standingAnswerScopeLines(),
    // Beside it and for the same reason: the tree is the owner's standing word on what happens to an admitted ask,
    // and a rule not named in the brief is a rule not checked. See `./tagDecisionTree.js`.
    ...tagTree,
    // What the reply may SHARE, and to whom — the answer-scope limit and its own. See `./replyDisclosure.js`.
    ...replyDisclosureLines(),
    ...guidance.judgementProfileGuidanceLines({ briefPath, profile: brief.routingInput.profile }),
    ...guidance.ownerDirectiveGuidanceLines({ briefPath, ownerDirectives: brief.routingInput.ownerDirectives }),
    ...painPointGuidanceLines({ entries: painPoints }),
    // Before any tier reasoning: a complaint quoting the bot's own last answer is a verdict on the turn that
    // just ran, not an ask to dispatch. See `./ownerDispleasure.js` for the turn that was.
    ...ownerDispleasureLines({ text: brief.routingInput.context.controlPlane.ownerAddressingText }),
    "",
    // An `inline` tier composes the answer in THIS session, so its preflight has to be here too.
    ...guidance.inlineCompositionPreflightLines({ question: brief.question }),
    "",
    // The candidates the catalogue offers for this subject. The incident's brief named none, and
    // a session reading nothing about skills concludes nothing. See `./skillRouting.js`.
    ...skillRoutingLines({ question: brief.question, skills }),
    "",
    ...otherActiveAskLines({ brief }),
    ...executionLines({ brief }),
    "",
    ...capabilityLinesOf({ brief }),
    "",
    ...(censusLines.length === 0 ? [] : [...censusLines, ""]),
    ...decisionShapeLines(),
    ...truthModeLines(),
    ...measuredFigureLines(),
    ...proposalAskLines({ text: brief.routingInput.context.controlPlane.ownerAddressingText }),
    `    slopweaver turn dispatch --brief ${briefPath} --decision <decision-file.json>`,
  ];
}
