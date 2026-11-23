/**
 * Seeds the profile DELIVERY marker a spawned hook reads, so a subprocess test of some OTHER guard is not first
 * held by `profile-held` (`src/admit/profileHeldRunner.ts`) for a session that never had the owner's profile loaded.
 *
 * It spells the marker's contents out rather than calling `markProfileDelivered`, so a drift in what it records fails
 * the test that seeded it instead of being papered over by the same code on both sides; where it lives comes from
 * `stateHomePaths`, the one place a home path is built. The marker it writes names no transcript, which is what a
 * payload carrying no `transcript_path` is checked against (`src/context/profileDelivery.ts`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { stateHomePaths } from "../stateHome.js";

/**
 * Write the marker file `<home>/profile/delivered/<sessionId>`, recording no transcript.
 *
 * @param home the Slopweaver home the spawned hook is handed through `SLOPWEAVER_HOME`
 * @param sessionId the `session_id` the test's payload carries
 * @returns the marker path
 */
export function seedProfileDelivered({ home, sessionId }: { home: string; sessionId: string }): string {
  const dir = stateHomePaths({ home }).profileDeliveredDir;
  mkdirSync(dir, { recursive: true });
  const path = join(dir, sessionId);
  writeFileSync(path, "profile-delivered v1\n0\nsettled\n\n");
  return path;
}
