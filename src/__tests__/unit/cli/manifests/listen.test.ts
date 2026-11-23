/**
 * The `listen` noun's manifest rows in `cli/manifests/listen.ts` quote their usage from a leaf module rather than from
 * the command module they describe, so enumerating the surface never loads a command. That the manifest imports nothing
 * heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant the
 * command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import {
  LISTEN_ARM_USAGE,
  LISTEN_DISARM_USAGE,
  LISTEN_RECONCILE_USAGE,
  LISTEN_RECOVER_USAGE,
  LISTEN_STATUS_USAGE,
  LISTEN_SUPERVISE_USAGE,
  LISTEN_USAGE,
} from "../../../../cli/commands/listen/listenUsage.js";
import { listenManifest } from "../../../../cli/manifests/listen.js";

describe("listenManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(listenManifest["arm"]!.meta.usage).toBe(LISTEN_ARM_USAGE);
    expect(listenManifest["disarm"]!.meta.usage).toBe(LISTEN_DISARM_USAGE);
    expect(listenManifest["recover"]!.meta.usage).toBe(LISTEN_RECOVER_USAGE);
    expect(listenManifest["reconcile"]!.meta.usage).toBe(LISTEN_RECONCILE_USAGE);
    expect(listenManifest["run"]!.meta.usage).toBe(LISTEN_USAGE);
    expect(listenManifest["status"]!.meta.usage).toBe(LISTEN_STATUS_USAGE);
    expect(listenManifest["supervise"]!.meta.usage).toBe(LISTEN_SUPERVISE_USAGE);
  });
});
