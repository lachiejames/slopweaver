/**
 * Which 1Password families are highly voluminous, under the owner's volume ruling.
 *
 * ## The audit feed is an observation the WINDOW bounds, and it stays as rows
 *
 * `event` is the only family here over the row ceiling and it is unmistakably an observation on §6's
 * criterion: one record per sign-in, item use, vault grant or administrative action, identified by the
 * instant it happened, emitted by 1Password rather than created by anybody. The tempting move is
 * `shape-index`, and it would be wrong on this platform, for this reason.
 *
 * "It is a time series" is not a ground for shape-indexing: the Cloudflare atlas keeps `dex-fleet-status`
 * as rows, measured against a terabyte as the owner's example of a qualifying volume
 * (`cloudflare/inventory.ts`), and this feed's declared window is weighed against the same bound with the
 * command in its `establishedBy`. Shape-indexing it would apply the criterion while ignoring the bound the
 * owner set, and it would drop a family that fits on disk.
 *
 * What makes it finite is its own read, and that is what the verdict records. `eventsClient.ts` walks at
 * most `MAX_PAGES` (200) pages of `PAGE_SIZE` (1000) from a declared `--since`, defaulting to
 * `ONEPASSWORD_DEFAULT_SINCE_DAYS` (thirty) precisely because _"an unbounded default would silently
 * truncate on a busy account and report a gap on every run"_ — and a walk that hits the page bound
 * publishes an `events-pagination-incomplete` gap rather than presenting the page as the picture. So the
 * family the atlas holds is a declared window of a stream, honestly labelled, not the stream.
 */
import type { AtlasVolumeDeclaration, AtlasVolumeVerdict } from "../kit/volume.js";
import type { OnepasswordKind } from "./model.js";

/** Every 1Password family judged under §6, and what this atlas decided about it. */
const ONEPASSWORD_VOLUME_VERDICTS: readonly AtlasVolumeVerdict<OnepasswordKind>[] = [
  {
    because:
      "audit events — one row per sign-in, item use, vault grant or administrative action, each identified by the instant it happened and emitted by 1Password rather than created by anybody. Observations, not configuration; what keeps them holdable is the window the read declares rather than anything about the record",
    boundedBy:
      "the run's own `--since` window (`ONEPASSWORD_DEFAULT_SINCE_DAYS` = 30) and `eventsClient.ts`'s 200-page × 1,000-row walk bound, which publishes an `events-pagination-incomplete` gap rather than presenting a truncation as the whole feed",
    disposition: "bounded-observation",
    establishedBy: "wc -l ~/.slopweaver/atlas/onepassword/events.jsonl, against the run's own `--since` window",
    kind: "event",
    magnitude: "the live event-row tally over the run's declared `--since` window",
  },
];

/** What this atlas has decided about the volume of every family it holds. */
export const ONEPASSWORD_KIND_VOLUMES: AtlasVolumeDeclaration<OnepasswordKind> = {
  verdicts: ONEPASSWORD_VOLUME_VERDICTS,
};
