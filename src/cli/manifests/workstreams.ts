/**
 * Lazy manifest for the `workstreams` noun — the owner's OUTCOMES register, the store's `workstream` rows the console's
 * Workstreams page reads. `effect: "local-state"`: the local store and ledgers under the home,
 * nothing external and no model.
 */
import {
  WORKSTREAMS_CANDIDATES_PUT_USAGE,
  WORKSTREAMS_CANDIDATES_USAGE,
  WORKSTREAMS_DEFINE_USAGE,
  WORKSTREAMS_LIST_USAGE,
  WORKSTREAMS_LOOP_IN_USAGE,
  WORKSTREAMS_PROPOSE_USAGE,
  WORKSTREAMS_PUT_USAGE,
  WORKSTREAMS_REACT_USAGE,
  WORKSTREAMS_RETITLE_USAGE,
  WORKSTREAMS_WHO_FIRST_USAGE,
} from "../commands/workstreams/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const sharedMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  parseRejectIsIoFree: true,
} as const;

/** The `workstreams` noun's verbs as lazy manifest entries. */
export const workstreamsManifest: Readonly<Record<string, VerbManifestEntry>> = {
  list: lazy({
    load: () => import("../commands/workstreams/list.js").then((m) => m.workstreamsListCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver workstreams list --json",
      summary:
        "The owner's workstreams register read from the store, each workstream's progress DERIVED against its own " +
        "milestones — how many are done, the next one ready — as the schema-version-2 document the console's " +
        "Workstreams page reads and `workstreams put` takes back",
      usage: WORKSTREAMS_LIST_USAGE,
    },
  }),
  candidates: lazy({
    load: () => import("../commands/workstreams/candidates.js").then((m) => m.workstreamsCandidatesCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver workstreams candidates --json",
      summary:
        "The workstreams mined from a person's connected history, their latest reaction, picked definition of " +
        "done and owed conversations on each, and the register entry it is held under, with what the Workstreams " +
        "seat owes — the document the console's Proposed workstreams section reads",
      usage: WORKSTREAMS_CANDIDATES_USAGE,
    },
  }),
  "candidates-put": lazy({
    load: () => import("../commands/workstreams/candidatesPut.js").then((m) => m.workstreamsCandidatesPutCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver workstreams candidates-put --file ./candidates.json",
      summary:
        "Validate a whole set of mined workstream candidates and write it atomically; their reactions are kept " +
        "apart, so re-mining never loses one",
      usage: WORKSTREAMS_CANDIDATES_PUT_USAGE,
    },
  }),
  react: lazy({
    load: () => import("../commands/workstreams/react.js").then((m) => m.workstreamsReactCommand),
    meta: {
      ...sharedMeta,
      example: 'slopweaver workstreams react "12 yes, 13 no" --via word',
      summary:
        "Record the owner's word on mined candidates — yes, no, done, same as, milestone or outcome of, superseded and the " +
        "rest, by number in their words or one id from a console press — and make every new yes a register entry",
      usage: WORKSTREAMS_REACT_USAGE,
    },
  }),
  retitle: lazy({
    load: () => import("../commands/workstreams/retitle.js").then((m) => m.workstreamsRetitleCommand),
    meta: {
      ...sharedMeta,
      example: 'slopweaver workstreams retitle --candidate c-012 --title "Know about a bug the moment it happens"',
      summary:
        "Give a mined candidate the title the person wants, keeping the mined name as its identity, and carry it " +
        "onto the register entry their word already made",
      usage: WORKSTREAMS_RETITLE_USAGE,
    },
  }),
  propose: lazy({
    load: () => import("../commands/workstreams/propose.js").then((m) => m.workstreamsProposeCommand),
    meta: {
      ...sharedMeta,
      example: 'slopweaver workstreams propose --title "Human PR review friction" --via word',
      summary:
        "Record a workstream the person proposes in their own words — split off, instead of or beside a candidate, " +
        "or outright — for the next mine to read into a candidate",
      usage: WORKSTREAMS_PROPOSE_USAGE,
    },
  }),
  "who-first": lazy({
    load: () => import("../commands/workstreams/whoFirst.js").then((m) => m.workstreamsWhoFirstCommand),
    meta: {
      ...sharedMeta,
      example: 'slopweaver workstreams who-first --candidate c-044 --people "Jasper and Quinn" --team "platform team"',
      summary:
        "Record who the first conversation about a candidate is with, as people, apart from the team that owns " +
        "it — nothing sent",
      usage: WORKSTREAMS_WHO_FIRST_USAGE,
    },
  }),
  define: lazy({
    load: () => import("../commands/workstreams/define.js").then((m) => m.workstreamsDefineCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver workstreams define --candidate c-012 --option owned-and-read --via console",
      summary:
        "Record what done means for a mined candidate — one offered definition with its trade-off, or their own " +
        "words — and carry it onto the accepted workstream's definition of done with a dated note",
      usage: WORKSTREAMS_DEFINE_USAGE,
    },
  }),
  // Local state for the reason `slack draft` is: it parks one row in the draft register and posts NOTHING; the
  // Slack calls the park makes are reads.
  "loop-in": lazy({
    load: () => import("../commands/workstreams/loopIn.js").then((m) => m.workstreamsLoopInCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver workstreams loop-in --candidate c-012 --person U0SYN123ABCD",
      summary:
        "Park the conversation a mined candidate owes one person as a draft on the Queue, the candidate's opener " +
        "to their DM — never sent; the owner sends it from the Queue",
      usage: WORKSTREAMS_LOOP_IN_USAGE,
    },
  }),
  put: lazy({
    load: () => import("../commands/workstreams/put.js").then((m) => m.workstreamsPutCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver workstreams put --file ./document.json",
      summary:
        "Take back an edited `workstreams list --json` document and write it to the store as one batch, refused " +
        "whole when the register moved since its baseline or one rule fails — a milestone finished without its link is one",
      usage: WORKSTREAMS_PUT_USAGE,
    },
  }),
};
