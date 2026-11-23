/**
 * The `talk` noun's reads of the calls as they were written down, spread into `./talk.ts` — `calls`, the recent calls
 * with what was said, relayed and how each ended, and `call-tools`, one call's tool lines with what the model was
 * handed, secrets masked, a bounded page at a time (`src/talk/callTools.ts`). `calls` never carries those answers, so an ordinary
 * status read stays small. `call-thread` reads the call's Codex thread journal, which the console server writes
 * through `call-thread-append` (`src/talk/callThreadStore.ts`) — an audit read, never context for anything else.
 * Their own module, like `./talkList.ts`, so the noun's manifest stays under the ratchet.
 */
import { TALK_CALL_THREAD_APPEND_USAGE, TALK_CALL_THREAD_USAGE } from "../commands/talk/callThreadUsage.js";
import { TALK_CALL_TOOLS_USAGE } from "../commands/talk/callToolsUsage.js";
import { TALK_CALLS_USAGE } from "../commands/talk/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const talkCallsMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk calls --json",
  parseRejectIsIoFree: true,
  summary:
    "The recent console-voice calls as written down while they ran, newest first — what was said, relayed, how each ended or that it dropped, and each attempt to reconnect a dropped one",
  usage: TALK_CALLS_USAGE,
} as const;

const talkCallToolsMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk call-tools --call <call-id> --json",
  parseRejectIsIoFree: true,
  summary:
    "One console-voice call's tool lines, each with what the model was handed, secrets masked, a page at a time — what traces a wrong spoken answer to what it read",
  usage: TALK_CALL_TOOLS_USAGE,
} as const;

const talkCallThreadMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk call-thread --call <call-id> --limit 5",
  parseRejectIsIoFree: true,
  summary:
    "One console call's Codex thread journal, an audit read a page at a time — what the thread was told, each turn and completed item, every tool answer it was handed",
  usage: TALK_CALL_THREAD_USAGE,
} as const;

const talkCallThreadAppendMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver talk call-thread-append --call <uuid> --entries-file ./batch.jsonl --json",
  parseRejectIsIoFree: true,
  summary:
    "The console server's writer of a call's Codex thread journal under the home — secrets masked, inline binary kept as a digest, each entry written once",
  usage: TALK_CALL_THREAD_APPEND_USAGE,
} as const;

const loadCalls = () => import("../commands/talk/callsRun.js").then((m) => m.talkCallsCommand);
const loadCallTools = () => import("../commands/talk/callToolsRun.js").then((m) => m.talkCallToolsCommand);
const loadCallThread = () => import("../commands/talk/callThreadRun.js").then((m) => m.talkCallThreadCommand);
const loadCallThreadAppend = () =>
  import("../commands/talk/callThreadAppendRun.js").then((m) => m.talkCallThreadAppendCommand);

/** `talk calls`, `talk call-tools`, `talk call-thread` and its writer, spread into the noun's manifest. */
export const talkCallsManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "call-thread": lazy({ load: loadCallThread, meta: talkCallThreadMeta }),
  "call-thread-append": lazy({ load: loadCallThreadAppend, meta: talkCallThreadAppendMeta }),
  "call-tools": lazy({ load: loadCallTools, meta: talkCallToolsMeta }),
  calls: lazy({ load: loadCalls, meta: talkCallsMeta }),
};
