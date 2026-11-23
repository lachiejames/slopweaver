/**
 * The `investigate` kind's EXECUTOR — and the whole of what "the clock joins the ask lane" means in code.
 *
 * The clock joins the EXISTING ask lane rather than getting one of its own. `./kinds.ts` registers the kind
 * and `./definition.ts` holds its row; this module executes it.
 *
 * ## The clock is a sender, so it SENDS — but it sends PRIVATELY
 *
 * A due row's question is posted as the bot, through the same `slack post` door every other outbound write
 * goes through — and the ts of that message IS the ask's address. From that instant the row is an ordinary
 * ask: the same `asks.jsonl` lifecycle (`../ask/lifecycle.ts`), the same
 * `turn brief` → `turn dispatch` → `turn answer` path, the same outbound form. Nothing downstream can tell
 * an automation from a tag, because there is nothing downstream to tell.
 *
 * **It is posted into the one PRIVATE conversation, never the row's audience.** Posting the question into whichever
 * channel the row named would have a daily row ask its own internal prompt — "FIRST run the verb with `--json`
 * … AFTER it lands, rerun it with the posted ts" — in a team channel, where the team reads what the bot
 * had been told to do, which embarrasses the owner in public. So
 * `params.channel` is checked against `slackBot.promptChannel` at plan time and refused when it differs,
 * the payload declares itself `automation-prompt` so the DOOR refuses the same thing at the wire
 * (`outbound/slack/automationPromptChannel.ts`), and `params.postTo` carries the audience the FINISHED
 * card goes to — the same two-field shape `./alertSummary.ts` has always had.
 *
 * The alternative — widening `AskIdentity` to carry a non-Slack sender — was rejected for a reason this
 * repository has already measured. The identity triple is extended by `TurnRoutingBrief`, `AnswerableBrief`,
 * every lifecycle event and every poster boundary; a clock ask given a synthetic `messageTs` would put a
 * value that is not a Slack ts into a field every one of those readers believes is one, which is the class
 * `.claude/rules/typescript-patterns.md`'s epoch section carries the cost of. Posting the question mints
 * nothing: the address is a real message's real ts. It also fixes the ORDER — `turn answer` replies inside a
 * thread, and a clock ask with no message would have no thread to reply in.
 *
 * ## The opening message never tags the bot
 *
 * {@link investigateFormArtifact} builds a payload that derives a plain no-fold message. A tag in it would
 * be captured a SECOND time by a running listener — one slot, two asks — so the absence is a property with
 * its own assertion, not a stylistic choice.
 *
 * ## Nothing here spawns a model
 *
 * The row runner posts and briefs, and stops. Whether the ask is answered inline, by a read-only subagent or
 * by a fresh visible session is the ask lane's own judgement, taken by a session the owner can see (doctrine
 * rule 2: an automation is run or spawned BY THE SUPERVISOR). That is the fold
 * doing its work — the spawn decision stops being the recipe tick's and becomes the one the lane already
 * makes for every tag.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { noFoldAboveFoldCells } from "../../outbound/artifact/aboveFold.js";
import { AUTOMATION_PROMPT_KIND, checkAutomationPrompt } from "../../outbound/artifact/automationPrompt.js";
import type { NoFoldArtifact } from "../../outbound/artifact/types.js";
import { aboveFoldFindings } from "../../outbound/voice/aboveFold.js";
import type { RecipeDefinition } from "./definition.js";
import { type InvestigateError, InvestigateErrors } from "./investigateErrors.js";
import { BRIEFING_KIND } from "./kinds.js";

/** The kind this module executes — the one open, briefing-only kind `./kinds.ts` registers. */
export const INVESTIGATE_KIND = BRIEFING_KIND;

/** What an `investigate` row's `params` must hold. */
const investigateParamsSchema = z
  .object({
    /**
     * The Slack user id this standing ask belongs to. It is put through the responder whitelist by
     * `turn brief` itself, exactly as a live tag's author is — a row naming an id the whitelist does not
     * carry is refused there, which is the one place that judgement is made.
     */
    askedBy: z.string().min(1),
    /**
     * Where the question is ASKED, and so where the briefing lands and the answering session threads.
     *
     * It must be the install's configured prompt conversation — see this module's header. A row naming
     * anything else is refused at plan time AND at the door, with no hatch either side.
     */
    channel: z.string().min(1),
    /**
     * Where the FINISHED card goes, when that is not the conversation the question was asked in.
     *
     * Named and defaulted exactly as `./alertSummary.ts`'s is: absent means the answer stays where the
     * question was asked. It is a field rather than a sentence in `question` because the leaked row carried
     * its destination as the word "here", which meant the prompt's own channel.
     */
    postTo: z.string().min(1).optional(),
    /** The standing question, verbatim — what the bot is being asked, every firing. */
    question: z.string().min(1),
  })
  .strict();

/** One `investigate` row resolved: who is asking, where, and what. */
export interface InvestigatePlan {
  readonly recipeId: string;
  /** The private conversation the question is asked in — the ask's own address. */
  readonly channel: string;
  /** Where the finished card goes, absent when it stays in the conversation the question was asked in. */
  readonly postTo: string | undefined;
  readonly askedBy: string;
  readonly question: string;
  /**
   * Which surface the ask lane is briefed with, derived from {@link channel} rather than assumed.
   *
   * It was the literal `"channel"` until the prompt moved into a DM, and two live gates read it:
   * `admit/askerTagGate.ts` EXEMPTS a DM answer from tagging the asker, and
   * `admit/documentDeliverableGate.ts` skips the local-page-path finding there. Left at `"channel"` the
   * answering session would be forced to tag the owner inside their own 1:1 and refused for citing a path only
   * their machine resolves — neither of which is true of a DM.
   */
  readonly surface: "channel" | "dm";
  /** The opening message's form document, already validated against the schema `slack post` will apply. */
  readonly form: string;
}

/**
 * Which surface the ask lane is briefed with, derived from the conversation id.
 *
 * The same test `../listen/recover.ts` applies to a captured event, restated here rather than imported
 * because that module is the listener's own recovery path and importing it into a pure planner to reuse one
 * comparison would couple two lanes that share nothing else. What matters is that the answer is DERIVED: it
 * was a hardcoded `"channel"` until the prompt moved into a DM, and two gates read it (see
 * {@link InvestigatePlan.surface}).
 *
 * @param channel the conversation the question is asked in
 * @returns which surface the ask lane should be told this is
 */
function surfaceOf({ channel }: { channel: string }): "channel" | "dm" {
  if (channel.startsWith("D")) {
    return "dm";
  }
  return "channel";
}

/**
 * The opening message's PAYLOAD, as the form document `slack post --as bot --form` takes.
 *
 * A `automation-prompt` rather than a bare `no-fold`, and that is the whole door half of the private prompt
 * rule: the payload declares what it is, so `cli/commands/slack/run.ts` can refuse it anywhere but the
 * configured private conversation. It DERIVES a no-fold message (`outbound/artifact/automationPrompt.ts`)
 * — a question is the one thing a reader must never have to expand to see — and the trailing runs say which
 * row asked it and, when the row names one, where the finished card goes.
 *
 * @param question the standing question, verbatim
 * @param recipeId the row that asked it
 * @param postTo where the finished card goes, absent when it stays in the conversation asked in
 * @returns the form payload, ready to validate and serialise
 */
export function investigateFormArtifact({
  question,
  recipeId,
  postTo,
}: {
  readonly question: string;
  readonly recipeId: string;
  readonly postTo: string | undefined;
}): Readonly<Record<string, unknown>> {
  if (postTo === undefined) {
    return { kind: AUTOMATION_PROMPT_KIND, prompt: question, recipeId };
  }
  return { kind: AUTOMATION_PROMPT_KIND, postTo, prompt: question, recipeId };
}

/**
 * Where one Zod issue points, named rather than left blank when it points at the whole input.
 *
 * Written as an `if` rather than an `||` default: an issue whose path is empty is a real, distinct case —
 * the input itself is wrong rather than one of its fields — and it is the reader of the refusal who needs
 * that said out loud.
 *
 * @param path the issue's own path, empty when it names the whole input
 * @param whole what to call the input when the path is empty
 * @returns the dotted path, or `whole`
 */
function issueLocation({ path, whole }: { path: readonly PropertyKey[]; whole: string }): string {
  const joined = path.join(".");
  if (joined.length === 0) {
    return whole;
  }
  return joined;
}

/**
 * The packing violations in one composed opening message, or none at all when the hatch is open.
 *
 * The cells come from {@link noFoldAboveFoldCells} rather than being rebuilt here, because that is the exact
 * call the door makes (`../../cli/commands/slack/runAdmit.ts`): it puts the `trailing` run in scope and it
 * skips links, mentions, citations and quoted runs, none of which is authored prose. Restating the cell
 * construction is how the two would drift apart again.
 */
function voiceFindings({
  artifact,
  voiceOverridden,
}: {
  artifact: NoFoldArtifact;
  voiceOverridden: boolean;
}): readonly string[] {
  if (voiceOverridden) {
    return [];
  }
  return aboveFoldFindings({ cells: noFoldAboveFoldCells({ artifact }), rules: [] }).map(
    (finding) => `${finding.path}: ${finding.message}`,
  );
}

/**
 * Turn one `investigate` row into a runnable plan, or say exactly why it is not one.
 *
 * Pure: it reads the row and validates the message it would send, and posts nothing. The form is checked
 * here with the SAME schema `slack post` applies at the wire, so an over-width question is refused naming
 * its recipe rather than reaching the door and being refused there naming nothing.
 *
 * The PACKING rules are checked here for the same reason, over the same cells the door builds
 * (`noFoldAboveFoldCells`, so the `trailing` run is in scope and a typed run is not read as prose). A
 * question is row state rather than a composition, so a wording the door refuses is refused at EVERY firing
 * — the row never exits 0, nothing stamps the slot, and the next tick asks the same refused question. That
 * is the argument `skills/automation/reference/first-day.md` already makes for a card row's own intro
 * lines, and `introLineSchema` (`../../outbound/artifact/introAndRank.ts`) is where it is already written as
 * one more refinement; an `investigate` row's `question` was the member of that class nothing checked.
 *
 * **`voiceOverridden` is not optional, and that is the whole reason it is a parameter.** The door lifts this
 * same family of refusals under a `voice-rules` grant (`../../cli/aboveFoldDoor.ts`), and taking that grant
 * before `slopweaver automation run-due` is exactly what somebody does to force one firing past it. A check that refused there anyway would be a refusal whose own escape does not
 * work, which `.claude/rules/error-handling.md` names as the wedge that lane exists to avoid. So the caller
 * reads the hatch and this decides nothing about it; a default here would be the `hatch-release` shape the
 * gate refuses outright.
 *
 * **The residue, stated rather than discovered**, and the same residue `first-day.md` already records for an
 * intro line: the operator's PRIVATE exact voice rules and the measured length register are loaded out of
 * `$SLOPWEAVER_HOME`, so a pure check cannot run them and they still fire only at the post leg. The same holds
 * for EVERY door check that reads the state home — resolving a bare `#<number>` against the configured
 * repositories and a `<@U…>` mention against the roster are two — so a question this admits can still be
 * refused there. With the override honoured, this check is a strict subset of the door's and can never
 * refuse what the door admits.
 *
 * **`promptChannel` is not optional either, and for the OPPOSITE reason to `voiceOverridden`'s.** That one
 * is a parameter so a hatch can open; this one is a parameter so no default can close it. A default here
 * would be a destination nobody chose, and an `undefined` reaching this function is a real, distinct state —
 * an install that has configured no private conversation — which refuses rather than guesses.
 *
 * @param definition the parsed row, already known to select the `investigate` kind
 * @param voiceOverridden whether the caller found the voice hatch open for this invocation
 * @param promptChannel the one conversation `slackBot.promptChannel` names, absent when none is configured
 * @returns the plan, or the one reason this row may not run
 */
export function planInvestigate({
  definition,
  voiceOverridden,
  promptChannel,
}: {
  definition: RecipeDefinition;
  voiceOverridden: boolean;
  promptChannel: string | undefined;
}): Result<InvestigatePlan, InvestigateError> {
  const parsed = parsedInvestigateParams({ definition });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const params = parsed.value;
  // FIRST, before anything about the message's own shape: a question asked in the wrong room is refused on
  // where it is going, and no wording makes that admissible. Checked here as well as at the door because a
  // row refused here never posts at all, and the refusal can name the row's own file and the exact edit.
  if (promptChannel === undefined || params.channel !== promptChannel) {
    return err(
      InvestigateErrors.promptChannelPublic({
        channel: params.channel,
        promptChannel,
        recipeId: definition.recipeId,
      }),
    );
  }
  const checked = checkedInvestigateForm({ params, recipeId: definition.recipeId, voiceOverridden });
  if (checked.isErr()) {
    return err(checked.error);
  }
  return ok({
    askedBy: params.askedBy,
    channel: params.channel,
    form: safeJsonStringify({ label: `investigate form for ${definition.recipeId}`, value: checked.value }),
    postTo: params.postTo,
    question: params.question,
    recipeId: definition.recipeId,
    surface: surfaceOf({ channel: params.channel }),
  });
}

/** An `investigate` row's `params`, parsed. */
type InvestigateParams = z.infer<typeof investigateParamsSchema>;

/**
 * Parse one row's `params` as an `investigate` configuration, naming every issue against the row.
 *
 * @param definition the row, already known to select the `investigate` kind
 * @returns the parsed params, or `PARAMS_INVALID` carrying each issue
 */
function parsedInvestigateParams({
  definition,
}: {
  definition: RecipeDefinition;
}): Result<InvestigateParams, InvestigateError> {
  const parsed = investigateParamsSchema.safeParse(definition.params);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issueLocation({ path: issue.path, whole: "params" })}: ${issue.message}`,
    );
    return err(InvestigateErrors.paramsInvalid({ issues, recipeId: definition.recipeId }));
  }
  return ok(parsed.data);
}

/**
 * Build the opening message's payload and put it through the door's own form schema, then its packing rules.
 *
 * The ONE place both {@link planInvestigate} and {@link unaskableInvestigateRows} run these checks, so what a
 * `automation due` tick reports as unaskable and what a firing refuses can never disagree. It is the door's OWN
 * schema rather than a restatement of it: the form's field caps (the prompt's 500) bind before the 650-char
 * message they derive, and checking the derived message alone admitted a 542-char question the door then
 * refused at every firing (`datadog-regression-hunt-daily`).
 *
 * @param params the row's parsed params
 * @param recipeId the row, so a refusal names it
 * @param voiceOverridden whether the caller found the voice hatch open, which skips the packing rules
 * @returns the form payload, or `FORM_REFUSED` / `VOICE_REFUSED`
 */
function checkedInvestigateForm({
  params,
  recipeId,
  voiceOverridden,
}: {
  params: InvestigateParams;
  recipeId: string;
  voiceOverridden: boolean;
}): Result<Readonly<Record<string, unknown>>, InvestigateError> {
  const payload = investigateFormArtifact({ postTo: params.postTo, question: params.question, recipeId });
  const checked = checkAutomationPrompt({ raw: payload });
  if (checked.isErr()) {
    return err(InvestigateErrors.formRefused({ issues: checked.error, recipeId }));
  }
  const packing = voiceFindings({ artifact: checked.value, voiceOverridden });
  if (packing.length > 0) {
    return err(InvestigateErrors.voiceRefused({ issues: packing, recipeId }));
  }
  return ok(payload);
}

/**
 * Every ENABLED `investigate` row whose own question refuses at every firing.
 *
 * A row's question is state under the home, never in git, so no test can read the registered rows: this is
 * the check over every one of them, and `automation due` runs it on every supervisor tick. Without it, a question
 * grown past the prompt cap is refused only when its slot fires — `datadog-regression-hunt-daily` at 769
 * characters, refused with the hunt already late. Its first rewrite fit the cap and
 * still packed a list behind a colon, which the packing rules refuse just as surely, so both are checked.
 *
 * The packing rules run with the voice hatch CLOSED: a hatch opened for one deliberate firing is not the
 * row's standing state, and the refusal's own message names the hatch. The prompt-conversation check is left
 * to the firing, because it needs the profile and this is a fact of the row alone. A disabled row is skipped
 * because it has no firing to lose.
 *
 * @param definitions every parsed row in the store
 * @returns one refusal per row whose params do not parse, or whose question the form or packing rules refuse
 */
export function unaskableInvestigateRows({
  definitions,
}: {
  definitions: readonly RecipeDefinition[];
}): readonly InvestigateError[] {
  return definitions
    .filter((definition) => definition.enabled && definition.kind === INVESTIGATE_KIND)
    .flatMap((definition) => {
      const checked = parsedInvestigateParams({ definition }).andThen((params) =>
        checkedInvestigateForm({ params, recipeId: definition.recipeId, voiceOverridden: false }),
      );
      if (checked.isErr()) {
        return [checked.error];
      }
      return [];
    });
}

/**
 * The argv tail `slack post` is run with to ask the question.
 *
 * `--json` rather than the human lines, because this leg's OUTPUT is the next leg's input: the posted
 * message's own ts is the ask's address, and {@link investigateOpenTs} reads it back off this document.
 *
 * @param dryRun whether to go down the real send path and stop at the wire
 * @param home the state home this tick is running over
 * @param plan the resolved plan
 * @returns the argv tail after `slack post`
 */
export function investigateOpenRest({
  dryRun,
  home,
  plan,
  idempotencyKey,
}: {
  dryRun: boolean;
  home: string;
  plan: InvestigatePlan;
  /**
   * The firing's own delivery id (`live/automation/slotLedger.ts#slotDeliveryKey`), so the door refuses a
   * second delivery of one firing rather than warning about words that have since moved on.
   */
  idempotencyKey: string;
}): readonly string[] {
  const base = [
    "--as",
    "bot",
    "--channel",
    plan.channel,
    "--form",
    plan.form,
    "--home",
    home,
    "--idempotency-key",
    idempotencyKey,
    // The prompt of a recipe the owner set up, which only ever goes to their DM: a message they asked for.
    "--dm-purpose",
    "asked-for",
    "--json",
  ];
  return dryRun ? [...base, "--dry-run"] : base;
}

/** What the opening post's own `--json` document said. */
export interface InvestigateOpenReport {
  /** The posted message's ts — the ask's address. `null` on a dry run, or when nothing was sent. */
  readonly ts: string | null;
  /** The lines a dry run would have shown, so a withheld send still prints the message a channel would see. */
  readonly preview: readonly string[];
}

/** Just the fields the next leg needs; everything else `slack post` reports is deliberately not read here. */
const openReportSchema = z.object({
  preview: z.array(z.string()).default([]),
  sent: z
    .object({ ts: z.string().min(1) })
    .nullable()
    .default(null),
});

/**
 * Read the posted message's address back off the `--json` document.
 *
 * The document is refused rather than guessed at: a tick that invented an address would brief an ask against
 * a message that does not exist, and every later verb would resolve that key to nothing.
 *
 * @param document the one JSON document `slack post --json` emitted
 * @param recipeId the row whose question was asked, so a refusal names it
 * @returns the address and preview, or the one reason the document could not be read
 */
export function investigateOpenTs({
  document,
  recipeId,
}: {
  document: string;
  recipeId: string;
}): Result<InvestigateOpenReport, InvestigateError> {
  let raw: unknown;
  try {
    raw = safeJsonParse({ label: "slack post --json report", text: document });
  } catch (error) {
    const why = error instanceof Error ? error.message : "the document is not JSON at all";
    return err(InvestigateErrors.reportUnreadable({ recipeId, why: `slack post --json ${why}` }));
  }
  const parsed = openReportSchema.safeParse(raw);
  if (!parsed.success) {
    return err(
      InvestigateErrors.reportUnreadable({
        recipeId,
        why: `slack post --json emitted a document with no readable \`sent\`/\`preview\`: ${parsed.error.message}`,
      }),
    );
  }
  const sent = parsed.data.sent;
  if (sent === null) {
    return ok({ preview: parsed.data.preview, ts: null });
  }
  return ok({ preview: parsed.data.preview, ts: sent.ts });
}

/**
 * The full process argv that briefs the posted question as an ask.
 *
 * `--message-ts` and `--thread-ts` are the SAME ts on purpose, and it is not the reconstruction
 * `../ask/identity.ts` forbids: this message started its own thread, so its own ts genuinely is the thread
 * root. `turn brief` captures the ask onto `asks.jsonl` itself, which is why this leg is the whole of
 * joining the lane.
 *
 * @param messageTs the posted message's own ts
 * @param home the state home this tick is running over
 * @param plan the resolved plan
 * @returns the argv to hand the dispatcher
 */
export function investigateBriefArgv({
  messageTs,
  home,
  plan,
}: {
  messageTs: string;
  home: string;
  plan: InvestigatePlan;
}): readonly string[] {
  return [
    "node",
    "slopweaver",
    "turn",
    "brief",
    "--channel",
    plan.channel,
    "--message-ts",
    messageTs,
    "--thread-ts",
    messageTs,
    "--user",
    plan.askedBy,
    "--text",
    plan.question,
    "--surface",
    plan.surface,
    "--home",
    home,
  ];
}
