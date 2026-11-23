/**
 * The Automations headline's "paused by you" holds only the owner's own pauses; an owner hold no word of theirs
 * names is split out.
 */
import { describe, expect, it } from "vitest";

import { pausedBy } from "../../lib/pausedBy";

const row = ({ id, state, by }: { id: string; state: string; by: string }) => ({
  account: { fix: { by }, state },
  id,
});

describe("pausedBy", () => {
  it("puts only a pause whose fix is the owner's under the owner, and a fleet-fixed hold apart", () => {
    const split = pausedBy({
      automations: [
        row({ by: "you", id: "atlas-freshness", state: "paused" }),
        row({ by: "fleet", id: "vulnfix-topup-acme-admin", state: "paused" }),
        row({ by: "fleet", id: "resync-corpus-notion", state: "broken" }),
        { account: undefined, id: "healthy" },
      ],
    });

    expect(split.byOwner.map((one) => one.id)).toEqual(["atlas-freshness"]);
    expect(split.unowned.map((one) => one.id)).toEqual(["vulnfix-topup-acme-admin"]);
  });

  it("reads an empty page as nothing paused either way", () => {
    expect(pausedBy({ automations: [] })).toEqual({ byOwner: [], unowned: [] });
  });
});
