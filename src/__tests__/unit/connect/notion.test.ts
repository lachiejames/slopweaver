import { describe, expect, it } from "vitest";
import {
  checkNotionConnection,
  classifyNotion,
  type NotionConnectProbes,
  type NotionProbe,
} from "../../../connect/notion.js";
import type { ConnectCapability } from "../../../connect/types.js";
import { ok } from "../../../lib/result.js";

function cap({ caps, id }: { caps: readonly ConnectCapability[]; id: string }): ConnectCapability {
  return caps.find((c) => c.id === id)!;
}

describe("classifyNotion", () => {
  const base: NotionProbe = {
    anyPerson: true,
    authReachable: true,
    emailVisible: true,
    pagesSampled: 3,
    usersSampled: 5,
  };

  it("a token with the read-user-email capability + shared pages is ready", () => {
    const report = classifyNotion({ probe: base });
    expect(report.ok).toBe(true);
    expect(cap({ caps: report.capabilities, id: "capability:read-user-email" }).status).toBe("ok");
  });

  it("flags a missing read-user-email capability when a person user has no email", () => {
    const report = classifyNotion({ probe: { ...base, emailVisible: false } });
    expect(report.ok).toBe(false);
    expect(cap({ caps: report.capabilities, id: "capability:read-user-email" }).status).toBe("missing");
  });

  it("distinguishes no-pages-visible from bad auth", () => {
    const report = classifyNotion({ probe: { ...base, pagesSampled: 0 } });
    expect(report.ok).toBe(false);
    expect(cap({ caps: report.capabilities, id: "read-probe" }).status).toBe("missing");
    expect(cap({ caps: report.capabilities, id: "auth" }).status).toBe("ok");
  });

  it("short-circuits when users.list is unreachable", () => {
    const report = classifyNotion({ probe: { ...base, authReachable: false } });
    expect(report.ok).toBe(false);
    expect(report.capabilities.map((c) => c.id)).toEqual(["auth"]);
  });
});

describe("checkNotionConnection", () => {
  it("maps a healthy probe bag to a ready report", async () => {
    const probes: NotionConnectProbes = {
      pages: async () => ok({ sampled: 1 }),
      users: async () => ok({ anyEmail: true, anyPerson: true, sampled: 4 }),
    };
    const report = await checkNotionConnection({ probes });
    expect(report.ok).toBe(true);
  });
});
