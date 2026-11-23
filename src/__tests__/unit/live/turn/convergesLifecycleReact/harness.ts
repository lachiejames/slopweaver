/*
 * ONE class of defect, three measured instances: a lifecycle transition that ADDS its reaction and removes
 * only the one prior state its own code happened to know about, leaving a tagged message wearing two
 * reactions that contradict each other.
 *
 * These test files are regression tests for the exact live cases in `live/turn/lifecycleReactions.ts`'s header, kept
 * together because the fix is one rule rather than three patches: settling a lifecycle reaction converges the message
 * to EXACTLY ONE of them. Each case drives the real seam over a fake Slack message whose reactions are a real set — so
 * "both reactions are standing" is a state the assertions can actually see, which a call log alone could not prove.
 *
 * What they share: the turn chrome and provenance a live seam takes, the emoji defaults, and the throwaway homes
 * `useTempHomes()` removes after each case.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

import type { TurnProvenance } from "../../../../../live/turn/run.js";
import type { TurnChrome } from "../../../../../outbound/slack/types.js";

/** The chrome a live seam renders its turn card with. */
export const CHROME: TurnChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#8B5CF6",
  detailLabel: "*Details*",
  metadataEventType: "test_turn_v1",
};

/** The provenance a live seam stamps on its turn. */
export const PROVENANCE: TurnProvenance = { modelId: "claude -p" };

/** The profile-less defaults every emoji resolver falls back to, so a temp home needs no `profile.json`. */
export const CAPTURE: string = "eyes";
export const COMPLETION: string = "white_check_mark";
export const STOPPED: string = "warning";
export const ACKNOWLEDGED: string = "ack";

// Every fixture directory minted and not yet removed, so the registered `afterEach` can remove them.
const fixtureDirs: string[] = [];

/** Register the `afterEach` that removes every home {@link tempHome} minted. Call it once per test file that mints one. */
export function useTempHomes(): void {
  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

/**
 * A throwaway state home for one case.
 *
 * @returns the new directory's path, recorded for the registered cleanup
 */
export function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-converge-react-"));
  fixtureDirs.push(home);
  return home;
}
