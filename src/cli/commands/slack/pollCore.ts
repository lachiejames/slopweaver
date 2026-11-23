/**
 * `slack poll` — the PURE half: parsing, planning, and the report text. No I/O, no clock, no Slack.
 *
 * Two invocations live behind one verb, on the named-sub-command precedent `slack canvas` also follows:
 *
 *   slopweaver slack poll --as bot --channel <id> --form <json|-> [--dry-run]
 *   slopweaver slack poll results --channel <id> --ts <ts>
 *
 * ## Results are LIVE, so there is no staleness vocabulary here
 *
 * Votes come from `reactions.get` at the moment you ask, not from a corpus snapshot. That removes an entire
 * category of report state — no capture dates, no "these may be stale", no refusing to choose between
 * disagreeing snapshots. Two outcomes remain, and they are genuinely different situations:
 *
 *  - `counted` — the live counts, minus slopweaver's own seeded chips.
 *  - `gone` — Slack has no message at that `channel:ts` (deleted, or never posted from this machine).
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { type SlackDelivery, SlackDeliveryErrors } from "../../../outbound/slack/deliveryErrors.js";
import { pollIdentity } from "../../../outbound/slack/fingerprint.js";
import {
  type PollArtifact,
  type PollBallotEntry,
  type PollPing,
  pollArtifactSchema,
  pollBallot,
} from "../../../outbound/slack/pollForm.js";
import { type PollSurface, renderPoll } from "../../../outbound/slack/pollRender.js";
import type { SlackCardChrome, SlackPollPayload } from "../../../outbound/slack/types.js";
import { flagValueOr, parseFlagTail } from "../../optionParsers.js";

/** The stdin sentinel, matching every other Slack verb. */
export const POLL_STDIN_SENTINEL = "-";

/** Posting a poll. */
export interface PollPostOptions {
  readonly mode: "post";
  readonly channel: string;
  readonly formSource: string;
  readonly home: string;
  readonly dryRun: boolean;
  readonly json: boolean;
}

/** Reading a poll's results back. */
export interface PollResultsOptions {
  readonly mode: "results";
  readonly channel: string;
  readonly ts: string;
  /** The repair locator: set when a confirmation failed and the record must be re-attached by id. */
  readonly pollId?: string | undefined;
  readonly home: string;
  readonly json: boolean;
}

export type PollOptions = PollPostOptions | PollResultsOptions;

/**
 * The two `slack poll` modes' flag specs, in ONE exported record — `poll` is a single manifest verb with a
 * single usage string, so what the ratchet compares against that usage is the union of both. Same shape and
 * same reason as `SLACK_PROGRESS_FLAG_SPECS` in `./lifecycleCore.js`.
 */
export const SLACK_POLL_FLAG_SPECS = {
  post: { boolean: ["dry-run", "json"], value: ["as", "channel", "form", "home"] },
  results: { boolean: ["json"], value: ["channel", "home", "poll-id", "ts"] },
} as const;

/** Parse `slack poll results …`. */
function parseResults({ rest, defaultHome }: { rest: readonly string[]; defaultHome: string }): Result<PollOptions> {
  const parsed = parseFlagTail({ rest, spec: SLACK_POLL_FLAG_SPECS.results });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];
  const channel = values["channel"];
  const ts = values["ts"];
  if (channel === undefined) {
    errors.push("`slack poll results` needs --channel <id>");
  }
  if (ts === undefined) {
    errors.push("`slack poll results` needs --ts <ts> (the poll message's timestamp)");
  }
  if (channel === undefined || ts === undefined) {
    return err(errors);
  }
  return ok({
    channel,
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
    mode: "results",
    ts,
    ...(values["poll-id"] === undefined ? {} : { pollId: values["poll-id"] }),
  });
}

/** Parse `slack poll --as bot --channel … --form …`. */
function parsePost({ rest, defaultHome }: { rest: readonly string[]; defaultHome: string }): Result<PollOptions> {
  const parsed = parseFlagTail({ rest, spec: SLACK_POLL_FLAG_SPECS.post });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];
  const actor = values["as"];
  const channel = values["channel"];
  const form = values["form"];
  if (actor === undefined) {
    // Never defaulted, matching every other Slack write: which name a message goes out under is not a
    // thing to guess at.
    errors.push("`slack poll` needs --as bot (a poll is posted by the bot; --as me is not supported)");
  } else if (actor !== "bot") {
    errors.push(
      `--as ${JSON.stringify(actor)} is not supported for a poll: only \`--as bot\`. A poll is institutional, ` +
        "and the as-me lane is a drip of short messages with no ballot.",
    );
  }
  if (channel === undefined) {
    errors.push("`slack poll` needs --channel <id>");
  }
  if (form === undefined) {
    errors.push(`\`slack poll\` needs --form <json|${POLL_STDIN_SENTINEL}>`);
  }
  if (channel === undefined || form === undefined || actor !== "bot") {
    return err(errors);
  }
  return ok({
    channel,
    dryRun: flags.has("dry-run"),
    formSource: form,
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
    mode: "post",
  });
}

/**
 * Parse any `slack poll` invocation.
 *
 * @param rest the argv tail after the verb
 * @param defaultHome the resolved state home
 * @returns the parsed options, or every rejection
 */
export function parsePollArgs({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<PollOptions> {
  return rest[0] === "results" ? parseResults({ defaultHome, rest: rest.slice(1) }) : parsePost({ defaultHome, rest });
}

/**
 * Validate a poll form.
 *
 * @param json the raw form JSON
 * @returns the validated poll, or every shape rejection
 */
export function parsePollForm({ json }: { json: string }): SlackDelivery<PollArtifact> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    return err(SlackDeliveryErrors.pollFormNotJson({ cause: error }));
  }
  const parsed = pollArtifactSchema.safeParse(raw);
  if (!parsed.success) {
    // A ROOT-level issue has an empty path, and prefixing it with ": " read as a stray colon — which is exactly
    // the message an author sees for the unknown-key refusal, so it is worth getting right.
    const reasons = parsed.error.issues.map((issue) => {
      const where = issue.path.join(".");
      return where.length === 0 ? issue.message : `${where}: ${issue.message}`;
    });
    return err(SlackDeliveryErrors.formInvalid({ reasons }));
  }
  return ok(parsed.data);
}

/** A ping that could not be resolved, reported rather than silently dropped. */
export interface UnresolvedPing {
  readonly kind: string;
  readonly label: string;
}

/**
 * Turn a poll's pings into mrkdwn mention tokens. PURE — every lookup arrives as a map.
 *
 * An unresolved ping is REPORTED, never rendered as plain text and never skipped. Both alternatives are worse
 * than refusing: a literal `@engineers` notifies nobody while looking like it did, and a silent omission means
 * the poll goes out to fewer people than asked with no sign of it.
 *
 * @param pings the requested pings, in author order
 * @param groupIds user-group handle → id, from `usergroups.list`
 * @param people identity-map key → Slack user id, resolved EXACTLY (never a fuzzy name match)
 * @returns the tokens to render, and every ping that could not be resolved
 */
export function resolvePings({
  pings,
  groupIds,
  people,
}: {
  pings: readonly PollPing[];
  groupIds: ReadonlyMap<string, string>;
  people: ReadonlyMap<string, string>;
}): { readonly tokens: readonly string[]; readonly unresolved: readonly UnresolvedPing[] } {
  const tokens: string[] = [];
  const unresolved: UnresolvedPing[] = [];
  for (const ping of pings) {
    if (ping.kind === "broadcast") {
      tokens.push(`<!${ping.range}>`);
      continue;
    }
    if (ping.kind === "group") {
      const id = groupIds.get(ping.handle);
      if (id === undefined) {
        unresolved.push({ kind: "group", label: `@${ping.handle}` });
        continue;
      }
      // The `|@handle` fallback is what non-members and notification previews render.
      tokens.push(`<!subteam^${id}|@${ping.handle}>`);
      continue;
    }
    const userId = people.get(ping.person);
    if (userId === undefined) {
      unresolved.push({ kind: "person", label: ping.person });
      continue;
    }
    tokens.push(`<@${userId}>`);
  }
  return { tokens, unresolved };
}

/** Everything a poll send needs, decided once. */
export interface PollPlan {
  readonly actor: "bot";
  readonly channel: string;
  readonly artifact: PollArtifact;
  readonly ballot: readonly PollBallotEntry[];
  readonly payload: SlackPollPayload;
  /** Both the duplicate key and the store's `pollId` — see `pollIdentity`. */
  readonly pollId: string;
}

/**
 * Build the send plan: render once, and derive the identity from the form.
 *
 * @param options the parsed post invocation
 * @param artifact the validated poll
 * @param pings the already-resolved mention tokens
 * @param chrome the configured full bot chrome
 * @param metadataEventType the poll's `metadata.event_type`, from the operator's profile chrome
 * @param surface where the poll is being posted, which decides what the footer may truthfully claim
 * @returns the plan the dry run and the real send both consume
 */
export function buildPollPlan({
  options,
  artifact,
  pings,
  chrome,
  metadataEventType,
  surface,
}: {
  options: PollPostOptions;
  artifact: PollArtifact;
  pings: readonly string[];
  chrome: SlackCardChrome;
  metadataEventType: string;
  surface: PollSurface;
}): PollPlan {
  const ballot = pollBallot({ options: artifact.options });
  const pollId = pollIdentity({ actor: "bot", artifact, channel: options.channel });
  return {
    actor: "bot",
    artifact,
    ballot,
    channel: options.channel,
    payload: renderPoll({
      artifact,
      ballot,
      chrome,
      metadataEventType,
      pings,
      pollId,
      surface,
    }),
    pollId,
  };
}

/**
 * The poll's blocks as readable lines, for the dry run.
 *
 * Reads the WRAPPER rather than `text`, because a poll's `text` is deliberately empty (a non-empty one renders a
 * duplicate body above the stripe) — so previewing `text` would show a reviewer nothing at all.
 */
function previewPollLines({ plan }: { plan: PollPlan }): readonly string[] {
  return plan.payload.attachments[0].blocks.flatMap((block) => {
    if (block.type === "header") {
      return [block.text.text];
    }
    if (block.type === "section" && block.text !== undefined) {
      return block.text.text.split("\n");
    }
    if (block.type === "context") {
      return block.elements.flatMap((element) => ("text" in element ? [element.text] : []));
    }
    return [];
  });
}

/**
 * The human ballot lines: one per option, naming its emoji, position and label.
 *
 * @param ballot the ballot entries, in presentation order
 * @returns one line per option — the emoji name is shown because it doubles as the reaction to click
 */
function pollBallotLines({ ballot }: { ballot: readonly PollBallotEntry[] }): readonly string[] {
  return ballot.map((entry) => `  :${entry.emojiName}:  (${String(entry.position)})  ${entry.label}`);
}

/**
 * Authored text that LOOKS like an emoji shortcode and will therefore render as literal punctuation.
 *
 * GLOBAL, and consumed with `matchAll` so no `lastIndex` state leaks between fields.
 */
const SHORTCODE_LOOKALIKE = /:[a-z0-9_+-]+:/g;

/**
 * A literal keycap character (0️⃣–9️⃣, 🔟) in authored text.
 *
 * Worth its own warning because it competes with the BALLOT rather than merely rendering oddly: an option
 * labelled `2️⃣ do this` shows a second keycap beside its own marker, and a reader may react with the keycap
 * they can see rather than the one that votes for that option. Advisory, not a refusal — the shape of the form
 * is constrained here, never the words in it.
 */
const KEYCAP_CHARACTER = /[0-9]\uFE0F?\u20E3|\uD83D\uDD1F/g;

/**
 * The advisory warnings for one poll. NEVER fatal — warnings inform, they do not block.
 *
 * This is the poll's analogue of the card's `markdown-in-plain-text` warning, and it exists for the same
 * measured reason: `rich_text` does not expand `:shortcode:` emoji, so a `:tada:` written into a question or
 * an option label renders as the literal characters `:tada:`. The BALLOT markers are unaffected — they are
 * structural emoji elements — but authored prose is passed through verbatim by design.
 *
 * Deliberately a warning rather than a rejection. The repo's rule is that the SHAPE of a form is constrained
 * and its words never are; the old system's content gate blocked legitimate work and had to be torn out. An
 * author who genuinely wants the literal text `:one:` in a label may have it.
 *
 * @param artifact the validated poll
 * @returns one warning per lookalike, in field order; empty when there is nothing to say
 */
export function pollDryRunWarnings({ artifact }: { artifact: PollArtifact }): readonly string[] {
  const fields: readonly { readonly path: string; readonly text: string }[] = [
    { path: "question", text: artifact.question },
    { path: "why", text: artifact.why },
    ...artifact.options.map((text, index) => ({ path: `options[${String(index)}]`, text })),
  ];
  return fields.flatMap(({ path, text }) => [
    ...[...text.matchAll(SHORTCODE_LOOKALIKE)].map(
      (hit) =>
        `${path} contains ${JSON.stringify(hit[0])}, which will render as LITERAL text — rich_text does not ` +
        "expand emoji shortcodes. The ballot emoji are added structurally and are not affected. Advisory only.",
    ),
    ...[...text.matchAll(KEYCAP_CHARACTER)].map(
      (hit) =>
        `${path} contains the keycap ${JSON.stringify(hit[0])}, which COMPETES with the ballot — a reader may ` +
        "react with the number they can see rather than the one that votes for this option. Advisory only.",
    ),
  ]);
}

/**
 * The dry-run report: the message as a reader sees it, the emoji mapping, and the one step it would take.
 *
 * @param plan the fully-decided send
 * @returns the report lines, in display order
 */
export function pollDryRunLines({ plan }: { plan: PollPlan }): readonly string[] {
  const warnings = pollDryRunWarnings({ artifact: plan.artifact });
  return [
    "DRY RUN — nothing was posted.",
    "",
    `channel: ${plan.channel}   as: bot   poll-id: ${plan.pollId}`,
    "",
    "the message, as it would render:",
    ...previewPollLines({ plan }).map((line) => `  | ${line}`),
    "",
    "the ballot — react with this emoji to vote for this option:",
    ...pollBallotLines({ ballot: plan.ballot }),
    "",
    `step 1: chat.postMessage(channel=${plan.channel}, 1 rich_text block, no attachments)`,
    ...plan.ballot.map(
      (entry, index) => `step ${String(index + 2)}: reactions.add(:${entry.emojiName}:) — seeds the clickable chip`,
    ),
    "  the chips are what people click, so nobody has to look up an emoji name.",
    "",
    "after posting, read the votes back with:",
    `  slopweaver slack poll results --channel ${plan.channel} --ts <ts>`,
    ...(warnings.length === 0 ? [] : ["", "advisory warnings (these never block a send):"]),
    ...warnings.map((warning) => `  ! ${warning}`),
  ];
}
