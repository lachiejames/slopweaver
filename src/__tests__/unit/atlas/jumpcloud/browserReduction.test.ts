/**
 * The console reduction: which calls are JumpCloud's own, what an operation's key is, and that only field
 * NAMES — after the denial boundary — ever leave it.
 */
import { describe, expect, it } from "vitest";

import {
  isFirstPartyJumpcloudCall,
  jumpcloudCallKey,
  jumpcloudPathShape,
  reduceJumpcloudCalls,
} from "../../../../atlas/jumpcloud/browserReduction.js";

const USER_ID = "5f1e2d3c4b5a69788796a5b4";

describe("isFirstPartyJumpcloudCall", () => {
  it("admits the console's own host", () => {
    expect(isFirstPartyJumpcloudCall({ url: "https://console.jumpcloud.com/api/systemusers" })).toBe(true);
  });

  it("refuses a host that merely ends in the same letters", () => {
    expect(isFirstPartyJumpcloudCall({ url: "https://notjumpcloud.com/api" })).toBe(false);
  });

  it("refuses a host that carries the domain as a prefix", () => {
    expect(isFirstPartyJumpcloudCall({ url: "https://jumpcloud.com.evil.test/api" })).toBe(false);
  });

  it("refuses an address it cannot read", () => {
    expect(isFirstPartyJumpcloudCall({ url: "::::" })).toBe(false);
  });
});

describe("jumpcloudPathShape", () => {
  it("replaces a JumpCloud object id with a placeholder", () => {
    expect(jumpcloudPathShape({ url: `https://console.jumpcloud.com/api/v2/usergroups/${USER_ID}/members` })).toBe(
      "/api/v2/usergroups/{id}/members",
    );
  });

  it("replaces an email address in a path", () => {
    expect(jumpcloudPathShape({ url: "https://console.jumpcloud.com/api/users/someone@example.test" })).toBe(
      "/api/users/{email}",
    );
  });

  it("replaces a digit run", () => {
    expect(jumpcloudPathShape({ url: "https://console.jumpcloud.com/api/pages/42" })).toBe("/api/pages/{n}");
  });

  it("keeps a readable route name", () => {
    expect(jumpcloudPathShape({ url: "https://console.jumpcloud.com/api/v2/systeminsights/managed_policies" })).toBe(
      "/api/v2/systeminsights/managed_policies",
    );
  });
});

describe("reduceJumpcloudCalls", () => {
  it("drops a third party's call", () => {
    expect(
      reduceJumpcloudCalls({
        responses: [{ body: { a: 1 }, method: "GET", statusCode: 200, url: "https://telemetry.example.test/v1" }],
      }),
    ).toEqual([]);
  });

  it("keys an operation on method, host and path shape", () => {
    const [call] = reduceJumpcloudCalls({
      responses: [
        { body: {}, method: "get", statusCode: 200, url: `https://console.jumpcloud.com/api/systemusers/${USER_ID}` },
      ],
    });
    expect(jumpcloudCallKey({ call: call! })).toBe("GET console.jumpcloud.com/api/systemusers/{id}");
  });

  it("keeps field names and never a value", () => {
    const [call] = reduceJumpcloudCalls({
      responses: [
        {
          body: { email: "someone@example.test", username: "someone" },
          method: "GET",
          statusCode: 200,
          url: "https://console.jumpcloud.com/api/systemusers",
        },
      ],
    });
    expect(call!.responseFields).toEqual(["email", "username"]);
  });

  // `twoFaSecret` is in `sensitiveFields.ts`'s denial set; its NAME must not reach the census either.
  it("runs the denial boundary before the census, and counts what it removed", () => {
    const [call] = reduceJumpcloudCalls({
      responses: [
        {
          body: { twoFaSecret: "not-a-real-secret", username: "someone" },
          method: "GET",
          statusCode: 200,
          url: "https://console.jumpcloud.com/api/systemusers",
        },
      ],
    });
    expect(call!.responseFields).toEqual(["username"]);
    expect(call!.deniedFieldCount).toBe(1);
  });
});
