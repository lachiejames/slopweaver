/**
 * Argument parsing for `slopweaver slack post|reply` — split out of `./core.js`, which re-exports
 * everything here under its original import path.
 */
import { err, ok } from "../../../lib/result.js";
import { parseDmPurpose } from "../../../outbound/slack/dmPurpose.js";
import type { DripShape, SlackActor } from "../../../outbound/slack/types.js";
import { flagValueOr, parseFlagTail } from "../../optionParsers.js";
import { SlackArgumentErrors, type SlackParsed, slackArgumentErrorLines } from "./argumentErrors.js";
import {
  ALLOW_UNRESOLVED_OWNER_FLAG,
  type DripSource,
  type SlackWriteOptions,
  type SlackWriteVerb,
} from "./coreTypes.js";
import { DRAFT_FLAGS, releaseOptions } from "./releaseArgs.js";

/**
 * `slack post` and `slack reply`'s shared flag spec — one object, because the two verbs differ only in how
 * `--thread-ts`/`--shape` are VALIDATED, never in which flags they tokenise.
 *
 * Exported so the help/flag ratchet compares the manifest's usage against the object the parser actually
 * reads, rather than against a second hand-written list that can drift from it.
 */
export const SLACK_WRITE_FLAG_SPEC = {
  boolean: [ALLOW_UNRESOLVED_OWNER_FLAG, "dry-run", "json", "resend-unconfirmed"],
  value: [
    "as",
    "body",
    "channel",
    "dm-purpose",
    "form",
    "home",
    "idempotency-key",
    "media",
    "no-picture-because",
    "shape",
    "thread-ts",
    ...DRAFT_FLAGS,
  ],
} as const;

/** `--as` is required and has no default: nothing may post under a name the caller did not name. */
function parseActor({ value }: { value: string | undefined }): SlackParsed<SlackActor> {
  if (value === undefined) {
    return err(SlackArgumentErrors.actorMissing());
  }
  if (value === "bot" || value === "me") {
    return ok(value);
  }
  return err(SlackArgumentErrors.actorInvalid({ got: value }));
}

/**
 * `--shape` — required for an as-me `post`, and REFUSED for an as-me `reply`.
 *
 * There is no default, and that is the answer rather than an omission. The owner decides it from the
 * context at send time and no hard rule fits, so a default would be this code quietly making a judgement
 * the owner reserves for themself.
 */
function parseShape({ value, verb }: { value: string | undefined; verb: SlackWriteVerb }): SlackParsed<DripShape> {
  if (verb === "reply") {
    return value === undefined ? ok("thread") : err(SlackArgumentErrors.shapeRefusedOnReply());
  }
  if (value === undefined) {
    return err(SlackArgumentErrors.shapeMissing());
  }
  if (value === "top-level" || value === "thread") {
    return ok(value);
  }
  return err(SlackArgumentErrors.shapeInvalid({ got: value }));
}

/**
 * Where the as-me words come from: exactly one of `--form` (sectioned) or `--body` (the escape hatch).
 *
 * The escape hatch takes a RAW body rather than JSON on purpose. Making someone JSON-escape their own
 * prose to send one sentence would put this lane below the bar it has to beat, which is typing into Slack.
 *
 * Exported for `slack edit --as me` (`./lifecycleCore.js`), which accepts the same two sources for the
 * single message it replaces a `ts` with — reusing this rather than a second copy of the same rule.
 *
 * @param form the raw `--form` value, if given
 * @param body the raw `--body` value, if given
 * @returns the source to render, or the refusal naming which combination is invalid
 */
export function parseDripSource({
  form,
  body,
}: {
  form: string | undefined;
  body: string | undefined;
}): SlackParsed<DripSource> {
  if (form !== undefined && body !== undefined) {
    return err(SlackArgumentErrors.sourceConflict());
  }
  if (body !== undefined) {
    return ok({ kind: "body", text: body });
  }
  if (form !== undefined && form.length > 0) {
    return ok({ json: form, kind: "form" });
  }
  return err(SlackArgumentErrors.sourceMissing());
}

/** A channel id is required; a destination is never guessed. */
function parseChannel({ value }: { value: string | undefined }): SlackParsed<string> {
  if (value === undefined || value.length === 0) {
    return err(SlackArgumentErrors.channelMissing());
  }
  return ok(value);
}

/** `--form` accepts inline JSON or `-` for stdin. */
function parseForm({ value }: { value: string | undefined }): SlackParsed<string> {
  if (value === undefined || value.length === 0) {
    return err(SlackArgumentErrors.formMissing());
  }
  return ok(value);
}

/**
 * `--media` is a comma-separated path list. Order is the caller's and is preserved exactly. Shared with
 * `slack draft record --media`, so a parked draft's attachments are named with exactly the send's syntax.
 *
 * @returns the paths in the caller's order, empty when the flag is absent
 */
export function parseMedia({ value }: { value: string | undefined }): readonly string[] {
  if (value === undefined || value.length === 0) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** A `reply` needs its parent; a `post` must not carry one. */
function parseThreadTs({
  value,
  verb,
}: {
  value: string | undefined;
  verb: SlackWriteVerb;
}): SlackParsed<string | undefined> {
  if (verb === "reply" && (value === undefined || value.length === 0)) {
    return err(SlackArgumentErrors.threadTsMissing());
  }
  if (verb === "post" && value !== undefined) {
    return err(SlackArgumentErrors.threadTsRefusedOnPost());
  }
  return ok(value);
}

/**
 * Parse an invocation, accumulating EVERY rejection rather than stopping at the first — one run
 * tells the caller everything that is wrong.
 *
 * @param verb the write verb
 * @param rest the argv tail after the verb
 * @param defaultHome the resolved state home, used when `--home` is absent
 * @returns the parsed options, or every rejection
 */
export function parseSlackWriteArgs({
  verb,
  rest,
  defaultHome,
}: {
  verb: SlackWriteVerb;
  rest: readonly string[];
  defaultHome: string;
}): SlackParsed<SlackWriteOptions> {
  const parsed = parseFlagTail({ rest, spec: SLACK_WRITE_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(SlackArgumentErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, flags } = parsed.value;
  if (DRAFT_FLAGS.some((name) => values[name] !== undefined)) {
    return releaseOptions({ defaultHome, flags, values, verb });
  }
  const actor = parseActor({ value: values["as"] });
  const channel = parseChannel({ value: values["channel"] });
  const threadTs = parseThreadTs({ value: values["thread-ts"], verb });
  const common = [channel, threadTs].flatMap((result) =>
    result.isOk() ? [] : slackArgumentErrorLines({ error: result.error }),
  );
  if (actor.isErr()) {
    // The lane checks below are lane-SPECIFIC, so without a lane there is nothing sensible to check them
    // against. Everything already known is still reported, so this stays one-pass in the usual sense.
    return err(
      SlackArgumentErrors.argumentsRefused({
        reasons: [...slackArgumentErrorLines({ error: actor.error }), ...common],
      }),
    );
  }
  const shared = {
    channel,
    dryRun: flags.has("dry-run"),
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
    threadTs,
    verb,
  };
  return actor.value === "bot"
    ? cardOptions({ errors: common, flags, shared, values })
    : dripOptions({ errors: common, flags, shared, values, verb });
}

/** The parsed pieces both lanes share, still in `Result` form so the lane builders can pool the errors. */
interface SharedParse {
  readonly channel: SlackParsed<string>;
  readonly dryRun: boolean;
  readonly home: string;
  readonly json: boolean;
  readonly threadTs: SlackParsed<string | undefined>;
  readonly verb: SlackWriteVerb;
}

/** Every flag that belongs to the OTHER lane, refused by name rather than ignored. */
function foreignFlags({
  present,
  lane,
}: {
  present: readonly { readonly flag: string; readonly used: boolean }[];
  lane: string;
}): readonly string[] {
  return present.filter((entry) => entry.used).map((entry) => `${entry.flag} is not valid with \`--as ${lane}\``);
}

/** Assemble the `--as bot` lane. */
function cardOptions({
  errors,
  flags,
  shared,
  values,
}: {
  errors: readonly string[];
  flags: ReadonlySet<string>;
  shared: SharedParse;
  values: Readonly<Record<string, string | undefined>>;
}): SlackParsed<SlackWriteOptions> {
  const form = parseForm({ value: values["form"] });
  const noPictureBecause = values["no-picture-because"]?.trim();
  const dmPurpose = values["dm-purpose"] === undefined ? undefined : parseDmPurpose({ value: values["dm-purpose"] });
  const all = [
    ...errors,
    ...(form.isOk() ? [] : slackArgumentErrorLines({ error: form.error })),
    ...(dmPurpose === undefined || dmPurpose.isOk() ? [] : [dmPurpose.error]),
    ...(noPictureBecause === ""
      ? ["--no-picture-because needs the reason itself: why no picture would show a reader anything the text does not"]
      : []),
    ...foreignFlags({
      lane: "bot",
      present: [
        { flag: "--shape", used: values["shape"] !== undefined },
        { flag: "--body", used: values["body"] !== undefined },
      ],
    }),
  ];
  if (all.length > 0) {
    return err(SlackArgumentErrors.argumentsRefused({ reasons: all }));
  }
  if (!(shared.channel.isOk() && shared.threadTs.isOk() && form.isOk())) {
    return err(SlackArgumentErrors.invocationIncoherent({ verb: "write" })); // unreachable: no errors ⇒ every part is ok
  }
  return ok({
    actor: "bot",
    allowUnresolvedOwner: flags.has(ALLOW_UNRESOLVED_OWNER_FLAG),
    channel: shared.channel.value,
    dryRun: shared.dryRun,
    formJson: form.value,
    home: shared.home,
    json: shared.json,
    media: parseMedia({ value: values["media"] }),
    resendUnconfirmed: flags.has("resend-unconfirmed"),
    verb: shared.verb,
    ...(typeof values["idempotency-key"] === "string" ? { idempotencyKey: values["idempotency-key"] } : {}),
    ...(dmPurpose === undefined || dmPurpose.isErr() ? {} : { dmPurpose: dmPurpose.value }),
    ...(noPictureBecause === undefined ? {} : { noPictureBecause }),
    ...(shared.threadTs.value !== undefined ? { threadTs: shared.threadTs.value } : {}),
  });
}

/**
 * Assemble the `--as me` lane.
 *
 * `--media` works on this lane: `chat.update` takes `file_ids` against any message the token owns, card
 * or not, and it is granted on the user token. So the words and their evidence go out together, and an
 * owner who wants screenshots under their own name does not need a manual drag-and-drop.
 */
function dripOptions({
  errors,
  flags,
  shared,
  values,
  verb,
}: {
  errors: readonly string[];
  flags: ReadonlySet<string>;
  shared: SharedParse;
  values: Readonly<Record<string, string | undefined>>;
  verb: SlackWriteVerb;
}): SlackParsed<SlackWriteOptions> {
  const source = parseDripSource({ body: values["body"], form: values["form"] });
  const shape = parseShape({ value: values["shape"], verb });
  const all = [
    ...errors,
    ...(source.isOk() ? [] : slackArgumentErrorLines({ error: source.error })),
    ...(shape.isOk() ? [] : slackArgumentErrorLines({ error: shape.error })),
    ...foreignFlags({
      lane: "me",
      present: [
        { flag: "--no-picture-because", used: values["no-picture-because"] !== undefined },
        { flag: "--dm-purpose", used: values["dm-purpose"] !== undefined },
      ],
    }),
    // Refused BY NAME rather than ignored, which is this lane's existing rule for a flag belonging to the other
    // one. It lives in the shared FLAG_SPEC because the parser is shared, so without this it PARSED here and did
    // nothing — accepted-but-unconsulted, found by an adversarial review of the very property it was added for.
    ...(flags.has(ALLOW_UNRESOLVED_OWNER_FLAG)
      ? [
          `--${ALLOW_UNRESOLVED_OWNER_FLAG} is not valid with \`--as me\`: it governs a DIGEST's owner ping, ` +
            "and the as-me lane has no card, no digest form and no owner field. A mention in a drip that does " +
            "not resolve already refuses the send outright, and there is deliberately no override for that.",
        ]
      : []),
  ];
  if (all.length > 0) {
    return err(SlackArgumentErrors.argumentsRefused({ reasons: all }));
  }
  if (!(shared.channel.isOk() && shared.threadTs.isOk() && source.isOk() && shape.isOk())) {
    return err(SlackArgumentErrors.invocationIncoherent({ verb: "write" })); // unreachable: no errors ⇒ every part is ok
  }
  return ok({
    actor: "me",
    channel: shared.channel.value,
    dryRun: shared.dryRun,
    home: shared.home,
    json: shared.json,
    media: parseMedia({ value: values["media"] }),
    resendUnconfirmed: flags.has("resend-unconfirmed"),
    shape: shape.value,
    source: source.value,
    verb: shared.verb,
    ...(shared.threadTs.value !== undefined ? { threadTs: shared.threadTs.value } : {}),
  });
}
