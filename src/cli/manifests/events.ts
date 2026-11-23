/**
 * Lazy manifest for the `events` noun — the SUPERVISOR STREAM.
 *
 * `local-state` rather than `none`: a named `--cursor` is a file under `$SLOPWEAVER_HOME` that this verb
 * writes. Without one the verb is a pure read, and declaring the wider of the two shapes is the safe
 * direction — the unsafe one is a verb that writes while claiming to read.
 *
 * `diagnostic` because an `alert` on the stream exits 3: the verb ran perfectly and FOUND something, the
 * same reasoning `listen status` and `doctor` carry.
 */

import { EVENTS_TAIL_USAGE } from "../commands/events/tailUsage.js";
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

const tailMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver events tail --cursor supervisor --min-severity warn",
  parseRejectIsIoFree: true,
  summary:
    "Read the supervisor stream — every state change the Slack listener and the recipe scheduler publish — " +
    "resuming from a named cursor. --follow turns a 20-minute sweep into a wake-on-signal. Exits 3 on an alert",
  usage: EVENTS_TAIL_USAGE,
} as const;

const loadTail = () => import("../commands/events/tail.js").then((m) => m.eventsTailCommand);

export const eventsManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadTail, meta: tailMeta }),
  tail: lazy({ load: loadTail, meta: tailMeta }),
};
