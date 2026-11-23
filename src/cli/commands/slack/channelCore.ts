/**
 * `slack channel` — every DECISION, pure. The shell that touches Slack is `./channelRun.ts`.
 *
 * ## Why creating a channel gets its own verb rather than a flag on `post`
 *
 * `post` chooses a destination that already exists. This one BRINGS a destination into being, and the two
 * have opposite failure economics: a bad post is deleted in one command, while Slack offers no way to
 * delete a channel at all — only `conversations.archive`, which leaves the name taken forever. So the
 * refusals here are deliberately stricter than any send's: a name Slack would silently rewrite is refused
 * rather than normalised (`../../../outbound/slack/channelName.ts`), and every invitee must resolve by
 * exact match before the channel is minted, not after.
 *
 * ## Which lane can actually do this, measured rather than assumed
 *
 * MEASURED on this install (`slopweaver slack probe --method auth.test --scopes`, and `--bot`):
 * the USER token holds `channels:write`, `groups:write` and `groups:write.invites`; the BOT token holds
 * NEITHER `channels:manage` nor `groups:write`. So `--as me` is the default and the lane that works today.
 * `--as bot` is still accepted rather than refused up front, because a scope grant is a thing the owner can
 * change in the app config at any time and a hard-coded refusal would then be a lie the code tells about
 * the workspace. What the failure carries instead is {@link channelScopeHint}, which names the exact scope
 * the chosen lane is missing.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type ChannelNameVerdict, channelNameRefusals, judgeChannelName } from "../../../outbound/slack/channelName.js";
import type { SlackActor } from "../../../outbound/slack/types.js";
import { flagValueOr, parseFlagTail } from "../../optionParsers.js";
import { SlackArgumentErrors, type SlackParsed } from "./argumentErrors.js";

/** `--invite` and the two description flags, parsed. */
export interface ChannelCreateOptions {
  readonly mode: "create";
  readonly actor: SlackActor;
  readonly name: string;
  readonly isPrivate: boolean;
  readonly purpose: string | undefined;
  readonly topic: string | undefined;
  readonly invite: readonly string[];
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string;
}

/** `slack channel archive`, parsed. */
export interface ChannelArchiveOptions {
  readonly mode: "archive";
  readonly actor: SlackActor;
  readonly channel: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string;
}

/** `slack channel invite`, parsed. */
export interface ChannelInviteOptions {
  readonly mode: "invite";
  readonly actor: SlackActor;
  readonly channel: string;
  /** Identity-map keys, never resolved ids — resolution is the plan builder's job. Never empty once parsed. */
  readonly invite: readonly string[];
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string;
}

/** Any sub-command of `slack channel`. */
export type ChannelOptions = ChannelCreateOptions | ChannelInviteOptions | ChannelArchiveOptions;

/** A fully-decided create. Both `--dry-run` and the real path consume THIS, which is what keeps them equal. */
export interface ChannelCreatePlan {
  readonly actor: SlackActor;
  readonly name: string;
  readonly isPrivate: boolean;
  readonly purpose: string | undefined;
  readonly topic: string | undefined;
  /** Slack user ids, already resolved from the requested keys — never a key that failed to resolve. */
  readonly inviteUserIds: readonly string[];
  /** The reservation key. The channel NAME, because Slack's own uniqueness is on the name. */
  readonly duplicateKey: string;
}

/** A fully-decided invite into a channel that already exists. The dry run and the real path both consume THIS. */
export interface ChannelInvitePlan {
  readonly actor: SlackActor;
  readonly channel: string;
  /** Slack user ids, already resolved from the requested keys — never a key that failed to resolve. */
  readonly inviteUserIds: readonly string[];
  /**
   * The reservation key: the channel AND the sorted id set. Re-sending the same people into the same channel
   * is the repeat the ledger should see; a different set into the same channel is a different act.
   */
  readonly duplicateKey: string;
}

/** The flag tokens `slack channel` accepts. Exported so `helpTruth` compares the usage against the SPEC. */
export const SLACK_CHANNEL_FLAG_SPEC = {
  boolean: ["private", "dry-run", "json"],
  value: ["as", "name", "purpose", "topic", "invite", "channel", "home"],
} as const;

/**
 * The actor a `--as` value names, defaulting to the lane that works.
 *
 * @param raw the `--as` value, absent when the flag was not given
 * @param errors the accumulator a bad value is pushed onto
 * @returns the actor, or `me` when the value was absent or rejected
 */
function parseActor({ raw, errors }: { raw: string | undefined; errors: string[] }): SlackActor {
  if (raw === undefined) {
    return "me";
  }
  if (raw === "bot" || raw === "me") {
    return raw;
  }
  errors.push(`--as must be bot or me, not ${JSON.stringify(raw)}`);
  return "me";
}

/**
 * A comma-separated flag value as a list, with empty entries dropped.
 *
 * Empty entries are DROPPED rather than refused because `--invite a,b,` is a shell artefact rather than a
 * request to invite nobody, while a wholly empty `--invite ""` yields an empty list the caller reports as
 * "no invitees" — which is what it is.
 *
 * @param raw the flag value, absent when the flag was not given
 * @returns each non-empty entry, trimmed
 */
export function commaSeparated({ raw }: { raw: string | undefined }): readonly string[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** The flags every sub-command shares, parsed once. */
interface ChannelSharedOptions {
  readonly actor: SlackActor;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string;
}

/** What one sub-command's parser receives: the parsed tail, the shared flags, and the accumulator. */
interface ChannelTail {
  readonly values: Readonly<Record<string, string | undefined>>;
  readonly flags: ReadonlySet<string>;
  readonly shared: ChannelSharedOptions;
  /** Every rejection so far, including a bad `--as`; a sub-command pushes its own and reports all of them. */
  readonly errors: string[];
}

/*
 * Each sub-command's required flags are CHECKED into the accumulator and then narrowed by one combined guard,
 * rather than early-returned one at a time: that is what lets a run missing two of them report both, while
 * keeping `?? ""` out of the success arm — a coalesce there would turn a missing `--name` into a create for the
 * empty string, and the `house-rules` gate refuses the spelling for exactly that reason.
 */

/** `slack channel archive`'s own flags. */
function parseArchiveTail({ values, shared, errors }: ChannelTail): SlackParsed<ChannelArchiveOptions> {
  const channel = values["channel"];
  if (channel === undefined) {
    errors.push("slack channel archive needs --channel <id>");
  }
  if (channel === undefined || errors.length > 0) {
    return err(SlackArgumentErrors.argumentsRefused({ reasons: errors }));
  }
  return ok({ ...shared, channel, mode: "archive" });
}

/** `slack channel invite`'s own flags. */
function parseInviteTail({ values, shared, errors }: ChannelTail): SlackParsed<ChannelInviteOptions> {
  const channel = values["channel"];
  const invite = commaSeparated({ raw: values["invite"] });
  if (channel === undefined) {
    errors.push("slack channel invite needs --channel <id>");
  }
  if (invite.length === 0) {
    // An empty list is refused rather than sent: `conversations.invite` with nobody in it is a call
    // nobody asked for, and "invited 0/0" would read as success.
    errors.push("slack channel invite needs --invite <key,...> naming at least one person");
  }
  if (values["name"] !== undefined) {
    errors.push("--name names a channel to CREATE; `slack channel invite` takes --channel <id>");
  }
  if (channel === undefined || errors.length > 0) {
    return err(SlackArgumentErrors.argumentsRefused({ reasons: errors }));
  }
  return ok({ ...shared, channel, invite, mode: "invite" });
}

/** `slack channel create`'s own flags. */
function parseCreateTail({ values, flags, shared, errors }: ChannelTail): SlackParsed<ChannelCreateOptions> {
  const name = values["name"];
  if (name === undefined) {
    errors.push("slack channel create needs --name <name>");
  }
  if (values["channel"] !== undefined) {
    errors.push("--channel names a channel that already exists; `slack channel create` takes --name");
  }
  if (name === undefined || errors.length > 0) {
    return err(SlackArgumentErrors.argumentsRefused({ reasons: errors }));
  }
  return ok({
    ...shared,
    invite: commaSeparated({ raw: values["invite"] }),
    isPrivate: flags.has("private"),
    mode: "create",
    name,
    purpose: values["purpose"],
    topic: values["topic"],
  });
}

/**
 * Parse the `slack channel` tail into a checked invocation.
 *
 * @param rest the argv tail, after `slopweaver slack channel`
 * @param defaultHome the home to use when `--home` is absent
 * @returns the parsed invocation, or every rejection at once
 */
export function parseChannelArgs({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): SlackParsed<ChannelOptions> {
  const sub = rest[0];
  if (sub !== "create" && sub !== "invite" && sub !== "archive") {
    return err(SlackArgumentErrors.channelSubcommandUnknown({ got: sub }));
  }
  const parsed = parseFlagTail({ rest: rest.slice(1), spec: SLACK_CHANNEL_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(SlackArgumentErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];
  const tail: ChannelTail = {
    errors,
    flags,
    shared: {
      actor: parseActor({ errors, raw: values["as"] }),
      dryRun: flags.has("dry-run"),
      home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
      json: flags.has("json"),
    },
    values,
  };
  if (sub === "archive") {
    return parseArchiveTail(tail);
  }
  if (sub === "invite") {
    return parseInviteTail(tail);
  }
  return parseCreateTail(tail);
}

/**
 * The one line an unresolvable invitee earns, for both sub-commands that resolve one. Authored once so the
 * create and the invite cannot drift on what "could not resolve" reads as; only what did NOT happen differs.
 *
 * @param unresolved the keys nothing could resolve, in the order they were asked for
 * @param consequence what the refusal stopped, in one sentence
 * @returns the problem line
 */
function unresolvedInviteesProblem({
  unresolved,
  consequence,
}: {
  unresolved: readonly string[];
  consequence: string;
}): string {
  return (
    `cannot resolve ${String(unresolved.length)} invitee(s) — ${unresolved.map((key) => JSON.stringify(key)).join(", ")}. ` +
    consequence
  );
}

/**
 * Build the create plan, or every reason it was refused.
 *
 * The name verdict and the mention resolution are checked TOGETHER rather than one short-circuiting the
 * other, so an author who got both wrong learns both in one run instead of fixing one and rediscovering
 * the next — the same reason the flag parser accumulates.
 *
 * @param options the parsed invocation
 * @param resolved each requested invite key mapped to the Slack user id it resolved to; a key absent from
 *   this map is one nothing could resolve, and refuses the whole create
 * @returns the plan both the dry run and the real create consume
 */
export function buildChannelCreatePlan({
  options,
  resolved,
}: {
  options: ChannelCreateOptions;
  resolved: ReadonlyMap<string, string>;
}): Result<ChannelCreatePlan> {
  const verdict: ChannelNameVerdict = judgeChannelName({ proposed: options.name });
  const problems = [...channelNameRefusals({ verdict })];
  const unresolved = options.invite.filter((key) => !resolved.has(key));
  if (unresolved.length > 0) {
    problems.push(
      unresolvedInviteesProblem({
        consequence: "Nothing was created: a channel minted with the wrong people in it cannot be un-minted.",
        unresolved,
      }),
    );
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    actor: options.actor,
    duplicateKey: `slack-channel-create:${options.name}`,
    inviteUserIds: options.invite.flatMap((key) => {
      const id = resolved.get(key);
      return id === undefined ? [] : [id];
    }),
    isPrivate: options.isPrivate,
    name: options.name,
    purpose: options.purpose,
    topic: options.topic,
  });
}

/**
 * Build the invite plan, or the one reason it was refused.
 *
 * The same rule as the create's invitees, for the same reason in a weaker form: an invite cannot be undone by
 * this verb, so a batch with one wrong key sends nobody rather than the people who happened to resolve.
 *
 * @param options the parsed invocation
 * @param resolved each requested key mapped to the Slack user id it resolved to; a key absent from this
 *   map is one nothing could resolve, and refuses the whole invite
 * @returns the plan both the dry run and the real invite consume
 */
export function buildChannelInvitePlan({
  options,
  resolved,
}: {
  options: ChannelInviteOptions;
  resolved: ReadonlyMap<string, string>;
}): Result<ChannelInvitePlan> {
  const unresolved = options.invite.filter((key) => !resolved.has(key));
  if (unresolved.length > 0) {
    return err([
      unresolvedInviteesProblem({
        consequence: "Nobody was invited: an invite this verb cannot take back is not sent half-right.",
        unresolved,
      }),
    ]);
  }
  const inviteUserIds = options.invite.flatMap((key) => {
    const id = resolved.get(key);
    return id === undefined ? [] : [id];
  });
  return ok({
    actor: options.actor,
    channel: options.channel,
    duplicateKey: `slack-channel-invite:${options.channel}:${[...inviteUserIds].toSorted().join(",")}`,
    inviteUserIds,
  });
}

/**
 * The invite's dry run: the one call it would make, and what it could not undo.
 *
 * @param plan the fully-decided invite
 * @returns the lines to print
 */
export function channelInviteDryRunLines({ plan }: { plan: ChannelInvitePlan }): readonly string[] {
  return [
    `DRY RUN — nobody was invited. As ${plan.actor === "bot" ? "the bot" : "you"}, slopweaver would:`,
    `  1. conversations.invite ${plan.inviteUserIds.join(", ")} into ${plan.channel}`,
    "  an invite is not retracted by this verb — a person invited by mistake is removed by hand in Slack.",
  ];
}

/**
 * The dry run: every irreversible step, in the order it would happen.
 *
 * @param plan the fully-decided create
 * @returns the lines to print
 */
export function channelCreateDryRunLines({ plan }: { plan: ChannelCreatePlan }): readonly string[] {
  const lines = [
    `DRY RUN — nothing was created. As ${plan.actor === "bot" ? "the bot" : "you"}, slopweaver would:`,
    `  1. conversations.create name=${plan.name} is_private=${String(plan.isPrivate)}`,
  ];
  let step = 2;
  if (plan.inviteUserIds.length > 0) {
    lines.push(`  ${String(step)}. conversations.invite ${plan.inviteUserIds.join(", ")}`);
    step += 1;
  }
  if (plan.purpose !== undefined) {
    lines.push(`  ${String(step)}. conversations.setPurpose ${JSON.stringify(plan.purpose)}`);
    step += 1;
  }
  if (plan.topic !== undefined) {
    lines.push(`  ${String(step)}. conversations.setTopic ${JSON.stringify(plan.topic)}`);
  }
  lines.push(
    "  a created channel cannot be deleted — `slopweaver slack channel archive` is the only retraction, " +
      "and the name stays taken.",
  );
  return lines;
}

/**
 * The one line a `missing_scope` failure earns, naming the scope THIS lane needs.
 *
 * Two lanes need different grants for the same endpoint and Slack's own error says only "missing_scope",
 * so an operator reading the raw failure has to go and look up which of four scope names applies to the
 * token they happened to be using. This says it.
 *
 * @param actor the lane the refused call was made on
 * @param isPrivate whether the refused create was for a private channel, which needs the other grant
 * @returns the hint line
 */
export function channelScopeHint({ actor, isPrivate }: { actor: SlackActor; isPrivate: boolean }): string {
  if (actor === "bot") {
    const scope = isPrivate ? "groups:write" : "channels:manage";
    return (
      `the BOT token needs ${scope} to do that, and it was measured as holding neither channels:manage nor ` +
      "groups:write on this install. Re-run with --as me, or add the scope in the Slack app config."
    );
  }
  const scope = isPrivate ? "groups:write" : "channels:write";
  return `the USER token needs ${scope} to do that. Check it with \`slopweaver slack probe --method auth.test --scopes\`.`;
}
