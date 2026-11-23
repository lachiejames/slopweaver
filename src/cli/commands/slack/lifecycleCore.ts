/**
 * The PURE core of the lifecycle verbs — `slack edit` and `slack delete`.
 *
 * Deliberately NOT folded into `./core.ts`'s `SlackWriteVerb`. That union is `"post" | "reply"`, and `edit`
 * and `delete` stay their own verbs here because they mutate an EXISTING `ts`
 * rather than sending a new one, which is a different shape of operation with its own ownership question.
 *
 * `edit`/`delete` DO now take `--as`, same two values as `post`/`reply` (`bot` | `me`), because a human
 * routinely wants the bot to fix up a message they posted themselves — see `EditMeOptions`/`DeleteOptions.actor`.
 * A DRIP of N messages is still not editable — "which message of N do you edit?" has no reference answer —
 * so `--as me` here accepts only a SINGLE message (one `--form` message or the `--body` escape hatch), never
 * the multi-message `kind: "drip"` shape `post --as me` sends.
 *
 * Everything a reviewer needs to answer "what would this mutate, and would it need approval?" is decidable
 * from this file. The shell (`./lifecycleRun.ts`) holds the I/O and nothing else.
 */
import type { DoorRequest } from "../../../admit/types.js";
import { err, ok } from "../../../lib/result.js";
import type { SlackActor } from "../../../outbound/slack/types.js";
import { flagValueOr, type ParsedFlagTail, parseFlagTail } from "../../optionParsers.js";
import { SlackArgumentErrors, type SlackParsed, slackArgumentErrorLines } from "./argumentErrors.js";
import { ALLOW_UNRESOLVED_OWNER_FLAG, type DripSource, parseDripSource } from "./core.js";

/** `--form -` reads from stdin, matching the send lane's convention. */
export const STDIN_SENTINEL = "-";

/**
 * The card `metadata.event_type` values an edit or delete of a CARD accepts.
 *
 * The STOCK type is accepted alongside the operator's configured one, and that is a migration guarantee
 * rather than laxity. The ownership guard recognises its own work BY event type, so an operator who renames
 * theirs — the expected move, since the stock name puts this tool's name in metadata attached to a message
 * their team reads — would otherwise make every card already posted permanently un-editable and un-deletable.
 * Widening is safe because the OTHER half of the guard still requires the message to carry this bot's id; all
 * this admits is a card THIS bot posted before the rename.
 *
 * @param configuredEventType the operator's `cardChrome.metadataEventType`
 * @param stockEventType the shipped default, accepted for backwards compatibility
 * @returns the accepted event types, deduplicated (they coincide on an unconfigured profile)
 */
export function cardEventTypes({
  configuredEventType,
  stockEventType,
}: {
  configuredEventType: string;
  stockEventType: string;
}): readonly string[] {
  return [...new Set([configuredEventType, stockEventType])];
}

/** What every lifecycle verb needs. */
interface LifecycleCommon {
  readonly home: string;
  readonly dryRun: boolean;
  readonly json: boolean;
}

/**
 * A parsed `slack edit --as bot` (the default when `--as` is absent) — re-render a CARD from a new form.
 *
 * Unchanged in shape from before `--as` existed on this verb: the bot-card lane's ownership check and
 * behaviour are not touched by this file's `--as me` addition.
 */
export interface EditCardOptions extends LifecycleCommon {
  readonly actor: "bot";
  /** See {@link ALLOW_UNRESOLVED_OWNER_FLAG} — off by default, so a broken ping refuses rather than ships. */
  readonly allowUnresolvedOwner: boolean;
  readonly kind: "edit";
  readonly channel: string;
  readonly ts: string;
  readonly formJson: string;
}

/**
 * A parsed `slack edit --as me` — replace the words of ONE message the human posted, in place.
 *
 * No `allowUnresolvedOwner`: an as-me message has no digest owner field to degrade, same as `post --as me`.
 * `source` takes the same two shapes `post`/`reply` accept (`--form` or `--body`), but the rendered result
 * must resolve to exactly ONE message — see `requireSingleDripMessage`.
 */
export interface EditMeOptions extends LifecycleCommon {
  readonly actor: "me";
  readonly kind: "edit";
  readonly channel: string;
  readonly ts: string;
  readonly source: DripSource;
}

/**
 * A parsed `slack edit`, discriminated on `actor` rather than one options object with half its fields
 * optional — the two lanes genuinely take different flags, same reasoning as `SlackWriteOptions` in
 * `./core.ts`.
 */
export type EditOptions = EditCardOptions | EditMeOptions;

/**
 * A parsed `slack delete`.
 *
 * Unlike `edit`, both actors need exactly the same fields — a delete carries no content — so `actor` is a
 * plain field rather than a second variant. The BEHAVIOUR still branches once, cleanly, in `./lifecycleRun.js`;
 * this is not the "one path with a flag" the ruling in the handover doc warns against, because there is no
 * ownership-guard logic here for a flag to thread through.
 */
export interface DeleteOptions extends LifecycleCommon {
  readonly kind: "delete";
  readonly actor: SlackActor;
  readonly channel: string;
  readonly ts: string;
}

/** Any parsed lifecycle invocation. */
export type LifecycleOptions = EditOptions | DeleteOptions;

/**
 * `slack edit`'s flag spec. EXPORTED because the help/flag ratchet derives the verb's advertised set from
 * the very object the parser tokenises with — an exported name LIST would be a second declaration that can
 * drift from the parser, which is the drift this verb was the worked example of.
 */
export const SLACK_EDIT_FLAG_SPEC = {
  boolean: [ALLOW_UNRESOLVED_OWNER_FLAG, "dry-run", "json"],
  value: ["as", "body", "channel", "form", "home", "ts"],
} as const;

/** `slack delete`'s flag spec, exported for the ratchet exactly as {@link SLACK_EDIT_FLAG_SPEC} is. */
export const SLACK_DELETE_FLAG_SPEC = {
  boolean: ["dry-run", "json"],
  value: ["as", "channel", "home", "ts"],
} as const;

/** A required non-empty string flag. */
function required({ value, flag }: { value: string | undefined; flag: string }): SlackParsed<string> {
  if (value === undefined || value.length === 0) {
    return err(SlackArgumentErrors.flagRequired({ flag }));
  }
  return ok(value);
}

/** Pool the errors of several results, in order. */
function errorsOf({ results }: { results: readonly SlackParsed<unknown>[] }): readonly string[] {
  return results.flatMap((result) => (result.isOk() ? [] : slackArgumentErrorLines({ error: result.error })));
}

/** The flags every verb shares. */
function commonOf({ parsed, defaultHome }: { parsed: ParsedFlagTail; defaultHome: string }): LifecycleCommon {
  const { flags } = parsed;
  return {
    dryRun: flags.has("dry-run"),
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed }),
    json: flags.has("json"),
  };
}

/**
 * `--as` for `edit`/`delete` — defaults to `bot` rather than being required, unlike `post`/`reply`.
 *
 * `post`/`reply` never defaulted because they are new sends with no prior behaviour to preserve. `edit` and
 * `delete` are not new: every existing invocation omits `--as` and means the bot-card lane, so requiring it
 * now would break every caller that has never heard of `--as me`. Defaulting to `bot` is what "bot-card
 * edit/delete keep their exact current behaviour, unchanged" (the handover doc's ruling) means in code.
 *
 * @param value the raw `--as` value, or undefined when the flag was omitted
 * @returns the actor, defaulting to `bot`, or a refusal naming the one other valid value
 */
function parseLifecycleActor({ value }: { value: string | undefined }): SlackParsed<SlackActor> {
  if (value === undefined) {
    return ok("bot");
  }
  if (value === "bot" || value === "me") {
    return ok(value);
  }
  return err(SlackArgumentErrors.actorInvalid({ got: value }));
}

/**
 * Assemble `slack edit --as bot` (or no `--as` at all) — unchanged from before `--as` existed here.
 *
 * `channel`/`ts` arrive as `Result`s rather than plain strings, and `commonErrors` already carries their
 * failures: pooling every rejection (channel, ts, form) in ONE pass is the same property
 * `parseSlackWriteArgs` in `./core.ts` protects for `post`/`reply` — a caller fixing one flag at a time
 * should not have to re-run to discover the next one.
 */
function editCardOptions({
  channel,
  commonErrors,
  commonFields,
  flags,
  ts,
  values,
}: {
  channel: SlackParsed<string>;
  commonErrors: readonly string[];
  commonFields: LifecycleCommon;
  flags: ReadonlySet<string>;
  ts: SlackParsed<string>;
  values: Readonly<Record<string, string | undefined>>;
}): SlackParsed<EditOptions> {
  const form = required({ flag: "--form", value: values["form"] });
  const errors = [
    ...commonErrors,
    ...(form.isOk() ? [] : slackArgumentErrorLines({ error: form.error })),
    ...(values["body"] !== undefined ? [SlackArgumentErrors.bodyRefusedOnBot().message] : []),
  ];
  if (errors.length > 0) {
    return err(SlackArgumentErrors.argumentsRefused({ reasons: errors }));
  }
  if (!(channel.isOk() && ts.isOk() && form.isOk())) {
    return err(SlackArgumentErrors.invocationIncoherent({ verb: "edit" })); // unreachable: no errors ⇒ every part is ok
  }
  return ok({
    ...commonFields,
    actor: "bot",
    allowUnresolvedOwner: flags.has(ALLOW_UNRESOLVED_OWNER_FLAG),
    channel: channel.value,
    formJson: form.value,
    kind: "edit",
    ts: ts.value,
  });
}

/** Assemble `slack edit --as me` — one message, from `--form` or `--body`, no digest owner field to degrade. */
function editMeOptions({
  channel,
  commonErrors,
  commonFields,
  flags,
  ts,
  values,
}: {
  channel: SlackParsed<string>;
  commonErrors: readonly string[];
  commonFields: LifecycleCommon;
  flags: ReadonlySet<string>;
  ts: SlackParsed<string>;
  values: Readonly<Record<string, string | undefined>>;
}): SlackParsed<EditOptions> {
  const source = parseDripSource({ body: values["body"], form: values["form"] });
  const errors = [
    ...commonErrors,
    ...(source.isOk() ? [] : slackArgumentErrorLines({ error: source.error })),
    ...(flags.has(ALLOW_UNRESOLVED_OWNER_FLAG) ? [SlackArgumentErrors.ownerPingFlagRefusedOnMe().message] : []),
  ];
  if (errors.length > 0) {
    return err(SlackArgumentErrors.argumentsRefused({ reasons: errors }));
  }
  if (!(channel.isOk() && ts.isOk() && source.isOk())) {
    return err(SlackArgumentErrors.invocationIncoherent({ verb: "edit" })); // unreachable: no errors ⇒ every part is ok
  }
  return ok({ ...commonFields, actor: "me", channel: channel.value, kind: "edit", source: source.value, ts: ts.value });
}

/**
 * Parse `slack edit`.
 *
 * @param rest the argv tail after the verb
 * @param defaultHome the resolved state home
 * @returns the parsed options, or every rejection
 */
export function parseEditArgs({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): SlackParsed<EditOptions> {
  const parsed = parseFlagTail({ rest, spec: SLACK_EDIT_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(SlackArgumentErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const channel = required({ flag: "--channel", value: values["channel"] });
  const ts = required({ flag: "--ts", value: values["ts"] });
  const actor = parseLifecycleActor({ value: values["as"] });
  if (actor.isErr()) {
    // Lane-specific checks are lane-SPECIFIC, so without a lane there is nothing sensible to check them
    // against. Everything already known is still reported, so this stays one-pass in the usual sense.
    return err(
      SlackArgumentErrors.argumentsRefused({
        reasons: [...errorsOf({ results: [channel, ts] }), ...slackArgumentErrorLines({ error: actor.error })],
      }),
    );
  }
  const commonErrors = errorsOf({ results: [channel, ts] });
  const commonFields = commonOf({ defaultHome, parsed: parsed.value });
  return actor.value === "me"
    ? editMeOptions({ channel, commonErrors, commonFields, flags, ts, values })
    : editCardOptions({ channel, commonErrors, commonFields, flags, ts, values });
}

/**
 * Parse `slack delete`.
 *
 * @param rest the argv tail after the verb
 * @param defaultHome the resolved state home
 * @returns the parsed options, or every rejection
 */
export function parseDeleteArgs({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): SlackParsed<DeleteOptions> {
  const parsed = parseFlagTail({ rest, spec: SLACK_DELETE_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(SlackArgumentErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const channel = required({ flag: "--channel", value: values["channel"] });
  const ts = required({ flag: "--ts", value: values["ts"] });
  const actor = parseLifecycleActor({ value: values["as"] });
  const errors = errorsOf({ results: [channel, ts, actor] });
  if (errors.length > 0 || !(channel.isOk() && ts.isOk() && actor.isOk())) {
    return err(
      errors.length > 0
        ? SlackArgumentErrors.argumentsRefused({ reasons: errors })
        : SlackArgumentErrors.invocationIncoherent({ verb: "delete" }),
    );
  }
  return ok({
    ...commonOf({ defaultHome, parsed: parsed.value }),
    actor: actor.value,
    channel: channel.value,
    kind: "delete",
    ts: ts.value,
  });
}

/** The door verb name for a lifecycle operation, so the ledger records what actually happened. */
function doorVerbFor({ options }: { options: LifecycleOptions }): string {
  switch (options.kind) {
    case "edit":
      return "edit";
    case "delete":
      return "delete";
  }
}

/**
 * The actor a lifecycle mutation runs as, for the ledger.
 *
 * Read off whichever actor was actually parsed. Before `--as` existed on this verb pair the door request
 * hard-coded `"bot"` here, which was correct only because no other value could ever occur — widening
 * `edit`/`delete` to a real human lane without touching this would have kept every `--as me` mutation
 * misattributed in its own audit trail.
 */
function actorOf({ options }: { options: LifecycleOptions }): SlackActor {
  return options.actor;
}

/**
 * The door request for one lifecycle operation.
 *
 * Every one of these is `external-write`, including the deletes. None declares `requiresApproval` — that
 * would now HOLD at the door without an approval digest, and correcting a card the bot itself raised is
 * routine. An edit mutates
 * something already public and a delete destroys it, so neither is exempt — the door decides, not this
 * code. The artifact summary carries the opaque target and counts, never prose.
 *
 * @param options the parsed invocation
 * @param blockCount how many blocks the mutation would write, when it writes any
 * @param targetTs the message being mutated, when there is a single one
 * @returns the door request
 */
export function lifecycleDoorRequest({
  options,
  blockCount,
  targetTs,
}: {
  options: LifecycleOptions;
  blockCount?: number | undefined;
  targetTs?: string | undefined;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "slack", verb: doorVerbFor({ options }) },
    artifact: {
      actor: actorOf({ options }),
      ...(blockCount !== undefined ? { blockCount } : {}),
      ...(targetTs !== undefined ? { targetTs } : {}),
    },
    meta: { createsWorkItem: false, effect: "external-write", home: options.home, requiresApproval: false },
  } satisfies DoorRequest;
}
