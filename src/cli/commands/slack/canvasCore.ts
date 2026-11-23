/**
 * `slack canvas` — every DECISION, pure. The shell that touches Slack is `./canvasRun.ts`.
 *
 * ## Two creates, and the one the author has to choose between
 *
 * A STANDALONE canvas (`canvases.create`) is a document the authoring identity owns, visible to nobody
 * else until access is granted. A CHANNEL canvas (`conversations.canvases.create`) is attached to a
 * conversation: it appears in that conversation's own tab, and everyone in it can read the document the
 * moment it exists. That second one is a DISCLOSURE and the first is not, so the choice is `--channel`
 * present or absent and there is deliberately no default — a canvas that quietly became visible to a
 * channel because a flag was omitted is the failure worth designing against.
 *
 * ## A repeat mints a SECOND document, measured rather than assumed
 *
 * The obvious guess about a channel canvas is that there is one per channel and a repeat is refused. That
 * is wrong here. MEASURED against the live workspace: two calls for one conversation answered
 * `ok: true` with two different ids. So this verb carries the duplicate-send gate the poll lane uses — the
 * only protection against a re-run of the same command leaving two documents behind — and the create is
 * at-most-once at the transport (`../../../corpus/slack/writeApiCanvas.ts`).
 *
 * ## Why the body is a file rather than a flag value
 *
 * A canvas is prose measured in paragraphs. `--markdown "$(cat …)"` puts a document through one shell
 * argument, where a backtick or a `$` is interpreted and a newline may or may not survive — the same
 * reason `--form -` exists on the send verbs. So `--markdown` names a FILE, or `-` for stdin, and never
 * carries the document itself.
 *
 * ## What the scopes measured allow
 *
 * MEASURED (`slopweaver slack probe --method auth.test --scopes`, and `--bot`): BOTH tokens
 * hold `canvases:write`, so unlike `slack channel create` this verb works on either lane. `--as bot` is
 * the default because a canvas the bot authors is one the bot can later rewrite.
 */
import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { SlackActor } from "../../../outbound/slack/types.js";
import { flagValueOr, parseFlagTail } from "../../optionParsers.js";
import { SlackArgumentErrors, type SlackParsed } from "./argumentErrors.js";

/** `--markdown -` reads the canvas body from stdin, for the reason `--form -` exists on the send verbs. */
export const CANVAS_STDIN_SENTINEL = "-";

/**
 * Slack's own ceiling on a canvas title.
 *
 * Checked here rather than left to the provider because Slack TRUNCATES rather than refusing, so a title
 * that overflows produces a real document under a name the author did not choose and did not see.
 */
export const SLACK_CANVAS_TITLE_MAX = 255;

/** `slack canvas create`, parsed. */
export interface CanvasCreateOptions {
  readonly mode: "create";
  readonly actor: SlackActor;
  readonly title: string;
  readonly markdownSource: string;
  /** The channel whose canvas to mint. Absent means a standalone canvas. */
  readonly channel: string | undefined;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string;
}

/** `slack canvas replace`, parsed. */
export interface CanvasReplaceOptions {
  readonly mode: "replace";
  readonly actor: SlackActor;
  readonly canvasId: string;
  readonly markdownSource: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string;
}

/** `slack canvas delete`, parsed. */
export interface CanvasDeleteOptions {
  readonly mode: "delete";
  readonly actor: SlackActor;
  readonly canvasId: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string;
}

/** Any sub-command of `slack canvas`. */
export type CanvasOptions = CanvasCreateOptions | CanvasReplaceOptions | CanvasDeleteOptions;

/** A fully-decided create. Both `--dry-run` and the real path consume THIS, which is what keeps them equal. */
export interface CanvasCreatePlan {
  readonly actor: SlackActor;
  readonly title: string;
  readonly markdown: string;
  readonly channel: string | undefined;
  /** Who can read it the moment it exists — the one consequence the `--channel` choice actually decides. */
  readonly reach: "channel" | "author-only";
  /** The reservation key: the destination plus a digest-free identity built from the title. */
  readonly duplicateKey: string;
}

/** The flag tokens `slack canvas` accepts. Exported so `helpTruth` compares the usage against the SPEC. */
export const SLACK_CANVAS_FLAG_SPEC = {
  boolean: ["dry-run", "json"],
  value: ["as", "title", "markdown", "channel", "canvas", "home"],
} as const;

const CANVAS_SUBCOMMANDS = ["create", "replace", "delete"] as const;

/**
 * Whether a token is one of this verb's sub-commands.
 *
 * @param token the first argv entry after the verb
 * @returns true when it names a sub-command
 */
function isCanvasSubcommand(token: string | undefined): token is (typeof CANVAS_SUBCOMMANDS)[number] {
  return token !== undefined && (CANVAS_SUBCOMMANDS as readonly string[]).includes(token);
}

/** The lane and the three flags every `slack canvas` sub-command shares. */
interface CanvasShared {
  readonly actor: SlackActor;
  readonly dryRun: boolean;
  readonly home: string;
  readonly json: boolean;
}

/**
 * The lane a `--as` value names, defaulting to the bot — whose canvases the bot can later rewrite.
 *
 * @param raw the `--as` value, absent when the flag was not given
 * @param errors the accumulator a bad value is pushed onto
 * @returns the lane, or `bot` when the value was absent or rejected
 */
function parseCanvasActor({ raw, errors }: { raw: string | undefined; errors: string[] }): SlackActor {
  if (raw === undefined || raw === "bot") {
    return "bot";
  }
  if (raw === "me") {
    return "me";
  }
  errors.push(`--as must be bot or me, not ${JSON.stringify(raw)}`);
  return "bot";
}

/**
 * `slack canvas create`'s own fields, on top of the shared ones.
 *
 * Every rejection is accumulated and the narrowing guard is ONE combined condition at the end, rather than
 * an early return per missing flag. That is what lets a run with neither `--title` nor `--markdown` report
 * both in one go — and it is also what keeps `?? ""` out of the success arm, which the `house-rules` gate
 * refuses: a coalesce to the empty string turns a missing flag into a blank title Slack would accept.
 *
 * @param values the parsed flag values
 * @param shared the lane and the three flags every sub-command carries
 * @param errors the accumulator
 * @returns the invocation, or every rejection at once
 */
function parseCanvasCreate({
  values,
  shared,
  errors,
}: {
  values: Readonly<Record<string, string>>;
  shared: CanvasShared;
  errors: string[];
}): SlackParsed<CanvasCreateOptions> {
  const markdownSource = values["markdown"];
  const title = values["title"];
  if (markdownSource === undefined) {
    errors.push("slack canvas create needs --markdown <file|->");
  }
  if (title === undefined) {
    errors.push("slack canvas create needs --title <text>");
  }
  if (values["canvas"] !== undefined) {
    errors.push("--canvas names a canvas that already exists; `slack canvas create` mints a new one");
  }
  if (markdownSource === undefined || title === undefined || errors.length > 0) {
    return err(SlackArgumentErrors.argumentsRefused({ reasons: errors }));
  }
  return ok({ ...shared, channel: values["channel"], markdownSource, mode: "create", title });
}

/**
 * `slack canvas replace`'s own fields. Same accumulate-then-narrow shape as {@link parseCanvasCreate}.
 *
 * @param values the parsed flag values
 * @param shared the lane and the three flags every sub-command carries
 * @param errors the accumulator
 * @returns the invocation, or every rejection at once
 */
function parseCanvasReplace({
  values,
  shared,
  errors,
}: {
  values: Readonly<Record<string, string>>;
  shared: CanvasShared;
  errors: string[];
}): SlackParsed<CanvasReplaceOptions> {
  const markdownSource = values["markdown"];
  const canvasId = values["canvas"];
  if (markdownSource === undefined) {
    errors.push("slack canvas replace needs --markdown <file|->");
  }
  if (canvasId === undefined) {
    errors.push("slack canvas replace needs --canvas <id>");
  }
  if (markdownSource === undefined || canvasId === undefined || errors.length > 0) {
    return err(SlackArgumentErrors.argumentsRefused({ reasons: errors }));
  }
  return ok({ ...shared, canvasId, markdownSource, mode: "replace" });
}

/**
 * `slack canvas delete`'s own fields — the one sub-command that asks for no body at all.
 *
 * @param values the parsed flag values
 * @param shared the lane and the three flags every sub-command carries
 * @param errors the accumulator
 * @returns the invocation, or every rejection at once
 */
function parseCanvasDelete({
  values,
  shared,
  errors,
}: {
  values: Readonly<Record<string, string>>;
  shared: CanvasShared;
  errors: string[];
}): SlackParsed<CanvasDeleteOptions> {
  const canvasId = values["canvas"];
  if (canvasId === undefined) {
    errors.push("slack canvas delete needs --canvas <id>");
  }
  if (canvasId === undefined || errors.length > 0) {
    return err(SlackArgumentErrors.argumentsRefused({ reasons: errors }));
  }
  return ok({ ...shared, canvasId, mode: "delete" });
}

/**
 * Parse the `slack canvas` tail into a checked invocation.
 *
 * @param rest the argv tail, after `slopweaver slack canvas`
 * @param defaultHome the home to use when `--home` is absent
 * @returns the parsed invocation, or every rejection at once
 */
export function parseCanvasArgs({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): SlackParsed<CanvasOptions> {
  const sub = rest[0];
  if (!isCanvasSubcommand(sub)) {
    return err(SlackArgumentErrors.canvasSubcommandUnknown({ got: sub, known: CANVAS_SUBCOMMANDS }));
  }
  const parsed = parseFlagTail({ rest: rest.slice(1), spec: SLACK_CANVAS_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(SlackArgumentErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];
  const shared: CanvasShared = {
    actor: parseCanvasActor({ errors, raw: values["as"] }),
    dryRun: flags.has("dry-run"),
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
  };
  if (sub === "create") {
    return parseCanvasCreate({ errors, shared, values });
  }
  return sub === "replace"
    ? parseCanvasReplace({ errors, shared, values })
    : parseCanvasDelete({ errors, shared, values });
}

/**
 * Build the create plan, or every reason it was refused.
 *
 * An EMPTY body is refused rather than sent. Slack accepts one and mints a blank document, which is the
 * silent outcome of a `--markdown` path that did not exist or a stdin nobody piped into — and the author
 * would learn about it by opening Slack rather than from this command.
 *
 * @param options the parsed invocation
 * @param markdown the canvas body, already read from the file or stdin
 * @returns the plan both the dry run and the real create consume
 */
export function buildCanvasCreatePlan({
  options,
  markdown,
}: {
  options: CanvasCreateOptions;
  markdown: string;
}): Result<CanvasCreatePlan> {
  const problems: string[] = [];
  if (markdown.trim().length === 0) {
    problems.push(
      "REFUSING to create an EMPTY canvas — Slack accepts one and mints a blank document, which is what an " +
        "unreadable --markdown path or an empty stdin looks like. Nothing was created.",
    );
  }
  // Counted in CHARACTERS a reader sees, via `Array.from` — see `channelName.ts` for why not a spread.
  const titleLength = Array.from(options.title).length;
  if (titleLength > SLACK_CANVAS_TITLE_MAX) {
    problems.push(
      `a canvas title is cut at ${String(SLACK_CANVAS_TITLE_MAX)} characters and this one is ` +
        `${String(titleLength)}. Slack truncates rather than refusing, so the document would carry a name ` +
        "you never chose.",
    );
  }
  if (options.title.trim().length === 0) {
    problems.push("--title cannot be blank: a canvas with no title is unfindable in Slack's own search.");
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    actor: options.actor,
    channel: options.channel,
    duplicateKey: createDuplicateKey({ options }),
    markdown,
    reach: options.channel === undefined ? "author-only" : "channel",
    title: options.title,
  });
}

/**
 * The door's duplicate key for a create: one per destination and title, where a create with no `--channel`
 * is keyed to the standalone destination rather than to a channel it never names.
 *
 * @param options the parsed create
 * @returns the duplicate key
 */
function createDuplicateKey({ options }: { options: CanvasCreateOptions }): string {
  if (options.channel === undefined) {
    return `slack-canvas-create:standalone:${options.title}`;
  }
  return `slack-canvas-create:${options.channel}:${options.title}`;
}

/**
 * Where a create lands, as the run's report names it: the channel, or a standalone canvas when the create
 * named none.
 *
 * @param plan the fully-decided create
 * @returns the channel id, or `a standalone canvas`
 */
export function canvasDestination({ plan }: { plan: CanvasCreatePlan }): string {
  if (plan.channel === undefined) {
    return "a standalone canvas";
  }
  return plan.channel;
}

/**
 * The dry run: what would be created, and — the part that matters — who would be able to read it.
 *
 * @param plan the fully-decided create
 * @returns the lines to print
 */
export function canvasCreateDryRunLines({ plan }: { plan: CanvasCreatePlan }): readonly string[] {
  const call =
    plan.channel === undefined ? "canvases.create" : `conversations.canvases.create channel_id=${plan.channel}`;
  return [
    `DRY RUN — nothing was created. As ${plan.actor === "bot" ? "the bot" : "you"}, slopweaver would:`,
    `  1. ${call} title=${JSON.stringify(plan.title)}`,
    `  body: ${String(plan.markdown.length)} characters, ${String(plan.markdown.split("\n").length)} line(s)`,
    plan.channel === undefined
      ? "  nobody but you could read it until access is granted."
      : `  EVERYONE IN ${plan.channel} could read it the moment it exists.`,
  ];
}

/**
 * The door request for a canvas write. The ledger records the operation, the lane, the destination and the
 * body's SIZE — never the body, which is a document the operator wrote and the ledger is not its archive.
 *
 * @param operation which of the three canvas writes this is
 * @param actor the lane it runs on
 * @param home the state home whose ledger records the decision
 * @param target the channel for a channel canvas, the canvas id for a replace or delete, absent for a
 *   standalone create — the one field that says WHERE the effect lands
 * @param bodyLength how many characters the body carries, so a blank write is visible in the record
 * @returns the request the door judges
 */
export function canvasDoorRequest({
  operation,
  actor,
  home,
  target,
  bodyLength,
  duplicateKey,
}: {
  operation: "create" | "replace" | "delete";
  actor: SlackActor;
  home: string;
  target: string | undefined;
  bodyLength: number;
  duplicateKey: string | undefined;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "slack", verb: "canvas" },
    artifact: {
      actor,
      bodyLength,
      operation,
      reach: operation === "create" && target === undefined ? "author-only" : "named-target",
      // The field `duplicateSendGate` matches on, and it is REQUIRED here rather than optional
      // because a gate that never matches is worse than no gate: it was wired, ran on every create, and
      // silently found nothing, so the only thing stopping a second document was the reservation one layer
      // further in. Absent for `replace`/`delete`, which have no duplicate to prevent.
      ...(duplicateKey === undefined ? {} : { duplicateKey }),
      ...(target === undefined ? {} : { target }),
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  } satisfies DoorRequest;
}
