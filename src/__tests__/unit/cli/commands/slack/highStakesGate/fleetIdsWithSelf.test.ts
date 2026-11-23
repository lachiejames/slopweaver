/*
 * `fleetIdsWithSelf`: the token's own user joins the fleet's ids once, and nobody joins when Slack named nobody.
 */
import { describe, expect, it } from "vitest";

import { fleetIdsWithSelf } from "../../../../../../cli/commands/slack/highStakesRead.js";

describe("fleetIdsWithSelf", () => {
  it("adds the token's own user once, and nobody when Slack named nobody", () => {
    expect(fleetIdsWithSelf({ fleetUserIds: ["U0OWNER", "U0BOT"], selfUserId: "U0BOT" })).toEqual(["U0OWNER", "U0BOT"]);
    expect(fleetIdsWithSelf({ fleetUserIds: ["U0OWNER"], selfUserId: "U0BOT" })).toEqual(["U0OWNER", "U0BOT"]);
    expect(fleetIdsWithSelf({ fleetUserIds: ["U0OWNER"], selfUserId: undefined })).toEqual(["U0OWNER"]);
  });
});
