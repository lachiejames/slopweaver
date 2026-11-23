import { describe, expect, it } from "vitest";

import type { CrowdstrikeHost } from "../../../../atlas/crowdstrike/entities.js";
import { mergeCrowdstrikeKind, provenCompleteRead } from "../../../../atlas/crowdstrike/merge.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-04T00:00:00.000Z";
const LATER = "2026-09-05T00:00:00.000Z";

function host({
  id,
  state = "observed",
  firstSeenAt = AT,
}: {
  id: string;
  state?: "observed" | "stale";
  firstSeenAt?: string;
}): CrowdstrikeHost {
  return {
    agentVersion: null,
    firstSeenAt,
    firstSeenAtProvider: null,
    groupIds: [],
    hidden: false,
    hostname: null,
    id,
    kernelVersion: null,
    lastLoginAccount: null,
    lastLoginAt: null,
    lastSeenAt: null,
    macAddress: null,
    onlineState: null,
    osBuild: null,
    osVersion: null,
    platformName: null,
    preventionPolicyApplied: null,
    preventionPolicyId: null,
    productTypeDesc: null,
    providerId: id,
    reducedFunctionalityMode: null,
    rtrState: null,
    sensorUpdatePolicyApplied: null,
    sensorUpdatePolicyId: null,
    serialNumber: null,
    source: {
      artifacts: [],
      deepLink: null,
      deepLinkStatus: "unverified",
      endpoint: "/devices",
      observedAt: AT,
      surface: "falcon-api",
    },
    state,
    status: null,
    systemManufacturer: null,
    systemProductName: null,
  };
}

describe("provenCompleteRead", () => {
  it("proves a read that reached the provider's own total", () => {
    const proof = unwrap(provenCompleteRead({ kind: "host", observed: 175, pagesExhausted: true, reportedTotal: 175 }));
    expect(proof.provenBy).toBe("provenCompleteRead");
    expect(proof.observed).toBe(175);
    expect(proof.proof).toContain("matching the 175 the provider reported");
  });

  it("REFUSES a read that stopped before the pages ran out", () => {
    const problems = unwrapErr(
      provenCompleteRead({ kind: "host", observed: 100, pagesExhausted: false, reportedTotal: 175 }),
    );
    expect(problems[0]).toContain("stopped before the provider ran out of pages");
  });

  it("REFUSES a read short of the total the provider reported", () => {
    const problems = unwrapErr(
      provenCompleteRead({ kind: "host", observed: 100, pagesExhausted: true, reportedTotal: 175 }),
    );
    expect(problems[0]).toContain("produced 100 of the 175 the provider reported");
  });

  it("says so when completeness rests on paging alone", () => {
    const proof = unwrap(
      provenCompleteRead({ kind: "zero-trust-audit", observed: 1, pagesExhausted: true, reportedTotal: null }),
    );
    expect(proof.proof).toContain("the provider reported no total");
  });
});

describe("mergeCrowdstrikeKind", () => {
  it("stales an entity a COMPLETE read no longer returned", () => {
    const proof = unwrap(provenCompleteRead({ kind: "host", observed: 1, pagesExhausted: true, reportedTotal: 1 }));
    const merged = unwrap(
      mergeCrowdstrikeKind({
        at: LATER,
        complete: proof,
        observed: [host({ id: "a" })],
        stored: [host({ id: "a" }), host({ id: "b" })],
      }),
    );
    expect(merged.map((entity) => [entity.id, entity.state])).toEqual([
      ["a", "observed"],
      ["b", "stale"],
    ]);
  });

  it("stales NOTHING when the read did not finish", () => {
    const merged = unwrap(
      mergeCrowdstrikeKind({
        at: LATER,
        complete: null,
        observed: [host({ id: "a" })],
        stored: [host({ id: "a" }), host({ id: "b" })],
      }),
    );
    expect(merged.map((entity) => [entity.id, entity.state])).toEqual([
      ["a", "observed"],
      ["b", "observed"],
    ]);
  });

  it("keeps the first-seen stamp an earlier generation established", () => {
    const proof = unwrap(provenCompleteRead({ kind: "host", observed: 1, pagesExhausted: true, reportedTotal: 1 }));
    const merged = unwrap(
      mergeCrowdstrikeKind({
        at: LATER,
        complete: proof,
        observed: [host({ firstSeenAt: LATER, id: "a" })],
        stored: [host({ id: "a" })],
      }),
    );
    expect(merged[0]!.firstSeenAt).toBe(AT);
  });

  it("gives a brand-new entity this run's stamp", () => {
    const proof = unwrap(provenCompleteRead({ kind: "host", observed: 1, pagesExhausted: true, reportedTotal: 1 }));
    const merged = unwrap(
      mergeCrowdstrikeKind({
        at: LATER,
        complete: proof,
        observed: [host({ firstSeenAt: LATER, id: "z" })],
        stored: [],
      }),
    );
    expect(merged[0]!.firstSeenAt).toBe(LATER);
  });

  it("REFUSES a run that produced one id twice", () => {
    const problems = unwrapErr(
      mergeCrowdstrikeKind({ at: LATER, complete: null, observed: [host({ id: "a" }), host({ id: "a" })], stored: [] }),
    );
    expect(problems[0]).toContain("the same entity id twice");
  });

  it("leaves an already-stale entity exactly as it was", () => {
    const proof = unwrap(provenCompleteRead({ kind: "host", observed: 0, pagesExhausted: true, reportedTotal: 0 }));
    const stored = host({ id: "b", state: "stale" });
    const merged = unwrap(mergeCrowdstrikeKind({ at: LATER, complete: proof, observed: [], stored: [stored] }));
    expect(merged[0]).toBe(stored);
  });
});
