/**
 * The escape-hatch rows for the lifecycle of state outside the repository — a local store elsewhere on this
 * Mac or a stale one, a push ahead of a landed migration, a journal read by a stale reader, and a brief naming
 * a path the state home does not root.
 *
 * A store on ANOTHER host has no row, deliberately: the owner ruled the store local only, a hard rule, so its
 * refusal (`src/store/config.ts`) is a hold no hatch opens.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new store, journal or state-path refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on the store, journal and state-path lifecycle, in register order. */
export const STATE_LIFECYCLE_HATCHES = [
  {
    caught:
      "the store URL logs in on this Mac but is not the address the store lock writes, and the only check that it leads somewhere other than this checkout's own stack reads that server's answer through the very login being judged, so a forward into the locked stack can fake it (measured: five Codex reviews in a row each faked that check a new way) — verify fails closed instead",
    command: "slopweaver store verify",
    exceptions: [
      "the store is deliberately a different Postgres on this Mac (a Homebrew install, a second Docker stack) rather than this checkout's Supabase stack",
      "a throwaway local Postgres named through SLOPWEAVER_STORE_URL for one measurement",
    ],
    id: "local-store-elsewhere",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_LOCAL_STORE_ELSEWHERE" },
    lane: "ambient",
    reader: "src/cli/commands/store/lifecycleRun.ts",
    standing: "proposed",
  },
  {
    caught:
      "the store's migration record does not match the journal — a declared table or policy may not exist in this database, which is a mistake the store is meant to make structurally impossible",
    command: "any slopweaver verb that opens the store",
    exceptions: [
      "reading a database deliberately held at an older schema for a comparison, where the reader touches only tables that exist",
      "the lifecycle verbs themselves, which open raw because they are what moves the state",
      "the chair seating ONE investigator while every boot refuses on this store, so the register and its usage limits read and a seat judges the pending migration, never a blind apply",
    ],
    id: "stale-store",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_STALE_STORE" },
    lane: "ambient",
    reader: "src/store/client.ts",
    standing: "proposed",
  },
  {
    caught:
      "the push would apply a migration that is not on origin/main byte for byte — the shared local store records this checkout's hash, and every checkout without that exact file then reads the store as foreign and refuses",
    command: "slopweaver store push",
    exceptions: [
      "a throwaway Postgres named through SLOPWEAVER_STORE_URL, to measure a branch's migration before it lands",
      "a rehearsal on a database the operator resets from main once it is done",
    ],
    id: "unlanded-migration",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNLANDED_MIGRATION" },
    lane: "ambient",
    reader: "src/store/lifecycle.ts",
    standing: "proposed",
  },
  {
    caught:
      "one or more lines of this run's journal did not decode, so the session that holds the run cannot be proven — and a write over a journal that may already carry a claim, a release or an ending nobody here could read is a write over a guess",
    command: "slopweaver handover <ask|answer|abandon|finish|amend|claim|release|park>",
    exceptions: [
      "the undecodable line is a word a NEWER build wrote and this checkout cannot be pulled right now — the run is stalled on the owner and recording the question matters more than the residue",
      "the damaged line has been read by hand and is provably irrelevant to who holds the run (a truncated final append of an event this verb is about to supersede)",
    ],
    id: "stale-journal-reader",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_STALE_JOURNAL_READER" },
    lane: "ambient",
    reader: "src/handover/staleReader.ts",
    standing: "proposed",
  },
  {
    caught:
      "the brief names a path relative to the state home, and nothing in it says what that path is relative to — so the seat that reads it goes and looks, which is a scan of the disk rather than an open of a file (the docs seat ran a breadth-first scan from / for a handoff images directory: three cores for eleven minutes)",
    command: "writing a brief that names a state-home-relative path",
    exceptions: [
      "the token is a PATTERN being discussed rather than a file to open — a prefix some matcher is tested against",
      "the brief quotes the owner's own words verbatim from a transcript and the wording has to survive unedited",
      "the same sentence has already named the root the path is relative to, absolutely",
    ],
    id: "unrooted-brief-path",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNROOTED_BRIEF_PATH" },
    lane: "ambient",
    reader: "src/handover/briefPaths.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
