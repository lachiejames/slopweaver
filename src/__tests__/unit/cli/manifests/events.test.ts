/**
 * The `events` noun's manifest rows in `cli/manifests/events.ts` quote their usage from a leaf module rather than from
 * the command module they describe, so enumerating the surface never loads a command. That the manifest imports nothing
 * heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant the
 * command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import { EVENTS_TAIL_USAGE } from "../../../../cli/commands/events/tailUsage.js";
import { eventsManifest } from "../../../../cli/manifests/events.js";

describe("eventsManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(eventsManifest["tail"]!.meta.usage).toBe(EVENTS_TAIL_USAGE);
  });
});
