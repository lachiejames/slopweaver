import { describe, expect, it } from "vitest";

import type { CrowdstrikeKindFile } from "../../../../atlas/crowdstrike/entities.js";
import { CrowdstrikeErrors } from "../../../../atlas/crowdstrike/errors.js";
import { emptyCrowdstrikeKindFile } from "../../../../atlas/crowdstrike/kindFiles.js";
import { provenCompleteRead } from "../../../../atlas/crowdstrike/merge.js";
import { CROWDSTRIKE_KINDS } from "../../../../atlas/crowdstrike/model.js";
import { CROWDSTRIKE_API_KINDS, foldFailedKind, foldSucceededKind } from "../../../../atlas/crowdstrike/sync.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-04T00:00:00.000Z";
const LATER = "2026-09-05T00:00:00.000Z";

const SOURCE = {
  artifacts: [],
  deepLink: null,
  deepLinkStatus: "unverified" as const,
  endpoint: "/policy/entities/prevention/v1",
  observedAt: AT,
  surface: "falcon-api" as const,
};

function policy({ id }: { id: string }) {
  return {
    createdAt: null,
    description: null,
    enabled: true,
    firstSeenAt: AT,
    groupIds: [],
    id,
    modifiedAt: null,
    name: id,
    platformName: null,
    providerId: id,
    settings: [],
    source: SOURCE,
    state: "observed" as const,
  };
}

function storedWith({ entities }: { entities: ReturnType<typeof policy>[] }): CrowdstrikeKindFile {
  return {
    ...emptyCrowdstrikeKindFile({ kind: "prevention-policy", updatedAt: AT }),
    entities,
    kind: "prevention-policy",
  };
}

describe("CROWDSTRIKE_API_KINDS", () => {
  it("covers every declared kind except the two the browser walk owns", () => {
    const browser = CROWDSTRIKE_KINDS.filter((kind) => !CROWDSTRIKE_API_KINDS.includes(kind as never));
    expect([...browser]).toEqual(["console-page", "console-request"]);
  });
});

describe("foldSucceededKind", () => {
  it("publishes the merged entities and a synced coverage cell quoting the proof", () => {
    const complete = unwrap(
      provenCompleteRead({ kind: "prevention-policy", observed: 1, pagesExhausted: true, reportedTotal: 1 }),
    );
    const folded = unwrap(
      foldSucceededKind({
        at: LATER,
        kind: "prevention-policy",
        read: { complete, entities: [policy({ id: "p1" })], problems: [], reason: "read 1 prevention policy(s)" },
        stored: storedWith({ entities: [] }),
      }),
    );
    expect(folded.file.entities).toHaveLength(1);
    expect(folded.file.coverage[0]!.state).toBe("synced");
    expect(folded.file.coverage[0]!.reason).toContain("to the end of paging");
    expect(folded.status.lastSuccessAt).toBe(LATER);
    expect(folded.outcome.ok).toBe(true);
  });

  it("says so in the coverage reason when the read did not finish", () => {
    const folded = unwrap(
      foldSucceededKind({
        at: LATER,
        kind: "prevention-policy",
        read: { complete: null, entities: [policy({ id: "p1" })], problems: [], reason: "read 1 prevention policy(s)" },
        stored: storedWith({ entities: [policy({ id: "p2" })] }),
      }),
    );
    expect(folded.file.coverage[0]!.reason).toContain("the read did not finish, so nothing was staled");
    expect(folded.file.entities.map((entity) => entity.state)).toEqual(["observed", "observed"]);
  });

  it("raises a schema-drift gap for records it could not project", () => {
    const complete = unwrap(
      provenCompleteRead({ kind: "prevention-policy", observed: 0, pagesExhausted: true, reportedTotal: 0 }),
    );
    const folded = unwrap(
      foldSucceededKind({
        at: LATER,
        kind: "prevention-policy",
        read: { complete, entities: [], problems: ["a prevention-policy record carried no id"], reason: "read 0" },
        stored: storedWith({ entities: [] }),
      }),
    );
    expect(folded.file.gaps.map((gap) => gap.condition)).toEqual(["schema-drift"]);
  });

  it("CLOSES the auth-failed gap a refused mint left, because a successful read is that recheck", () => {
    const error = CrowdstrikeErrors.authFailed({
      reason: "POST /oauth2/token answered a new field",
      remintAttempted: false,
    });
    const refused = unwrap(
      foldFailedKind({ at: AT, error, kind: "prevention-policy", stored: storedWith({ entities: [] }) }),
    );
    expect(refused.file.gaps.map((gap) => [gap.condition, gap.status])).toEqual([["auth-failed", "open"]]);
    const complete = unwrap(
      provenCompleteRead({ kind: "prevention-policy", observed: 0, pagesExhausted: true, reportedTotal: 0 }),
    );
    const folded = unwrap(
      foldSucceededKind({
        at: LATER,
        kind: "prevention-policy",
        read: { complete, entities: [], problems: [], reason: "read 0" },
        stored: refused.file,
      }),
    );
    expect(folded.file.gaps.map((gap) => [gap.condition, gap.status])).toEqual([["auth-failed", "closed"]]);
  });
});

describe("foldFailedKind", () => {
  it("keeps every stored entity and moves ONLY the coverage", () => {
    const stored = storedWith({ entities: [policy({ id: "p1" })] });
    const error = CrowdstrikeErrors.scopeRefused({
      callId: "prevention-policy-ids",
      path: "/policy/queries/prevention/v1",
      scope: "prevention-policies:read",
    });
    const folded = unwrap(foldFailedKind({ at: LATER, error, kind: "prevention-policy", stored }));
    expect(folded.file.entities).toHaveLength(1);
    expect(folded.file.entities[0]!.state).toBe("observed");
    expect(folded.file.coverage[0]!.state).toBe("unreadable");
    expect(folded.file.coverage[0]!.unblockedBy).toContain("prevention-policies:read");
    expect(folded.outcome.ok).toBe(false);
  });

  it("raises a gap naming the condition, and never closes one on a failed run", () => {
    const error = CrowdstrikeErrors.routeAbsent({ callId: "x", path: "/gone" });
    const folded = unwrap(
      foldFailedKind({ at: LATER, error, kind: "prevention-policy", stored: storedWith({ entities: [] }) }),
    );
    expect(folded.file.gaps.map((gap) => [gap.condition, gap.status])).toEqual([["route-absent", "open"]]);
  });

  it("records the failed attempt without erasing an earlier success", () => {
    const complete = unwrap(
      provenCompleteRead({ kind: "prevention-policy", observed: 0, pagesExhausted: true, reportedTotal: 0 }),
    );
    const succeeded = unwrap(
      foldSucceededKind({
        at: AT,
        kind: "prevention-policy",
        read: { complete, entities: [], problems: [], reason: "read 0" },
        stored: storedWith({ entities: [] }),
      }),
    );
    const error = CrowdstrikeErrors.transportExhausted({ callId: "x", reason: "HTTP 429, rate limited" });
    const folded = unwrap(foldFailedKind({ at: LATER, error, kind: "prevention-policy", stored: succeeded.file }));
    expect(folded.file.coverage[0]!.lastSuccessAt).toBe(AT);
    expect(folded.file.coverage[0]!.latestAttemptFailed).toBe(true);
    expect(folded.status.lastSuccessAt).toBe(AT);
  });
});
