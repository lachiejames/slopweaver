import { describe, expect, it } from "vitest";
import {
  checkSlackConnection,
  classifySlack,
  classifyWriteToken,
  SLACK_REQUIRED_USER_SCOPES,
  type SlackConnectProbes,
  type SlackProbe,
  writeScopeCapabilities,
} from "../../../connect/slack.js";
import type { ConnectCapability } from "../../../connect/types.js";
import type { IngestError } from "../../../lib/ingestError.js";
import { err, ok, type Result } from "../../../lib/result.js";

/** Look up one capability by id (non-null asserted — the test knows it exists). */
function cap({ caps, id }: { caps: readonly ConnectCapability[]; id: string }): ConnectCapability {
  return caps.find((c) => c.id === id)!;
}

const errProbe = <T>(): Promise<Result<T, IngestError>> =>
  Promise.resolve(err({ kind: "http", message: "boom", operation: "t" }));

describe("classifySlack", () => {
  const base: SlackProbe = {
    authReachable: true,
    channelsSampled: 4,
    emailVisible: true,
    humanMembersSampled: 5,
    membersSampled: 6,
    tokenKind: "user",
    write: { bot: { grantedScopes: ["chat:write", "files:write"], kind: "reachable" }, user: { kind: "absent" } },
  };

  it("a full user token with the email scope + visible data is ready", () => {
    const report = classifySlack({ probe: base });
    expect(report.ok).toBe(true);
    expect(cap({ caps: report.capabilities, id: "scope:users:read.email" }).status).toBe("ok");
    expect(cap({ caps: report.capabilities, id: "token-breadth" }).status).toBe("ok");
  });

  it("flags a missing users:read.email scope when sampled humans expose no email", () => {
    const report = classifySlack({ probe: { ...base, emailVisible: false } });
    expect(report.ok).toBe(false);
    expect(cap({ caps: report.capabilities, id: "scope:users:read.email" }).status).toBe("missing");
  });

  it("only WARNS on the email scope when the sample had no human members (all bots)", () => {
    const report = classifySlack({ probe: { ...base, emailVisible: false, humanMembersSampled: 0 } });
    expect(cap({ caps: report.capabilities, id: "scope:users:read.email" }).status).toBe("warning");
  });

  it("warns (does not fail) on a bot token's reduced breadth", () => {
    const report = classifySlack({ probe: { ...base, tokenKind: "bot" } });
    expect(report.ok).toBe(true);
    expect(cap({ caps: report.capabilities, id: "token-breadth" }).status).toBe("warning");
  });

  it("reports a no-data-visible failure when auth is ok but nothing is readable", () => {
    const report = classifySlack({
      probe: { ...base, channelsSampled: 0, emailVisible: false, humanMembersSampled: 0, membersSampled: 0 },
    });
    expect(report.ok).toBe(false);
    expect(cap({ caps: report.capabilities, id: "read-probe" }).status).toBe("missing");
    expect(cap({ caps: report.capabilities, id: "scope:users:read.email" }).status).toBe("warning");
  });

  it("short-circuits to a single auth failure when auth is unreachable", () => {
    const report = classifySlack({ probe: { ...base, authReachable: false } });
    expect(report.ok).toBe(false);
    expect(report.capabilities.map((c) => c.id)).toEqual(["auth"]);
    expect(report.errors).toEqual(["slack: auth.test did not reach the workspace"]);
  });

  it("reports both outbound write scopes as ok when the BOT token carries them", () => {
    const report = classifySlack({ probe: base });
    expect(cap({ caps: report.capabilities, id: "auth:write" }).status).toBe("ok");
    expect(cap({ caps: report.capabilities, id: "scope:chat:write" }).status).toBe("ok");
    expect(cap({ caps: report.capabilities, id: "scope:files:write" }).status).toBe("ok");
  });

  it("only WARNS on a read-only bot token's missing write scopes — read-only is a valid posture", () => {
    const report = classifySlack({
      probe: {
        ...base,
        write: { bot: { grantedScopes: ["channels:history"], kind: "reachable" }, user: { kind: "absent" } },
      },
    });
    expect(report.ok).toBe(true);
    expect(cap({ caps: report.capabilities, id: "scope:chat:write" }).status).toBe("warning");
    expect(cap({ caps: report.capabilities, id: "scope:chat:write" }).detail).toContain(
      "cannot send until it is added",
    );
  });

  it("reports write scopes as UNVERIFIED (one warning) when Slack sent no scope header", () => {
    const report = classifySlack({
      probe: { ...base, write: { bot: { grantedScopes: [], kind: "reachable" }, user: { kind: "absent" } } },
    });
    expect(report.ok).toBe(true);
    expect(cap({ caps: report.capabilities, id: "scopes:write" }).status).toBe("warning");
    expect(report.capabilities.filter((c) => c.id.startsWith("scope:chat"))).toEqual([]);
  });

  it("does NOT claim a write verdict from the READ token's scopes — the defect this split fixes", () => {
    // The read token here carries every write scope. The bot token that would actually post is absent, so
    // the report must say sends are impossible rather than inheriting the xoxp's permissions.
    const report = classifySlack({ probe: { ...base, write: { bot: { kind: "absent" }, user: { kind: "absent" } } } });

    expect(report.capabilities.filter((c) => c.id.startsWith("scope:chat"))).toEqual([]);
    expect(cap({ caps: report.capabilities, id: "scopes:write" }).detail).toContain("no bot token configured");
  });

  it("FAILS the preflight when the bot token cannot authenticate, even though the read token can", () => {
    const report = classifySlack({
      probe: { ...base, write: { bot: { kind: "unreachable" }, user: { kind: "absent" } } },
    });

    expect(report.ok).toBe(false);
    expect(cap({ caps: report.capabilities, id: "auth:write" }).status).toBe("missing");
    expect(cap({ caps: report.capabilities, id: "auth:write" }).detail).toContain("they are different tokens");
  });

  it("FAILS the preflight when the configured bot token is not an xoxb", () => {
    const report = classifySlack({
      probe: { ...base, write: { bot: { kind: "wrong-kind" }, user: { kind: "absent" } } },
    });

    expect(report.ok).toBe(false);
    expect(cap({ caps: report.capabilities, id: "auth:write" }).status).toBe("missing");
  });

  it("stays green with no bot token at all — a read-only install must not fail its own preflight", () => {
    const report = classifySlack({ probe: { ...base, write: { bot: { kind: "absent" }, user: { kind: "absent" } } } });

    expect(report.ok).toBe(true);
    expect(cap({ caps: report.capabilities, id: "scopes:write" }).status).toBe("warning");
  });
});

describe("writeScopeCapabilities", () => {
  it("names the secrets command when no bot token is configured", () => {
    const caps = writeScopeCapabilities({ lane: "bot", probe: { kind: "absent" } });

    expect(caps.length).toBe(1);
    expect(caps[0]!.detail).toContain("slopweaver secrets set slack-bot-token");
  });

  it("reports the reachable bot token first, then one capability per scope", () => {
    const caps = writeScopeCapabilities({ lane: "bot", probe: { grantedScopes: ["chat:write"], kind: "reachable" } });

    expect(caps.map((c) => c.id)).toEqual(["auth:write", "scope:chat:write", "scope:files:write"]);
    expect(caps[3]).toBe(undefined);
  });
});

describe("the AS-ME write lane", () => {
  const base: SlackProbe = {
    authReachable: true,
    channelsSampled: 4,
    emailVisible: true,
    humanMembersSampled: 5,
    membersSampled: 6,
    tokenKind: "user",
    write: { bot: { grantedScopes: ["chat:write", "files:write"], kind: "reachable" }, user: { kind: "absent" } },
  };

  it("reports the two lanes SEPARATELY — a perfect bot token says nothing about posting as me", () => {
    const report = classifySlack({ probe: base });

    expect(cap({ caps: report.capabilities, id: "scope:chat:write" }).status).toBe("ok");
    expect(cap({ caps: report.capabilities, id: "scopes:write-as-me" }).status).toBe("warning");
    expect(cap({ caps: report.capabilities, id: "scopes:write-as-me" }).detail).toContain("slack-user-token");
  });

  it("warns — never fails — when the user token can post the owner's words but cannot attach a file to them", () => {
    const report = classifySlack({
      probe: { ...base, write: { ...base.write, user: { grantedScopes: ["chat:write"], kind: "reachable" } } },
    });

    expect(report.ok).toBe(true);
    expect(cap({ caps: report.capabilities, id: "scope:as-me:chat:write" }).status).toBe("ok");
    expect(cap({ caps: report.capabilities, id: "scope:as-me:files:write" }).status).toBe("warning");
  });

  it("names WHAT each missing scope costs, so a text-only install is not told its sends will be rejected", () => {
    const report = classifySlack({
      probe: { ...base, write: { ...base.write, user: { grantedScopes: ["chat:write"], kind: "reachable" } } },
    });

    expect(cap({ caps: report.capabilities, id: "scope:as-me:files:write" }).detail).toBe(
      "files:write is NOT granted on the USER token — `slopweaver slack post --as me` cannot attach files " +
        "with --media until it is added",
    );
  });

  it("reports both as-me write scopes OK on a token that holds them", () => {
    const report = classifySlack({
      probe: {
        ...base,
        write: { ...base.write, user: { grantedScopes: ["chat:write", "files:write"], kind: "reachable" } },
      },
    });

    expect(report.ok).toBe(true);
    expect(cap({ caps: report.capabilities, id: "scope:as-me:files:write" }).detail).toBe(
      "files:write is granted on the USER token — `slopweaver slack post --as me` can attach files with --media",
    );
  });

  it("WARNS when the user token lacks chat:write, naming the send it will reject", () => {
    const report = classifySlack({
      probe: { ...base, write: { ...base.write, user: { grantedScopes: ["users:read"], kind: "reachable" } } },
    });

    expect(cap({ caps: report.capabilities, id: "scope:as-me:chat:write" }).status).toBe("warning");
    expect(cap({ caps: report.capabilities, id: "scope:as-me:chat:write" }).detail).toContain("--as me");
  });

  it("FAILS the preflight when the configured user token is not an xoxp", () => {
    const report = classifySlack({ probe: { ...base, write: { ...base.write, user: { kind: "wrong-kind" } } } });

    expect(report.ok).toBe(false);
    expect(cap({ caps: report.capabilities, id: "auth:write-as-me" }).status).toBe("missing");
    expect(cap({ caps: report.capabilities, id: "auth:write-as-me" }).detail).toContain("cannot post under your name");
  });

  it("FAILS the preflight when the user token cannot authenticate", () => {
    const report = classifySlack({ probe: { ...base, write: { ...base.write, user: { kind: "unreachable" } } } });

    expect(report.ok).toBe(false);
    expect(cap({ caps: report.capabilities, id: "auth:write-as-me" }).status).toBe("missing");
  });

  it("gives the user lane its own ids so both lanes fit in one report without colliding", () => {
    const caps = writeScopeCapabilities({ lane: "user", probe: { grantedScopes: ["chat:write"], kind: "reachable" } });

    expect(caps.map((c) => c.id)).toEqual(["auth:write-as-me", "scope:as-me:chat:write", "scope:as-me:files:write"]);
  });

  it("classifies a user-lane token by the xoxp prefix", () => {
    expect(classifyWriteToken({ lane: "user", token: "xoxp-user" })).toBe("ok");
    expect(classifyWriteToken({ lane: "user", token: "xoxb-bot" })).toBe("wrong-kind");
    expect(classifyWriteToken({ lane: "user", token: undefined })).toBe("absent");
  });
});

describe("classifyWriteToken", () => {
  it("classifies an absent, blank, wrong-kind and bot token", () => {
    expect(classifyWriteToken({ lane: "bot", token: undefined })).toBe("absent");
    expect(classifyWriteToken({ lane: "bot", token: "" })).toBe("absent");
    expect(classifyWriteToken({ lane: "bot", token: "xoxp-user" })).toBe("wrong-kind");
    expect(classifyWriteToken({ lane: "bot", token: "xoxb-bot" })).toBe("ok");
  });
});

describe("checkSlackConnection", () => {
  const healthyRead: SlackConnectProbes = {
    auth: async () => ok({ reachable: true, scopes: ["users:read"] }),
    channels: async () => ok({ sampled: 2 }),
    users: async () => ok({ anyHumanEmail: true, humans: 3, sampled: 3 }),
  };

  it("maps a healthy probe bag to a ready report", async () => {
    const report = await checkSlackConnection({
      probes: healthyRead,
      tokenKind: "user",
      userWrite: { kind: "absent" },
      write: {
        auth: async () => ok({ reachable: true, scopes: ["chat:write", "files:write"] }),
        kind: "probe",
      },
    });
    expect(report.ok).toBe(true);
    expect(cap({ caps: report.capabilities, id: "scope:chat:write" }).status).toBe("ok");
  });

  it("treats a failed auth probe as unreachable", async () => {
    const probes: SlackConnectProbes = {
      auth: () => errProbe(),
      channels: async () => ok({ sampled: 2 }),
      users: async () => ok({ anyHumanEmail: true, humans: 3, sampled: 3 }),
    };
    const report = await checkSlackConnection({
      probes,
      tokenKind: "user",
      userWrite: { kind: "absent" },
      write: { kind: "absent" },
    });
    expect(report.ok).toBe(false);
    expect(report.capabilities.map((c) => c.id)).toEqual(["auth"]);
  });

  it("degrades a THROWN write auth.test to unreachable rather than a crash", async () => {
    const report = await checkSlackConnection({
      probes: healthyRead,
      tokenKind: "user",
      userWrite: { kind: "absent" },
      write: { auth: () => errProbe(), kind: "probe" },
    });

    expect(report.ok).toBe(false);
    expect(cap({ caps: report.capabilities, id: "auth:write" }).status).toBe("missing");
  });

  it("degrades a write auth.test that answers `not reachable` to unreachable", async () => {
    const report = await checkSlackConnection({
      probes: healthyRead,
      tokenKind: "user",
      userWrite: { kind: "absent" },
      write: { auth: async () => ok({ reachable: false, scopes: [] }), kind: "probe" },
    });

    expect(cap({ caps: report.capabilities, id: "auth:write" }).status).toBe("missing");
  });
});

describe("SLACK_REQUIRED_USER_SCOPES", () => {
  it("carries the email scope member hydration needs", () => {
    expect(SLACK_REQUIRED_USER_SCOPES).toContain("users:read.email");
  });
});
