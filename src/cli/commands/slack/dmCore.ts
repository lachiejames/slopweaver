/**
 * `slack dm open` — every DECISION, pure. The shell that touches Slack is `./dmRun.ts`.
 *
 * ## The gap this closes, stated as it stood
 *
 * The door could post INTO a group DM whose id somebody had already found by hand, and had no way to
 * CREATE one: nothing in this repo called `conversations.open`. So "reply to those three people together"
 * was reachable only by opening Slack, starting the conversation manually, and copying the `G…` id back
 * out — a hand step in the middle of a doored path, which is the shape rule 3 exists to remove.
 *
 * ## Why this is a separate verb from `slack channel create`
 *
 * They look adjacent and are not. A channel is minted, named, and can never be deleted; a DM is RESOLVED —
 * Slack guarantees one conversation per user set, so opening the same set twice answers the same id and
 * mints nothing the second time. That makes this the one write verb in the Slack noun with no reservation
 * and no duplicate gate: there is no double-send to prevent, because the provider itself is idempotent.
 * Folding the two into one verb would have forced one of them to carry the other's ceremony.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { SlackActor } from "../../../outbound/slack/types.js";
import { flagValueOr, parseFlagTail } from "../../optionParsers.js";
import { SlackArgumentErrors, type SlackParsed } from "./argumentErrors.js";
import { commaSeparated } from "./channelCore.js";
import { SLACK_GROUP_DM_MAX_OTHERS } from "./verbUsage.js";

/** `slack dm open`, parsed. */
export interface DmOpenOptions {
  readonly actor: SlackActor;
  readonly with: readonly string[];
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string;
}

/** A fully-decided open. Both `--dry-run` and the real path consume THIS, which is what keeps them equal. */
export interface DmOpenPlan {
  readonly actor: SlackActor;
  /** Slack user ids, already resolved — never a key that failed to resolve. */
  readonly userIds: readonly string[];
  /** What Slack will answer with: a 1:1 IM for one person, an MPIM for several. */
  readonly surface: "direct-message" | "group-dm";
}

/** The flag tokens `slack dm` accepts. Exported so `helpTruth` compares the usage against the SPEC. */
export const SLACK_DM_FLAG_SPEC = { boolean: ["dry-run", "json"], value: ["as", "with", "home"] } as const;

/**
 * Parse the `slack dm` tail into a checked invocation.
 *
 * @param rest the argv tail, after `slopweaver slack dm`
 * @param defaultHome the home to use when `--home` is absent
 * @returns the parsed invocation, or every rejection at once
 */
export function parseDmArgs({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): SlackParsed<DmOpenOptions> {
  const sub = rest[0];
  if (sub !== "open") {
    return err(SlackArgumentErrors.dmSubcommandUnknown({ got: sub }));
  }
  const parsed = parseFlagTail({ rest: rest.slice(1), spec: SLACK_DM_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(SlackArgumentErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];
  const raw = values["as"];
  let actor: SlackActor = "bot";
  if (raw === "me" || raw === "bot") {
    actor = raw;
  } else if (raw !== undefined) {
    errors.push(`--as must be bot or me, not ${JSON.stringify(raw)}`);
  }
  const people = commaSeparated({ raw: values["with"] });
  if (people.length === 0) {
    errors.push("slack dm open needs --with <key,...> — at least one person to open a conversation with");
  }
  return errors.length > 0
    ? err(SlackArgumentErrors.argumentsRefused({ reasons: errors }))
    : ok({
        actor,
        dryRun: flags.has("dry-run"),
        home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
        json: flags.has("json"),
        with: people,
      });
}

/**
 * Build the open plan, or every reason it was refused.
 *
 * @param options the parsed invocation
 * @param resolved each requested key mapped to the Slack user id it resolved to; a key absent from this
 *   map is one nothing could resolve, and refuses the whole open
 * @returns the plan both the dry run and the real open consume
 */
export function buildDmOpenPlan({
  options,
  resolved,
}: {
  options: DmOpenOptions;
  resolved: ReadonlyMap<string, string>;
}): Result<DmOpenPlan> {
  const problems: string[] = [];
  const unresolved = options.with.filter((key) => !resolved.has(key));
  if (unresolved.length > 0) {
    problems.push(
      `cannot resolve ${String(unresolved.length)} of --with — ${unresolved.map((key) => JSON.stringify(key)).join(", ")}. ` +
        "A conversation opened with the wrong person is a message sent to a stranger, so nothing was opened.",
    );
  }
  // DISTINCT ids, because two keys for one person (a handle and an email, say) is an ordinary thing to
  // write and Slack counts the repeat toward its own ceiling.
  const userIds = [
    ...new Set(
      options.with.flatMap((key) => {
        const id = resolved.get(key);
        return id === undefined ? [] : [id];
      }),
    ),
  ];
  if (userIds.length > SLACK_GROUP_DM_MAX_OTHERS) {
    problems.push(
      `a Slack group DM holds at most ${String(SLACK_GROUP_DM_MAX_OTHERS)} other people and this names ` +
        `${String(userIds.length)}. Create a channel instead: slopweaver slack channel create --name <name>`,
    );
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({ actor: options.actor, surface: userIds.length === 1 ? "direct-message" : "group-dm", userIds });
}

/**
 * The dry run: what would be opened, and with whom.
 *
 * @param plan the fully-decided open
 * @returns the lines to print
 */
export function dmOpenDryRunLines({ plan }: { plan: DmOpenPlan }): readonly string[] {
  return [
    `DRY RUN — nothing was opened. As ${plan.actor === "bot" ? "the bot" : "you"}, slopweaver would:`,
    `  1. conversations.open users=${plan.userIds.join(",")}`,
    `  that resolves to a ${plan.surface === "direct-message" ? "1:1 DM" : "group DM"}, existing or new.`,
    "  Slack answers the SAME conversation for the same people, so re-running this opens nothing twice.",
  ];
}

/**
 * What a completed open tells the operator: the id, whether it was already there, and the next verb.
 *
 * @param plan the fully-decided open
 * @param channelId the conversation Slack answered with
 * @param alreadyExisted whether Slack reported the conversation as already standing
 * @returns the lines to print
 */
export function dmOpenReportLines({
  plan,
  channelId,
  alreadyExisted,
}: {
  plan: DmOpenPlan;
  channelId: string;
  alreadyExisted: boolean;
}): readonly string[] {
  const kind = plan.surface === "direct-message" ? "DM" : "group DM";
  return [
    alreadyExisted
      ? `that ${kind} already existed: ${channelId}`
      : `opened a ${kind} with ${String(plan.userIds.length)} person(s): ${channelId}`,
    "post into it with:",
    `  slopweaver slack post --as ${plan.actor} --channel ${channelId} --shape top-level --form -`,
  ];
}
