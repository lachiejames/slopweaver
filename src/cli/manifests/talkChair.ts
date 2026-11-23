/**
 * The `talk` noun's two verbs that TYPE into the pinned chair, spread into `./talk.ts` — `wake-chair`, one pointer
 * to the owner's stretches and held relays once they have been quiet two minutes, and `courier`, which the chair runs so that
 * line, and a typed relay from a console cmux refuses, still reach it (`src/talk/relayCourier.ts`). Their own module,
 * like `./talkFiles.ts`, so the noun's manifest stays under the ratchet.
 */
import { TALK_COURIER_USAGE, TALK_WAKE_CHAIR_USAGE } from "../commands/talk/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const talkWakeChairMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver talk wake-chair --dry-run",
  parseRejectIsIoFree: true,
  summary:
    "Type one line into the pinned chair once the owner has been quiet two minutes — every unread stretch and held relay since the last, in order, never their words",
  usage: TALK_WAKE_CHAIR_USAGE,
} as const;

const talkCourierMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver talk courier --once --json",
  parseRejectIsIoFree: true,
  summary:
    "Type into the pinned chair the quiet batch once the owner is quiet, and the typed relays cmux refused a console started outside it — run only by the chair, --follow as a background task",
  usage: TALK_COURIER_USAGE,
} as const;

const loadCourier = () => import("../commands/talk/courierRun.js").then((m) => m.talkCourierCommand);
const loadWakeChair = () => import("../commands/talk/wakeChairRun.js").then((m) => m.talkWakeChairCommand);

/** `talk courier` and `talk wake-chair`, spread into the noun's manifest. */
export const talkChairManifest: Readonly<Record<string, VerbManifestEntry>> = {
  courier: lazy({ load: loadCourier, meta: talkCourierMeta }),
  "wake-chair": lazy({ load: loadWakeChair, meta: talkWakeChairMeta }),
};
