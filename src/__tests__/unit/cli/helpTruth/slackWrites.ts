/**
 * The help-truth tables' rows for `slack`'s write verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { slackArgumentErrorLines } from "../../../../cli/commands/slack/argumentErrors.js";
import { parseSlackWriteArgs, SLACK_WRITE_FLAG_SPEC } from "../../../../cli/commands/slack/coreArgs.js";
import { parseCorrectArgs, SLACK_CORRECT_FLAG_SPEC } from "../../../../cli/commands/slack/correctArgs.js";
import {
  parseDeleteArgs,
  parseEditArgs,
  SLACK_DELETE_FLAG_SPEC,
  SLACK_EDIT_FLAG_SPEC,
} from "../../../../cli/commands/slack/lifecycleCore.js";
import { parsePollArgs, SLACK_POLL_FLAG_SPECS } from "../../../../cli/commands/slack/pollCore.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { flagNamesOf, PROBE_HOME, SLACK_BOT_POST_PROBE, SLACK_ME_REPLY_PROBE } from "./sharedProbes.js";

/** The union of several specs' flag tokens — a verb with sub-commands advertises all of them in one usage. */
function unionOfSpecs({
  specs,
}: {
  specs: readonly { readonly value: readonly string[]; readonly boolean?: readonly string[] }[];
}): readonly string[] {
  return [...new Set(specs.flatMap((spec) => flagNamesOf({ spec })))];
}

/**
 * `slack post` and `slack reply` share ONE flag spec and refuse one of its flags each — `post` refuses
 * `--thread-ts` ("use `slack reply`") and `reply --as me` refuses `--shape` (a reply's messages all go into
 * the thread named). So the advertised set is the spec MINUS the flag that verb refuses, and each usage is
 * checked against its own list. The two exclusions are the one place here that is not derived, so each is
 * pinned by its own refusal test below rather than left to the sweep.
 */
const SLACK_POST_FLAG_NAMES: readonly string[] = flagNamesOf({ spec: SLACK_WRITE_FLAG_SPEC }).filter(
  (flag) => flag !== "--thread-ts",
);

/** `slack reply`'s advertised flags — see {@link SLACK_POST_FLAG_NAMES} for why `--shape` is absent. */
const SLACK_REPLY_FLAG_NAMES: readonly string[] = flagNamesOf({ spec: SLACK_WRITE_FLAG_SPEC }).filter(
  (flag) => flag !== "--shape",
);

/** `slack poll`'s advertised flags: the union of the post and `results` specs, which share one usage. */
const SLACK_POLL_FLAG_NAMES: readonly string[] = unionOfSpecs({ specs: Object.values(SLACK_POLL_FLAG_SPECS) });

/** A valid `slack post --as me`: the drip lane also requires `--shape`, which has no default. */
const SLACK_ME_POST_PROBE: readonly string[] = ["--as", "me", "--channel", "D1", "--shape", "top-level", "--body", "-"];

/** A valid `slack reply --as bot`: a reply requires the parent `--thread-ts`. */
const SLACK_BOT_REPLY_PROBE: readonly string[] = [
  "--as",
  "bot",
  "--channel",
  "D1",
  "--thread-ts",
  "1712345678.000100",
  "--form",
  "-",
];

/** A valid `slack edit` on the bot lane: `--channel`, `--ts` and `--form` are required together. */
const SLACK_BOT_EDIT_PROBE: readonly string[] = ["--channel", "D1", "--ts", "1712345678.000100", "--form", "-"];

/** A valid `slack edit --as me` — the lane the owner's ruling was about, from `--body` rather than a form. */
const SLACK_ME_EDIT_PROBE: readonly string[] = [
  "--as",
  "me",
  "--channel",
  "D1",
  "--ts",
  "1712345678.000100",
  "--body",
  "-",
];

/** A valid `slack delete`: a message is addressed by channel and timestamp, never guessed. */
const SLACK_DELETE_PROBE: readonly string[] = ["--channel", "D1", "--ts", "1712345678.000100"];

/** A valid `slack correct`: a same-order figure, so no `--magnitude-seen` is owed. */
const SLACK_CORRECT_PROBE: readonly string[] = [
  "--channel",
  "C1",
  "--ts",
  "1712345678.000100",
  "--wrong",
  "10 failed",
  "--correction",
  "30 failed.",
];

/** A valid `slack poll` post: the bot lane is the only one a poll has. */
const SLACK_POLL_POST_PROBE: readonly string[] = ["--as", "bot", "--channel", "D1", "--form", "-"];

/** A valid `slack poll results`, whose mode token leads the tail. */
const SLACK_POLL_RESULTS_PROBE: readonly string[] = ["results", "--channel", "D1", "--ts", "1712345678.000100"];

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "slack correct": flagNamesOf({ spec: SLACK_CORRECT_FLAG_SPEC }),
  "slack delete": flagNamesOf({ spec: SLACK_DELETE_FLAG_SPEC }),
  "slack edit": flagNamesOf({ spec: SLACK_EDIT_FLAG_SPEC }),
  "slack poll": SLACK_POLL_FLAG_NAMES,
  "slack post": SLACK_POST_FLAG_NAMES,
  "slack reply": SLACK_REPLY_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  /**
   * The lane a flag belongs to IS the probe. `slack post`'s two lanes take different flags and refuse each
   * other's by name, so `--body` probed on the bot lane would fail on "not valid with `--as bot`" — a real
   * refusal that reads exactly like the flag not existing, which is the confusion this whole file exists to
   * remove.
   */
  "slack post": {
    "--allow-unresolved-owner": [...SLACK_BOT_POST_PROBE, "--allow-unresolved-owner"],
    "--approve": ["--as", "me", "--draft", "sd-1a2b3c4d", "--approve", "3f2a9c11d4e5b6a7"],
    "--as": [...SLACK_BOT_POST_PROBE],
    "--body": [...SLACK_ME_POST_PROBE],
    "--channel": [...SLACK_BOT_POST_PROBE],
    "--draft": ["--as", "me", "--draft", "sd-1a2b3c4d", "--approve", "3f2a9c11d4e5b6a7"],
    "--dry-run": [...SLACK_BOT_POST_PROBE, "--dry-run"],
    "--form": [...SLACK_BOT_POST_PROBE],
    "--home": [...SLACK_BOT_POST_PROBE, "--home", "/tmp"],
    "--idempotency-key": [...SLACK_BOT_POST_PROBE, "--idempotency-key", "recipe-slot:deadbeef"],
    "--dm-purpose": [...SLACK_BOT_POST_PROBE, "--dm-purpose", "asked-for"],
    "--json": [...SLACK_BOT_POST_PROBE, "--json"],
    "--media": [...SLACK_BOT_POST_PROBE, "--media", "a.png"],
    "--no-picture-because": [...SLACK_BOT_POST_PROBE, "--no-picture-because", "each ticket page shows only its title"],
    "--resend-unconfirmed": [...SLACK_ME_POST_PROBE, "--resend-unconfirmed"],
    "--shape": [...SLACK_ME_POST_PROBE],
    "--thanks-instead": [
      "--as",
      "me",
      "--draft",
      "sd-1a2b3c4d",
      "--approve",
      "3f2a9c11d4e5b6a7",
      "--thanks-instead",
      "Thanks for the review.",
    ],
    "--thread-moved-cleared": [
      "--as",
      "me",
      "--draft",
      "sd-1a2b3c4d",
      "--approve",
      "3f2a9c11d4e5b6a7",
      "--thread-moved-cleared",
      "1712345678.000100",
    ],
  },
  "slack reply": {
    "--allow-unresolved-owner": [...SLACK_BOT_REPLY_PROBE, "--allow-unresolved-owner"],
    "--approve": ["--as", "me", "--draft", "sd-1a2b3c4d", "--approve", "3f2a9c11d4e5b6a7"],
    "--as": [...SLACK_BOT_REPLY_PROBE],
    "--body": [...SLACK_ME_REPLY_PROBE],
    "--channel": [...SLACK_BOT_REPLY_PROBE],
    "--draft": ["--as", "me", "--draft", "sd-1a2b3c4d", "--approve", "3f2a9c11d4e5b6a7"],
    "--dry-run": [...SLACK_BOT_REPLY_PROBE, "--dry-run"],
    "--form": [...SLACK_BOT_REPLY_PROBE],
    "--home": [...SLACK_BOT_REPLY_PROBE, "--home", "/tmp"],
    "--idempotency-key": [...SLACK_BOT_REPLY_PROBE, "--idempotency-key", "recipe-slot:deadbeef"],
    "--dm-purpose": [...SLACK_BOT_REPLY_PROBE, "--dm-purpose", "asked-for"],
    "--json": [...SLACK_BOT_REPLY_PROBE, "--json"],
    "--media": [...SLACK_BOT_REPLY_PROBE, "--media", "a.png"],
    "--no-picture-because": [...SLACK_BOT_REPLY_PROBE, "--no-picture-because", "each ticket page shows only its title"],
    "--resend-unconfirmed": [...SLACK_ME_REPLY_PROBE, "--resend-unconfirmed"],
    "--thanks-instead": [
      "--as",
      "me",
      "--draft",
      "sd-1a2b3c4d",
      "--approve",
      "3f2a9c11d4e5b6a7",
      "--thanks-instead",
      "Thanks for the review.",
    ],
    "--thread-moved-cleared": [
      "--as",
      "me",
      "--draft",
      "sd-1a2b3c4d",
      "--approve",
      "3f2a9c11d4e5b6a7",
      "--thread-moved-cleared",
      "1712345678.000100",
    ],
    "--thread-ts": [...SLACK_BOT_REPLY_PROBE],
  },
  "slack edit": {
    "--allow-unresolved-owner": [...SLACK_BOT_EDIT_PROBE, "--allow-unresolved-owner"],
    "--as": [...SLACK_BOT_EDIT_PROBE, "--as", "bot"],
    "--body": [...SLACK_ME_EDIT_PROBE],
    "--channel": [...SLACK_BOT_EDIT_PROBE],
    "--dry-run": [...SLACK_BOT_EDIT_PROBE, "--dry-run"],
    "--form": [...SLACK_BOT_EDIT_PROBE],
    "--home": [...SLACK_BOT_EDIT_PROBE, "--home", "/tmp"],
    "--json": [...SLACK_BOT_EDIT_PROBE, "--json"],
    "--ts": [...SLACK_BOT_EDIT_PROBE],
  },
  "slack correct": {
    "--as": [...SLACK_CORRECT_PROBE, "--as", "me"],
    "--channel": [...SLACK_CORRECT_PROBE],
    "--correction": [...SLACK_CORRECT_PROBE],
    "--dry-run": [...SLACK_CORRECT_PROBE, "--dry-run"],
    "--home": [...SLACK_CORRECT_PROBE, "--home", "/tmp"],
    "--json": [...SLACK_CORRECT_PROBE, "--json"],
    "--magnitude-seen": [...SLACK_CORRECT_PROBE, "--magnitude-seen", "EV8Ywr56"],
    "--notify-draft": [...SLACK_CORRECT_PROBE, "--urgent", "--notify-draft", "sd-1a2b3c4d"],
    "--ts": [...SLACK_CORRECT_PROBE],
    "--urgent": [...SLACK_CORRECT_PROBE, "--urgent", "--notify-draft", "sd-1a2b3c4d"],
    "--wrong": [...SLACK_CORRECT_PROBE],
  },
  "slack delete": {
    "--as": [...SLACK_DELETE_PROBE, "--as", "me"],
    "--channel": [...SLACK_DELETE_PROBE],
    "--dry-run": [...SLACK_DELETE_PROBE, "--dry-run"],
    "--home": [...SLACK_DELETE_PROBE, "--home", "/tmp"],
    "--json": [...SLACK_DELETE_PROBE, "--json"],
    "--ts": [...SLACK_DELETE_PROBE],
  },
  "slack poll": {
    "--as": [...SLACK_POLL_POST_PROBE],
    "--channel": [...SLACK_POLL_POST_PROBE],
    "--dry-run": [...SLACK_POLL_POST_PROBE, "--dry-run"],
    "--form": [...SLACK_POLL_POST_PROBE],
    "--home": [...SLACK_POLL_POST_PROBE, "--home", "/tmp"],
    "--json": [...SLACK_POLL_POST_PROBE, "--json"],
    "--poll-id": [...SLACK_POLL_RESULTS_PROBE, "--poll-id", "poll-1"],
    "--ts": [...SLACK_POLL_RESULTS_PROBE],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "slack correct": ({ fragment }) =>
    parseCorrectArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }).mapErr((error) =>
      slackArgumentErrorLines({ error }),
    ),
  "slack delete": ({ fragment }) =>
    parseDeleteArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }).mapErr((error) =>
      slackArgumentErrorLines({ error }),
    ),
  "slack edit": ({ fragment }) =>
    parseEditArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }).mapErr((error) =>
      slackArgumentErrorLines({ error }),
    ),
  "slack poll": ({ fragment }) => parsePollArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }),
  "slack post": ({ fragment }) =>
    parseSlackWriteArgs({ defaultHome: PROBE_HOME, rest: [...fragment], verb: "post" }).mapErr((error) =>
      slackArgumentErrorLines({ error }),
    ),
  "slack reply": ({ fragment }) =>
    parseSlackWriteArgs({ defaultHome: PROBE_HOME, rest: [...fragment], verb: "reply" }).mapErr((error) =>
      slackArgumentErrorLines({ error }),
    ),
};

/** The rows for `slack`'s write verbs. */
export const slackWritesSlice: HelpTruthSlice = { guarded, probes, parsers };
