/**
 * `reviewRosterOver` — the review verbs' one read of both rosters: the store's identity roster confirmed over a
 * home with no derived roster at all, and the store's own refusal carried out rather than read as an empty roster.
 * Every record here is synthetic.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { reviewRosterOver } from "../../../review/storeReviewRoster.js";
import type { IdentityRecord } from "../../../silver/identity.js";
import { memoryIdentityRosterPort, unavailableIdentityRosterPort } from "../../identityRosterFixture.js";

const ADA: IdentityRecord = {
  handle: "ada",
  id: "ada",
  identities: [
    { nativeId: "Ada-Acme", source: "github" },
    { nativeId: "U0FIXTUREADA", source: "slack" },
  ],
  name: "Ada Acme",
};

describe("reviewRosterOver", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slopweaver-store-review-roster-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("joins a stored person's login to their Slack id when derive has never run", async () => {
    const roster = unwrap(
      await reviewRosterOver({ home, identityRoster: memoryIdentityRosterPort({ records: [ADA] }) }),
    );
    expect(roster.slackIdForLogin.get("ada-acme")).toBe("U0FIXTUREADA");
    expect(roster.nameForSlackId.get("U0FIXTUREADA")).toBe("Ada Acme");
    expect(roster.samePersonForSlackId.get("U0FIXTUREADA")).toEqual(["U0FIXTUREADA"]);
  });

  it("answers an empty join over an empty store", async () => {
    const roster = unwrap(await reviewRosterOver({ home, identityRoster: memoryIdentityRosterPort() }));
    expect(roster.slackIdForLogin.size).toBe(0);
    expect(roster.nameForSlackId.size).toBe(0);
  });

  it("carries the store's refusal out instead of an empty roster", async () => {
    const refusal = unwrapErr(await reviewRosterOver({ home, identityRoster: unavailableIdentityRosterPort() }));
    expect(refusal.code).toBe("IDENTITY_ROSTER_STORE_UNAVAILABLE");
  });
});
