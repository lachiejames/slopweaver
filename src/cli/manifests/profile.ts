/**
 * Lazy manifest for the `profile` noun — what the world model knows about its owner and about people.
 *
 * The bare noun resolves to `show` (read-only), the same rule `store` and `lexical` follow for the same
 * reason: a bare noun must never be able to write.
 */
import { PROFILE_GUIDANCE_USAGE } from "../commands/profile/guidanceUsage.js";
import { PROFILE_STANDING_USAGE } from "../commands/profile/standingUsage.js";
import { PROFILE_STEERS_USAGE } from "../commands/profile/steersUsage.js";
import { PROFILE_VOICE_USAGE } from "../commands/profile/voiceUsage.js";
import { PROFILE_WORDS_USAGE } from "../commands/profile/wordsUsage.js";
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

const readMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  parseRejectIsIoFree: true,
} as const;

const writeMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  parseRejectIsIoFree: true,
} as const;

const showMeta = {
  ...readMeta,
  // A bare run is the read: `runProfileShow` opens the store and calls `readOwnerProfile` with no flag at all.
  dryParseSafe: false,
  example: "slopweaver profile show",
  summary: "Show what the world model knows about its owner — the global row, not a per-project memory",
  usage: "usage: slopweaver profile show [--json]",
} as const;

const setMeta = {
  ...writeMeta,
  example: "slopweaver profile set --file ./owner.json",
  summary: "Write the owner row from a file, pinned to the revision the store currently holds",
  usage: "usage: slopweaver profile set --file <owner.json> [--json]",
} as const;

const personMeta = {
  ...writeMeta,
  example: 'slopweaver profile person --name "Chris Jarvis"',
  summary: "Read or curate one person's judgement column on the identity register",
  usage: "usage: slopweaver profile person (--id <uuid> | --name <display name>) [--file <judgement.json>] [--json]",
} as const;

const voiceMeta = {
  ...writeMeta,
  // Every flag is optional: a bare run opens the store and reads the length register (`runProfileVoice`).
  dryParseSafe: false,
  example: "slopweaver profile voice measure --dry-run",
  summary:
    "Read the measured length register, import cohorts into it from a file, or measure it from the Slack messages the owner sent",
  usage: PROFILE_VOICE_USAGE,
} as const;

const contextMeta = {
  ...writeMeta,
  // Every flag is optional: a bare run renders the context and records the attempt (`contextRun.ts`).
  dryParseSafe: false,
  example: "slopweaver profile context",
  summary: "Render the always-loaded context a session receives, live or from the cache, and say which",
  usage: "usage: slopweaver profile context [--json]",
} as const;

const hookMeta = {
  ...writeMeta,
  // `runProfileHookWith` parses nothing but `--help`: a bare run and an unknown flag both run `loadProfileForHook` and append the ledger row.
  dryParseSafe: false,
  parseRejectIsIoFree: false,
  example: "slopweaver profile hook",
  summary: "The SessionStart emitter — print the always-loaded context as the harness's own additionalContext",
  usage: "usage: slopweaver profile hook",
} as const;

const harvestMeta = {
  ...writeMeta,
  example: "slopweaver profile harvest --manifest ./harvest.json",
  summary: "Apply a hash-pinned disposition manifest over the archived profile unit's history files",
  usage: "usage: slopweaver profile harvest --manifest <path.json> [--apply] [--json]",
} as const;

const wordsMeta = {
  ...readMeta,
  // Every flag is optional: a bare run reads the owner's turns and prints them (`wordsRun.ts`).
  dryParseSafe: false,
  example: 'slopweaver profile words --phrase "jumpcloud atlas" --since 1d',
  summary:
    "The owner's own words, newest first: their call and console turns, and what they typed to each chair while it held the supervisor pin, with instant, how, where and anchor",
  usage: PROFILE_WORDS_USAGE,
} as const;

const steersMeta = {
  ...writeMeta,
  // A bare run reads the steers ledger and reports (`steersRun.ts`); only the journalling write needs a flag.
  dryParseSafe: false,
  example: "slopweaver profile steers unread --since 60d",
  summary:
    "Which kind of correction each turn of the owner's names about the Slack drafts written as them, the turns not yet read for it, and the write that journals one read",
  usage: PROFILE_STEERS_USAGE,
} as const;

const standingMeta = {
  ...writeMeta,
  // A bare run lists the standing asks (`standingRun.ts`); only `add` and its kin write.
  dryParseSafe: false,
  example: "slopweaver profile standing add organisation-intelligence --anchor talk:<turn> --covers findings",
  summary:
    "The owner's standing asks: the words a Queue card quotes when no particular steer of theirs produced it, each read off its anchor, and what it covers",
  usage: PROFILE_STANDING_USAGE,
} as const;

const guidanceMeta = {
  ...readMeta,
  // A bare run reads every source (`guidanceRun.ts`): the store, the home and the memory folders.
  dryParseSafe: false,
  example: "slopweaver profile guidance --json",
  summary:
    "Every source of the owner's guidance in rank order, doctrine then standing rules then rulings and memory, each entry with its citation and an empty source named as empty",
  usage: PROFILE_GUIDANCE_USAGE,
} as const;

const loadShow = () => import("../commands/profile/run.js").then((m) => m.profileShowCommand);

export const profileManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadShow, meta: showMeta }),
  context: lazy({
    load: () => import("../commands/profile/contextRun.js").then((m) => m.profileContextCommand),
    meta: contextMeta,
  }),
  guidance: lazy({
    load: () => import("../commands/profile/guidanceRun.js").then((m) => m.profileGuidanceCommand),
    meta: guidanceMeta,
  }),
  harvest: lazy({
    load: () => import("../commands/profile/harvestRun.js").then((m) => m.profileHarvestCommand),
    meta: harvestMeta,
  }),
  hook: lazy({
    load: () => import("../commands/profile/hookRun.js").then((m) => m.profileHookCommand),
    meta: hookMeta,
  }),
  person: lazy({
    load: () => import("../commands/profile/run.js").then((m) => m.profilePersonCommand),
    meta: personMeta,
  }),
  set: lazy({ load: () => import("../commands/profile/run.js").then((m) => m.profileSetCommand), meta: setMeta }),
  show: lazy({ load: loadShow, meta: showMeta }),
  standing: lazy({
    load: () => import("../commands/profile/standingRun.js").then((m) => m.profileStandingCommand),
    meta: standingMeta,
  }),
  steers: lazy({
    load: () => import("../commands/profile/steersRun.js").then((m) => m.profileSteersCommand),
    meta: steersMeta,
  }),
  voice: lazy({ load: () => import("../commands/profile/run.js").then((m) => m.profileVoiceCommand), meta: voiceMeta }),
  words: lazy({
    load: () => import("../commands/profile/wordsRun.js").then((m) => m.profileWordsCommand),
    meta: wordsMeta,
  }),
};
