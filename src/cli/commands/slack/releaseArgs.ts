/**
 * Argument assembly for `slack post|reply --as me|bot --draft <id> --approve <digest>`, split out of
 * `./coreArgs.ts` beside the two lanes it routes between. `./releaseRun.ts` is what runs the options this builds,
 * and refuses an `--as` that is not the identity the row was recorded under.
 */
import { err, ok } from "../../../lib/result.js";
import { isSlackTs } from "../../../lib/slackTs.js";
import type { SlackActor } from "../../../outbound/slack/types.js";
import { SlackArgumentErrors, type SlackParsed } from "./argumentErrors.js";
import {
  ALLOW_UNRESOLVED_OWNER_FLAG,
  type SlackDraftReleaseOptions,
  type SlackWriteOptions,
  type SlackWriteVerb,
} from "./coreTypes.js";

/**
 * The flags that make `slack post` a release: any one present routes the whole parse here. `--thread-moved-cleared`
 * and `--thanks-instead` belong only to a release (`../../../outbound/slack/releaseFreshness.ts`), so typed alone
 * either lands here too and is refused for want of `--draft`, rather than tokenised and ignored by an ordinary send.
 */
export const DRAFT_FLAGS = ["approve", "draft", "thanks-instead", "thread-moved-cleared"] as const;

/** The longest thanks line a release sends in place of the approved words: one line, never a second message. */
const THANKS_INSTEAD_MAX_CHARS = 200;

/**
 * `--thanks-instead "<one line>"` — the words sent in place of the approved message when it is no longer needed.
 *
 * @param value the flag's value as typed
 * @returns the trimmed line, or why it is not one
 */
function parseThanksLine({ value }: { value: string }): SlackParsed<string> {
  const line = value.trim();
  if (line.length === 0 || /[\r\n]/.test(value) || line.length > THANKS_INSTEAD_MAX_CHARS) {
    return err(SlackArgumentErrors.thanksInsteadInvalid({ got: value, max: THANKS_INSTEAD_MAX_CHARS }));
  }
  return ok(line);
}

/**
 * Every flag a release takes from the ROW instead of the command line, refused by name when typed: the row
 * is what they approved, so a second destination or shape beside it would be a send nobody approved.
 */
const RELEASE_FOREIGN_VALUES = ["body", "channel", "idempotency-key", "media", "shape", "thread-ts"] as const;

/**
 * `--thread-moved-cleared <ts,...>` — the exact change set a session read and judged, every entry a Slack `ts`. An
 * empty entry or a malformed one is refused: a clearance is compared exactly, so a typo would only ever mismatch.
 *
 * @param value the flag's value as typed
 * @returns the set, or why it is not one
 */
function parseClearedSet({ value }: { value: string }): SlackParsed<readonly string[]> {
  const entries = value.split(",").map((entry) => entry.trim());
  const malformed = entries.filter((ts) => !isSlackTs({ ts }));
  if (entries.length === 0 || malformed.length > 0) {
    return err(SlackArgumentErrors.threadMovedClearedInvalid({ got: value, malformed }));
  }
  return ok(entries);
}

/**
 * Assemble `slack post|reply --as me --draft <id> --approve <digest>` — the release of one parked as-me draft.
 *
 * Every rejection is pooled, as the other two lanes pool theirs. `--form` stays legal: the digest binds the
 * bytes that would be POSTED, so a form that renders them is the same approval, and a row recorded before
 * its form was kept can only be released with one. Both verbs parse here; whether the verb matches the ROW
 * — `reply` for a thread row, `post` for a top-level one — needs the row, so `./releaseRun.ts` decides it.
 *
 * @param defaultHome the resolved state home, used when `--home` is absent
 * @param flags the boolean flags present
 * @param values the parsed value flags
 * @param verb the write verb, carried through for the release to check against the row
 * @returns the release options, or every rejection
 */
export function releaseOptions({
  defaultHome,
  flags,
  values,
  verb,
}: {
  defaultHome: string;
  flags: ReadonlySet<string>;
  values: Readonly<Record<string, string | undefined>>;
  verb: SlackWriteVerb;
}): SlackParsed<SlackWriteOptions> {
  const draftId = values["draft"];
  const approve = values["approve"];
  const actor = values["as"];
  const freshness = freshnessFlags({ values });
  const errors = [
    ...requiredFlagRefusals({ values }),
    ...foreignFlagRefusals({ flags, values }),
    ...freshness.refusals,
    ...thanksPairingRefusals({ thanksTyped: values["thanks-instead"] !== undefined, values }),
  ];
  if (errors.length > 0 || draftId === undefined || approve === undefined || !isReleaseActor(actor)) {
    return err(SlackArgumentErrors.argumentsRefused({ reasons: errors }));
  }
  const { home = defaultHome } = values;
  const release: SlackDraftReleaseOptions = {
    actor,
    dryRun: flags.has("dry-run"),
    formSource: values["form"],
    home,
    json: flags.has("json"),
    release: { approve, draftId },
    resendUnconfirmed: flags.has("resend-unconfirmed"),
    ...freshness.parsed,
    verb,
  };
  return ok(release);
}

/**
 * Whether `--as` names one of the two identities a row can be recorded under.
 *
 * @param actor the `--as` value as typed, absent when the flag was not
 * @returns true for `me` or `bot`
 */
function isReleaseActor(actor: string | undefined): actor is SlackActor {
  return actor === "me" || actor === "bot";
}

/**
 * The refusals of the three flags a release cannot run without — `--as`, `--draft` and `--approve` — in that order.
 *
 * @param values the parsed value flags
 * @returns one line per missing flag, none when all three are present
 */
function requiredFlagRefusals({ values }: { values: Readonly<Record<string, string | undefined>> }): readonly string[] {
  const errors: string[] = [];
  if (!isReleaseActor(values["as"])) {
    errors.push(
      "--draft needs `--as me` or `--as bot`, the identity the row was recorded under — " +
        "`slopweaver slack draft show <id>` prints its release command",
    );
  }
  const draftId = values["draft"];
  if (draftId === undefined || draftId.trim() === "") {
    errors.push("--approve needs --draft <id>: the digest binds one parked row — `slopweaver slack draft list`");
  }
  const approve = values["approve"];
  if (approve === undefined || approve.trim() === "") {
    errors.push(
      "--draft needs --approve <digest>: the release sends only the exact bytes that digest binds — " +
        "`slopweaver slack draft show <id>` prints it",
    );
  }
  return errors;
}

/**
 * Every flag typed beside `--draft` that the parked row already fixes, or that governs another lane's send.
 *
 * @param flags the boolean flags present
 * @param values the parsed value flags
 * @returns one line per foreign flag, none when there is none
 */
function foreignFlagRefusals({
  flags,
  values,
}: {
  flags: ReadonlySet<string>;
  values: Readonly<Record<string, string | undefined>>;
}): readonly string[] {
  const errors = RELEASE_FOREIGN_VALUES.filter((name) => values[name] !== undefined).map(
    (name) => `--${name} is not valid with --draft: the parked row already fixes it`,
  );
  if (flags.has(ALLOW_UNRESOLVED_OWNER_FLAG)) {
    errors.push(`--${ALLOW_UNRESOLVED_OWNER_FLAG} is not valid with --draft: it governs a bot digest's owner ping`);
  }
  if (values["dm-purpose"] !== undefined) {
    errors.push("--dm-purpose is not valid with --draft: it declares what a BOT post to their DM is for");
  }
  return errors;
}

/**
 * `--thread-moved-cleared` and `--thanks-instead`, parsed: the fields each well-formed one adds to the release, and
 * the refusal each malformed one draws.
 *
 * @param values the parsed value flags
 * @returns the release fields and the refusals, `--thread-moved-cleared`'s first
 */
function freshnessFlags({ values }: { values: Readonly<Record<string, string | undefined>> }): {
  parsed: Pick<SlackDraftReleaseOptions, "threadMovedCleared" | "thanksInstead">;
  refusals: readonly string[];
} {
  const refusals: string[] = [];
  let parsed: Pick<SlackDraftReleaseOptions, "threadMovedCleared" | "thanksInstead"> = {};
  const clearedValue = values["thread-moved-cleared"];
  if (clearedValue !== undefined) {
    parseClearedSet({ value: clearedValue }).match(
      (threadMovedCleared) => {
        parsed = { ...parsed, threadMovedCleared };
      },
      (error) => {
        refusals.push(error.message);
      },
    );
  }
  const thanksValue = values["thanks-instead"];
  if (thanksValue !== undefined) {
    parseThanksLine({ value: thanksValue }).match(
      (thanksInstead) => {
        parsed = { ...parsed, thanksInstead };
      },
      (error) => {
        refusals.push(error.message);
      },
    );
  }
  return { parsed, refusals };
}

/**
 * What `--thanks-instead` cannot be typed beside: a bot row, which is not theirs to thank from, and `--form`, since the
 * thanks line is the whole message.
 *
 * @param thanksTyped whether `--thanks-instead` was typed at all, well-formed or not
 * @param values the parsed value flags
 * @returns one line per clash, none when `--thanks-instead` is absent
 */
function thanksPairingRefusals({
  thanksTyped,
  values,
}: {
  thanksTyped: boolean;
  values: Readonly<Record<string, string | undefined>>;
}): readonly string[] {
  if (!thanksTyped) {
    return [];
  }
  const errors: string[] = [];
  if (values["as"] === "bot") {
    errors.push(
      "--thanks-instead is their own thanks to a reviewer, so it releases an `--as me` row only — withdraw a bot row " +
        'that is no longer needed with `slopweaver slack draft drop <id> --note "<why>"`',
    );
  }
  if (values["form"] !== undefined) {
    errors.push("--form is not valid with --thanks-instead: the thanks line is what is sent");
  }
  return errors;
}
