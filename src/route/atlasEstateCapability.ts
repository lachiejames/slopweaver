/**
 * The `atlas-estate` routing row — the VENDOR-AGNOSTIC door into the atlas estate.
 *
 * Held apart from `./genericCapabilities.ts` along the seam `file-size-ratchet` found: that file is at its
 * recorded ceiling, and this row's rationale is several times the length of the row. It is one row rather
 * than a table, so it is spliced back into `GENERIC_SOURCE_CAPABILITIES` by reference and nothing about
 * merging, ordering, `./sourceNouns.ts`'s partition or a private overlay's by-id replacement changes.
 *
 * ## Why this row is GENERIC rather than derived
 *
 * `./atlasCapability.ts` derives a row per registered atlas, and its vocabulary is the platform NAME
 * alone — so a question that never names the vendor reaches none of them. `saas-spend` was the only
 * declared answer to that limit, and it answers exactly one class of word. MEASURED on this
 * install: `turn brief --contracts` offered 35 atlas rows and the string `atlas probe` appeared in none
 * of them, so a turn asked "who has access to X" could only reach an atlas by guessing which one.
 * Reproduce with `slopweaver turn brief --contracts --text "who has access to airtable"`.
 */
import { type SourceCapability } from "./profile.js";

/**
 * The vendor-agnostic atlas row: which platforms hold a keyword, and which one to open next.
 */
export const ATLAS_ESTATE_CAPABILITY: SourceCapability = {
  // Its command is the keyword-LESS SCOPE read, for the reason `./genericCapabilities.ts`'s header gives:
  // a whole question substituted into an `ilike` filter matches nothing and reads as ABSENCE, so turning
  // the question into keywords stays the reading session's judgement and `coverage.detail` spells the
  // keyword form out. It reads the STORE rather than the generations, which is why it is the one atlas
  // command needing `SLOPWEAVER_STORE_URL` — `store import-atlas` is what puts the generations there, and
  // an install that has never imported gets a report saying THAT rather than a screen of silent zeroes.
  //
  // THE ONE SHARP EDGE. `atlasPlatformOf` (`./atlasReading.ts`) reads `command[indexOf("atlas") + 1]`, so
  // it calls this row's platform `probe`. That is inert — no registered platform is named `probe`, so it
  // suppresses no derived row, and `deriveAtlasCapability` returns an ungraded row untouched rather than
  // clearing its command. `unit/route/atlasEstateCapability.test.ts` asserts both halves, so the day a
  // platform called `probe` is registered is a red test rather than a row that silently stops planning.
  availability: { kind: "available" },
  command: ["slopweaver", "atlas", "probe"],
  coverage: {
    detail:
      "every atlas generation `slopweaver store import-atlas` has loaded into the store. The command " +
      "above is the cheap SCOPE read — what each platform holds and when it last synced, no question " +
      "involved. The READING is the separate act: `slopweaver atlas probe <keyword> [<keyword>…]` counts " +
      "those keywords by `(platform, kind)`, and KEYWORDS are the judgement rather than the sentence — a " +
      "whole question substituted there matches nothing and reads as ABSENCE. This verb SIZES a lead and " +
      "never answers one: a count here is of STORED " +
      "records and proves nothing about what a provider holds, which is the finding " +
      "`src/atlas/kit/estateEvidence.ts` records two dogfood turns making. Open the winner with " +
      "`slopweaver atlas <platform> read --kind <kind> --query <keyword>` — that verb carries the claim " +
      "boundary, the estate line and the per-row match witness, and its row is on this same roster. A " +
      "zero is the STORE holding nothing on that cell, never a provider holding none; `--platform` " +
      "narrows to one atlas and `--cells` caps what each keyword keeps",
    kind: "bounded",
  },
  effect: "read",
  freshness: {
    detail:
      "as fresh as the last `slopweaver store import-atlas` per platform, which each cell reports as its " +
      "own last-synced instant — so state that instant rather than implying live, and treat a cell whose " +
      "platform last synced weeks ago as the stale reading it is",
    kind: "snapshot",
  },
  id: "atlas-estate",
  owner: "slopweaver",
  sourceClass: "atlas",
  terms: [
    "which platform",
    "which vendor",
    "which atlas",
    "across the estate",
    "anywhere",
    "who has",
    "what holds",
    "estate",
    "atlas",
    "atlases",
  ],
  truthMode: "current",
  what: "which of the atlases this store holds have a keyword at all, and in which kind — the vendor-agnostic way into the atlas estate, for a question that names no platform. The scope read counts them rather than restating a number that would go stale",
};
