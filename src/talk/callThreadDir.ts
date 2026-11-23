/**
 * Where the call-thread journals live — a leaf, so the call-state guard (`../admit/callStateGuard.ts`, run on every
 * hand-run `Bash` command) names the directory without loading the journal's sanitiser and zod schemas.
 */
import { dirname, join } from "node:path";

import { stateHomePaths } from "../stateHome.js";

/**
 * `$home/talk/threads` (`0700`), beside `talk/calls` and derived the same way from the state-home contract's own
 * `talk/` directory (`./callStore.ts`'s `callsDir`).
 *
 * @returns the directory
 */
export function threadsDir({ home }: { home: string }): string {
  return join(dirname(stateHomePaths({ home }).talkTurns), "threads");
}
