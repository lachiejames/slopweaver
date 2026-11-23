/**
 * The Cloudflare atlas's registration: its descriptor, its store, and no verbs beyond the kit's four.
 *
 * Cloudflare's sync and walk predate the atlas noun and live under their own top-level noun
 * (`slopweaver cloudflare sync`, the descriptor's `resyncCommand`), so this row declares no own verbs: the
 * kit's `read`, `coverage`, `render` and `restore` are the whole of `atlas cloudflare`. Declaring none is
 * the honest row, not a gap — a verb listed here that dispatched to the other noun would be a second
 * spelling of one command.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The cloudflare row of the registry. */
export const CLOUDFLARE_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // No network call on any verb here, so no door. `read`, `coverage` and `render` are pure reads of
    // files `slopweaver cloudflare sync` already wrote.
    doorRouted: false,
    example: "slopweaver atlas cloudflare read --json",
    summary: null,
  },
  platform: "cloudflare",
  readDescriptor: async () => (await import("./descriptor.js")).CLOUDFLARE_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readCloudflareSnapshot(args),
  verbs: [],
};
