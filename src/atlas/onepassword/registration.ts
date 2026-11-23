/**
 * The 1Password atlas's registration: its descriptor, its store, and no verbs beyond the kit's four.
 *
 * 1Password's sync lives under its own top-level noun (`slopweaver onepassword sync`, the descriptor's
 * `resyncCommand`), so this row declares no own verbs: the kit's four are the whole of `atlas onepassword`.
 *
 * This is the atlas that once shipped complete — descriptor, store, model, coverage, sync — publishing
 * a full generation of entities with no registry row at all, unreachable through `read` while every test passed.
 * `unit/atlas/registryCoversEveryAtlas.test.ts` is why that cannot recur, and this row is what it found
 * missing.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The onepassword row of the registry. */
export const ONEPASSWORD_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // No network call on any verb here, so no door. `read`, `coverage` and `render` are pure reads of
    // files `slopweaver onepassword sync` already wrote.
    doorRouted: false,
    example: "slopweaver atlas onepassword read --json",
    summary: null,
  },
  platform: "onepassword",
  readDescriptor: async () => (await import("./descriptor.js")).ONEPASSWORD_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readOnepasswordSnapshot(args),
  verbs: [],
};
