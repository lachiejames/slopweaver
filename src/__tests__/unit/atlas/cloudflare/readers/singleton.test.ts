import { describe, expect, it } from "vitest";

import type { CloudflareEntity } from "../../../../../atlas/cloudflare/model.js";
import { singletonEntities } from "../../../../../atlas/cloudflare/readers/singleton.js";

const AT = "2026-01-01T00:00:00.000Z";

const PROJECTED: CloudflareEntity = {
  detail: { kind: "account-setting" },
  firstSeenAt: AT,
  id: "0123456789abcdef0123456789abcdef",
  kind: "account-setting",
  lastSeenAt: AT,
  providerId: "singleton-1",
  scope: { accountId: "a".repeat(32), parentId: null, zoneId: null },
  source: { channel: "rest-api", observedAt: AT, operation: "fake-get" },
  state: "observed",
};

/** A counting fake projector: records every call's argument and returns the one fixed entity. */
function recordingProjector(): {
  calls: { value: string }[];
  project: (args: { value: string }) => CloudflareEntity;
} {
  const calls: { value: string }[] = [];
  return {
    calls,
    project: ({ value }) => {
      calls.push({ value });
      return PROJECTED;
    },
  };
}

describe("singletonEntities", () => {
  it("returns exactly the projected entity for a present value, projecting once with { value }", () => {
    const { calls, project } = recordingProjector();
    const result = singletonEntities({ project, value: "configured" });
    expect(result).toEqual([PROJECTED]);
    expect(calls).toEqual([{ value: "configured" }]);
  });

  it("returns no entity and never projects for null", () => {
    const { calls, project } = recordingProjector();
    const result = singletonEntities<string>({ project, value: null });
    expect(result).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("returns no entity and never projects for undefined", () => {
    const { calls, project } = recordingProjector();
    const result = singletonEntities<string>({ project, value: undefined });
    expect(result).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("treats a falsy-but-present value as present", () => {
    const calls: { value: number }[] = [];
    const result = singletonEntities({
      project: ({ value }: { value: number }) => {
        calls.push({ value });
        return PROJECTED;
      },
      value: 0,
    });
    expect(result).toEqual([PROJECTED]);
    expect(calls).toEqual([{ value: 0 }]);
  });
});
