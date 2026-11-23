/**
 * The help-truth tables' rows for `slack`'s draft, canvas, DM and status verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { slackArgumentErrorLines } from "../../../../cli/commands/slack/argumentErrors.js";
import { parseCanvasArgs, SLACK_CANVAS_FLAG_SPEC } from "../../../../cli/commands/slack/canvasCore.js";
import { parseDmArgs, SLACK_DM_FLAG_SPEC } from "../../../../cli/commands/slack/dmCore.js";
import { parseSlackDraftArgs, SLACK_DRAFT_FLAG_SPEC } from "../../../../cli/commands/slack/draftCore.js";
import { parseStatusArgs, SLACK_STATUS_FLAG_SPEC } from "../../../../cli/commands/slack/statusCore.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { flagNamesOf, PROBE_HOME } from "./sharedProbes.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  // The three WORKSPACE-SHAPE verbs. Each has one spec covering all of its sub-commands, so the usage
  // block advertises the union and this projection is the whole comparison.
  "slack canvas": flagNamesOf({ spec: SLACK_CANVAS_FLAG_SPEC }),
  "slack draft": flagNamesOf({ spec: SLACK_DRAFT_FLAG_SPEC }),
  "slack dm": flagNamesOf({ spec: SLACK_DM_FLAG_SPEC }),
  "slack status": flagNamesOf({ spec: SLACK_STATUS_FLAG_SPEC }),
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  /**
   * `slack draft` is the fourth sub-command-shaped verb, and each flag is probed on the sub-command that
   * owns it: `--all` only reads on `list`, `--note` only on `drop`, and the composing flags (`--media`
   * included) only on `record`, which refuses an invocation missing any of the three required ones.
   */
  "slack draft": {
    "--act": ["record", "--channel", "C1", "--form", "-", "--why", "w", "--act", "bump"],
    "--all": ["list", "--all"],
    "--anchor": ["approve", "sd-1a2b3c4d", "--anchor", "talk-call:c1#turn_1"],
    "--approved": ["record", "--channel", "C1", "--form", "-", "--why", "w", "--approved", "talk-call:c1#turn_1"],
    "--as": ["record", "--channel", "C1", "--form", "-", "--why", "w", "--as", "bot"],
    "--asked-before": ["record", "--channel", "C1", "--form", "-", "--why", "w", "--asked-before", "none"],
    "--changed": [
      "record",
      "--channel",
      "C1",
      "--form",
      "-",
      "--why",
      "w",
      "--asked-before",
      "https://acme.slack.com/archives/C123/p1785114398557099",
      "--changed",
      "spend tripled",
      "--changed-media",
      "spend.png",
    ],
    "--changed-media": [
      "record",
      "--channel",
      "C1",
      "--form",
      "-",
      "--why",
      "w",
      "--asked-before",
      "https://acme.slack.com/archives/C123/p1785114398557099",
      "--changed-media",
      "spend.png",
      "--changed",
      "spend tripled",
    ],
    "--channel": ["record", "--channel", "C1", "--form", "-", "--why", "w"],
    "--followup-of": [
      "record",
      "--channel",
      "C1",
      "--form",
      "-",
      "--why",
      "w",
      "--act",
      "bump",
      "--followup-of",
      "sd-1a2b3c4d",
      "--thread-ts",
      "1792000000.000100",
    ],
    "--form": ["record", "--channel", "C1", "--form", "-", "--why", "w"],
    "--home": ["list", "--home", "/tmp"],
    "--id": ["show", "--id", "sd-1a2b3c4d"],
    "--json": ["list", "--json"],
    "--kind": ["record", "--channel", "C1", "--form", "-", "--why", "w", "--kind", "finding"],
    "--media": ["record", "--channel", "C1", "--form", "-", "--why", "w", "--media", "a.mp4"],
    "--self-evident": ["record", "--channel", "C1", "--form", "-", "--why", "w", "--self-evident", "a question"],
    "--tried": ["record", "--channel", "C1", "--form", "-", "--why", "w", "--tried", "the page would not load"],
    "--impact": ["record", "--channel", "C1", "--form", "-", "--why", "w", "--impact", "12 users could not check out"],
    "--meaning-changed": [
      "record",
      "--channel",
      "C1",
      "--form",
      "-",
      "--why",
      "w",
      "--supersedes",
      "sd-1a2b3c4d",
      "--meaning-changed",
      "the ask moved",
    ],
    "--not-answered": [
      "record",
      "--channel",
      "C1",
      "--form",
      "-",
      "--why",
      "w",
      "--asked-before",
      "https://acme.slack.com/archives/C123/p1785114398557099",
      "--not-answered",
      "they answered a different question",
    ],
    "--note": ["drop", "sd-1a2b3c4d", "--note", "not sending it"],
    "--reason": ["hold", "sd-1a2b3c4d", "--reason", "no-fleet-slot", "--why", "every slot is busy"],
    "--reviewer": ["record", "--channel", "U1", "--form", "-", "--why", "w", "--reviewer", "new"],
    "--row": ["record", "--channel", "C1", "--form", "-", "--why", "w", "--row", "some-board-row"],
    "--supersedes": ["record", "--channel", "C1", "--form", "-", "--why", "w", "--supersedes", "sd-1a2b3c4d"],
    "--thread-ts": ["record", "--channel", "C1", "--form", "-", "--why", "w", "--thread-ts", "1790145643.664469"],
    "--variant": ["pick", "sd-1a2b3c4d", "--variant", "codex"],
    "--why": ["record", "--channel", "C1", "--form", "-", "--why", "w"],
    "--heard": ["revise", "sd-1a2b3c4d", "--text", "-", "--heard", "make it warmer"],
    "--reading": ["revise", "sd-1a2b3c4d", "--text", "-", "--reading", '["warmer opening"]'],
    "--text": ["revise", "sd-1a2b3c4d", "--text", "-"],
    "--version": ["restore", "sd-1a2b3c4d", "--version", "1"],
  },
  /**
   * The three workspace-shape verbs, each probed on the sub-command the flag actually belongs to.
   *
   * `--canvas` is probed on `replace` rather than `create`, because `create` REFUSES it by name ("names a
   * canvas that already exists") — a real refusal that reads exactly like the flag not existing, which is
   * the confusion `slack post`'s own note above describes. `--channel` on `slack channel` is the same shape:
   * `create` refuses it and `archive` requires it.
   */
  "slack canvas": {
    "--as": ["create", "--title", "T", "--markdown", "b.md", "--as", "bot"],
    "--canvas": ["replace", "--canvas", "F1", "--markdown", "b.md"],
    "--channel": ["create", "--title", "T", "--markdown", "b.md", "--channel", "C1"],
    "--dry-run": ["create", "--title", "T", "--markdown", "b.md", "--dry-run"],
    "--home": ["create", "--title", "T", "--markdown", "b.md", "--home", "/tmp"],
    "--json": ["create", "--title", "T", "--markdown", "b.md", "--json"],
    "--markdown": ["create", "--title", "T", "--markdown", "b.md"],
    "--title": ["create", "--title", "T", "--markdown", "b.md"],
  },
  "slack dm": {
    "--as": ["open", "--with", "seth", "--as", "bot"],
    "--dry-run": ["open", "--with", "seth", "--dry-run"],
    "--home": ["open", "--with", "seth", "--home", "/tmp"],
    "--json": ["open", "--with", "seth", "--json"],
    "--with": ["open", "--with", "seth"],
  },
  "slack status": {
    "--dry-run": ["clear", "--dry-run"],
    "--emoji": ["set", "--emoji", ":palm_tree:"],
    "--home": ["show", "--home", "/tmp"],
    "--json": ["show", "--json"],
    "--text": ["set", "--text", "Public holiday"],
    "--to": ["presence", "--to", "away"],
    "--until": ["set", "--text", "x", "--until", "end-of-day", "--zone", "Australia/Melbourne"],
    "--zone": ["show", "--zone", "Australia/Melbourne"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  // The three WORKSPACE-SHAPE verbs. Each takes a required sub-command, so every fragment carries the one
  // its flag belongs to — a bare tail would fail on the missing sub-command and name the wrong thing.
  "slack canvas": ({ fragment }) =>
    parseCanvasArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }).mapErr((error) =>
      slackArgumentErrorLines({ error }),
    ),
  "slack dm": ({ fragment }) =>
    parseDmArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }).mapErr((error) => slackArgumentErrorLines({ error })),
  "slack status": ({ fragment }) =>
    parseStatusArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }).mapErr((error) => [error.message]),
  "slack draft": ({ fragment }) =>
    parseSlackDraftArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }).mapErr((error) =>
      slackArgumentErrorLines({ error }),
    ),
};

/** The rows for `slack`'s draft, canvas, DM and status verbs. */
export const slackDraftsSlice: HelpTruthSlice = { guarded, probes, parsers };
