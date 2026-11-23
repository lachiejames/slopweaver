/**
 * The CrowdStrike atlas's registration: its descriptor, its store, and no verbs beyond the kit's four.
 *
 * CrowdStrike's sync and walk live under their own top-level noun (`slopweaver crowdstrike sync`, the
 * descriptor's `resyncCommand`), so this row declares no own verbs: the kit's four are the whole of
 * `atlas crowdstrike`. Declaring none is the honest row, not a gap.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The crowdstrike row of the registry. */
export const CROWDSTRIKE_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // No network call on any verb here, so no door. `read`, `coverage` and `render` are pure reads of
    // files `slopweaver crowdstrike sync` already wrote.
    doorRouted: false,
    example: "slopweaver atlas crowdstrike read --json",
    summary: null,
  },
  platform: "crowdstrike",
  readDescriptor: async () => (await import("./descriptor.js")).CROWDSTRIKE_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readCrowdstrikeSnapshot(args),
  verbs: [],
};
