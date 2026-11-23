/**
 * The `talk` noun's running list, spread into `./talk.ts` — `list`, the newest ten things the owner, the console voice and
 * the fleet left for each other, and `list-add`, one item onto it (`src/talk/runningList.ts`). Their own module, like
 * `./talkFiles.ts`, so the noun's manifest stays under the ratchet.
 */
import { TALK_LIST_ADD_USAGE, TALK_LIST_USAGE } from "../commands/talk/listUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const talkListMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk list --json",
  parseRejectIsIoFree: true,
  summary:
    "The running list — the newest ten things the owner, the console voice and the fleet left for each other, newest first; --voice-safe masks every item's credentials for the voice",
  usage: TALK_LIST_USAGE,
} as const;

const talkListAddMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: 'printf %s "C0SYN000021" | slopweaver talk list-add --origin fleet --from supervisor --label "the channel"',
  parseRejectIsIoFree: true,
  summary:
    "Put one item from stdin on top of the running list for the owner to see, the oldest past ten falling off — idempotent on --id while it is held",
  usage: TALK_LIST_ADD_USAGE,
} as const;

const loadList = () => import("../commands/talk/listRun.js").then((m) => m.talkListCommand);
const loadListAdd = () => import("../commands/talk/listRun.js").then((m) => m.talkListAddCommand);

/** `talk list` and `talk list-add`, spread into the noun's manifest. */
export const talkListManifest: Readonly<Record<string, VerbManifestEntry>> = {
  list: lazy({ load: loadList, meta: talkListMeta }),
  "list-add": lazy({ load: loadListAdd, meta: talkListAddMeta }),
};
