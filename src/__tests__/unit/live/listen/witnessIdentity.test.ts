/**
 * Resolving `slackBot.witnessBotHandles` against the member directory: exactly one current bot per handle,
 * and every other shape a named refusal.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { writeMemberRows } from "../../../../corpus/members/store.js";
import type { MemberBronzeRow } from "../../../../corpus/members/types.js";
import { loadResolvedWitnessBots, resolveWitnessBots } from "../../../../live/listen/witnessIdentity.js";
import { NO_PROTECTION } from "../../../noProtection.js";

/** One Slack member row with just the fields resolution reads. */
function row({
  active,
  bot,
  handle,
  userId,
}: {
  active?: boolean;
  bot: boolean;
  handle: string;
  userId: string;
}): MemberBronzeRow {
  return {
    fetchedAtIso: "2026-10-05T00:00:00.000Z",
    identity: { emailTrust: "missing", handle, nativeId: userId, source: "slack" },
    profile: { bot, ...(active === undefined ? {} : { active }) },
    provenance: [],
    raw: {},
    source: "slack",
    sourceId: userId,
    version: 1,
    warnings: [],
  };
}

const PEER = row({ bot: true, handle: "peerbot", userId: "U0PEER" });

describe("resolveWitnessBots", () => {
  it("resolves a handle to the one current bot carrying it", () => {
    const resolved = resolveWitnessBots({ handles: ["peerbot"], rows: [PEER] });

    expect(unwrap(resolved)).toEqual([{ handle: "peerbot", userId: "U0PEER" }]);
  });

  it("tolerates a leading @ in the configured handle", () => {
    expect(unwrap(resolveWitnessBots({ handles: ["@peerbot"], rows: [PEER] }))).toEqual([
      { handle: "peerbot", userId: "U0PEER" },
    ]);
  });

  it("reads the LAST row per member, so a renamed bot no longer answers its old handle", () => {
    const renamed = row({ bot: true, handle: "peerbot-v2", userId: "U0PEER" });
    const error = unwrapErr(resolveWitnessBots({ handles: ["peerbot"], rows: [PEER, renamed] }));

    expect(error.code).toBe("WITNESS_BOT_NOT_FOUND");
  });

  it("refuses a handle carried only by a deactivated member", () => {
    const gone = row({ active: false, bot: true, handle: "peerbot", userId: "U0PEER" });

    expect(unwrapErr(resolveWitnessBots({ handles: ["peerbot"], rows: [gone] })).code).toBe("WITNESS_BOT_NOT_FOUND");
  });

  it("refuses a handle two current members carry, naming both", () => {
    const twin = row({ bot: true, handle: "peerbot", userId: "U0TWIN" });
    const error = unwrapErr(resolveWitnessBots({ handles: ["peerbot"], rows: [PEER, twin] }));

    expect(error.code).toBe("WITNESS_BOT_AMBIGUOUS");
    expect(error.message).toContain("U0PEER, U0TWIN");
  });

  it("refuses a handle that names a person", () => {
    const person = row({ bot: false, handle: "peerbot", userId: "U0PERSON" });
    const error = unwrapErr(resolveWitnessBots({ handles: ["peerbot"], rows: [person] }));

    expect(error.code).toBe("WITNESS_BOT_NOT_A_BOT");
    expect(error.message).toContain("U0PERSON");
  });
});

describe("loadResolvedWitnessBots", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  /** A throwaway home, removed after the test. */
  function freshHome(): string {
    const home = mkdtempSync(join(tmpdir(), "witness-id-"));
    homes.push(home);
    return home;
  }

  it("reads nothing and resolves nothing when no handle is configured", () => {
    expect(unwrap(loadResolvedWitnessBots({ handles: [], home: freshHome() }))).toEqual([]);
  });

  it("resolves through the stored member directory", () => {
    const home = freshHome();
    unwrap(writeMemberRows({ home, protection: NO_PROTECTION, rows: [PEER], source: "slack" }));

    expect(unwrap(loadResolvedWitnessBots({ handles: ["peerbot"], home }))).toEqual([
      { handle: "peerbot", userId: "U0PEER" },
    ]);
  });

  it("refuses when there is no member directory at all", () => {
    const error = unwrapErr(loadResolvedWitnessBots({ handles: ["peerbot"], home: freshHome() }));

    expect(error.code).toBe("WITNESS_BOT_NOT_FOUND");
  });
});
