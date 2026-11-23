/**
 * The publish-time obligation gate — `src/atlas/kit/mandatoryKinds.ts`.
 *
 * Every exemption here is a case that was MEASURED to break something real, so each one is asserted rather
 * than trusted: the wholly-empty generation is `atlas <platform> reset`, and the holds-entities case is
 * Cloudflare answering 410 on one of six firewall subtypes while publishing five real entities.
 */
import { describe, expect, it } from "vitest";

import type { AtlasKindStatus } from "../../../../atlas/kit/kindStatus.js";
import {
  type AtlasKindObligations,
  kindEverAcquired,
  mandatoryKindRefusal,
  obligationFor,
  productAbsent,
  unacquiredMandatoryKinds,
} from "../../../../atlas/kit/mandatoryKinds.js";

type Kind = "control" | "vendor" | "audit";

const KINDS: readonly Kind[] = ["audit", "control", "vendor"];

const acquired = ({ count }: { count: number }): AtlasKindStatus => ({
  digest: "d",
  entityCount: count,
  lastAttempt: { at: "2026-09-08T00:00:00.000Z", outcome: "ok", reasons: [] },
  lastSuccessAt: "2026-09-08T00:00:00.000Z",
});

const neverAcquired = ({ count }: { count: number }): AtlasKindStatus => ({
  digest: null,
  entityCount: count,
  lastAttempt: null,
  lastSuccessAt: null,
});

const permissionBlockedStatus = (): AtlasKindStatus => ({
  digest: null,
  entityCount: 0,
  lastAttempt: { at: "2026-09-08T00:00:00.000Z", outcome: "failed", reasons: ["403"] },
  lastSuccessAt: null,
  permissionBlocked: {
    at: "2026-09-08T00:00:00.000Z",
    detail: "this administrator may not read this family",
    unblockedBy: "the JumpCloud administrator role that reads systems",
  },
});

const productAbsentStatus = (): AtlasKindStatus => ({
  digest: null,
  entityCount: 0,
  lastAttempt: { at: "2026-09-17T00:00:00.000Z", outcome: "failed", reasons: ["404"] },
  lastSuccessAt: null,
  productAbsent: {
    at: "2026-09-17T00:00:00.000Z",
    detail: "v2-google-chrome-enterprise-premium-service-get-configuration: answered 404",
  },
});

const manifestOf = ({
  kinds,
}: {
  kinds: Record<Kind, AtlasKindStatus>;
}): { kinds: Record<Kind, AtlasKindStatus>; schemaVersion: number; updatedAt: string } => ({
  kinds,
  schemaVersion: 1,
  updatedAt: "2026-09-08T00:00:00.000Z",
});

const allMandatory: AtlasKindObligations<Kind> = { exceptions: {} };

describe("obligationFor", () => {
  it("defaults an undeclared kind to mandatory, so a forgotten kind is owed rather than exempt", () => {
    expect(obligationFor({ kind: "control", obligations: allMandatory })).toEqual({ rule: "mandatory" });
  });

  it("returns the declared exemption and its reason", () => {
    const obligations: AtlasKindObligations<Kind> = {
      exceptions: { audit: { rule: "optional", why: "no Manage API surface exists" } },
    };

    expect(obligationFor({ kind: "audit", obligations })).toEqual({
      rule: "optional",
      why: "no Manage API surface exists",
    });
  });
});

describe("kindEverAcquired", () => {
  it("is false for a kind with no recorded success", () => {
    expect(kindEverAcquired({ status: neverAcquired({ count: 0 }) })).toBe(false);
  });

  it("is false when the manifest carries no row at all", () => {
    expect(kindEverAcquired({ status: null })).toBe(false);
  });

  it("is true once a success has been stamped", () => {
    expect(kindEverAcquired({ status: acquired({ count: 3 }) })).toBe(true);
  });
});

describe("productAbsent", () => {
  it("is true for a status carrying the provider's absence answer", () => {
    expect(productAbsent({ status: productAbsentStatus() })).toBe(true);
  });

  it("is false for a permission boundary, which is a different reason for the same emptiness", () => {
    expect(productAbsent({ status: permissionBlockedStatus() })).toBe(false);
  });

  it("is false when the manifest carries no row at all", () => {
    expect(productAbsent({ status: undefined })).toBe(false);
  });
});

describe("unacquiredMandatoryKinds", () => {
  it("refuses a mixed generation: a real kind beside an empty never-read one", () => {
    const manifest = manifestOf({
      kinds: { audit: acquired({ count: 2 }), control: neverAcquired({ count: 0 }), vendor: acquired({ count: 4 }) },
    });

    expect(
      unacquiredMandatoryKinds({
        kinds: KINDS,
        manifest,
        obligations: allMandatory,
        present: ["audit", "control", "vendor"],
      }),
    ).toEqual(["control"]);
  });

  it("exempts a wholly-empty generation, which is what `reset` installs", () => {
    const manifest = manifestOf({
      kinds: {
        audit: neverAcquired({ count: 0 }),
        control: neverAcquired({ count: 0 }),
        vendor: neverAcquired({ count: 0 }),
      },
    });

    expect(
      unacquiredMandatoryKinds({
        kinds: KINDS,
        manifest,
        obligations: allMandatory,
        present: ["audit", "control", "vendor"],
      }),
    ).toEqual([]);
  });

  it("exempts a never-acquired kind that HOLDS ENTITIES, because a partial read is not a placeholder", () => {
    const manifest = manifestOf({
      kinds: { audit: acquired({ count: 1 }), control: neverAcquired({ count: 5 }), vendor: acquired({ count: 4 }) },
    });

    expect(
      unacquiredMandatoryKinds({
        kinds: KINDS,
        manifest,
        obligations: allMandatory,
        present: ["audit", "control", "vendor"],
      }),
    ).toEqual([]);
  });

  it("does not judge a kind the publish OMITS, so a second surface never deadlocks the first", () => {
    const manifest = manifestOf({
      kinds: { audit: neverAcquired({ count: 0 }), control: acquired({ count: 9 }), vendor: acquired({ count: 4 }) },
    });

    expect(
      unacquiredMandatoryKinds({ kinds: KINDS, manifest, obligations: allMandatory, present: ["control", "vendor"] }),
    ).toEqual([]);
  });

  it("does not judge a declared-optional kind even when it is written empty and never read", () => {
    const manifest = manifestOf({
      kinds: { audit: neverAcquired({ count: 0 }), control: acquired({ count: 9 }), vendor: acquired({ count: 4 }) },
    });
    const obligations: AtlasKindObligations<Kind> = {
      exceptions: { audit: { rule: "optional", why: "no browser capture ships for this atlas yet" } },
    };

    expect(
      unacquiredMandatoryKinds({ kinds: KINDS, manifest, obligations, present: ["audit", "control", "vendor"] }),
    ).toEqual([]);
  });

  it("exempts a never-acquired kind the atlas declared a permission boundary for", () => {
    const manifest = manifestOf({
      kinds: { audit: acquired({ count: 2 }), control: permissionBlockedStatus(), vendor: acquired({ count: 4 }) },
    });

    expect(
      unacquiredMandatoryKinds({
        kinds: KINDS,
        manifest,
        obligations: allMandatory,
        present: ["audit", "control", "vendor"],
      }),
    ).toEqual([]);
  });

  it("exempts a never-acquired kind the provider answered this organisation has no product for", () => {
    const manifest = manifestOf({
      kinds: { audit: acquired({ count: 2 }), control: productAbsentStatus(), vendor: acquired({ count: 4 }) },
    });

    expect(
      unacquiredMandatoryKinds({
        kinds: KINDS,
        manifest,
        obligations: allMandatory,
        present: ["audit", "control", "vendor"],
      }),
    ).toEqual([]);
  });

  it("still refuses a never-acquired kind whose failure was NOT classified as a permission boundary", () => {
    const manifest = manifestOf({
      kinds: { audit: acquired({ count: 2 }), control: neverAcquired({ count: 0 }), vendor: acquired({ count: 4 }) },
    });

    expect(
      unacquiredMandatoryKinds({
        kinds: KINDS,
        manifest,
        obligations: allMandatory,
        present: ["audit", "control", "vendor"],
      }),
    ).toEqual(["control"]);
  });

  it("names every offending kind, sorted, so a refusal is stable across runs", () => {
    const manifest = manifestOf({
      kinds: {
        audit: neverAcquired({ count: 0 }),
        control: neverAcquired({ count: 0 }),
        vendor: acquired({ count: 4 }),
      },
    });

    expect(
      unacquiredMandatoryKinds({
        kinds: KINDS,
        manifest,
        obligations: allMandatory,
        present: ["audit", "control", "vendor"],
      }),
    ).toEqual(["audit", "control"]);
  });
});

describe("mandatoryKindRefusal", () => {
  it("says nothing when nothing is owed", () => {
    expect(mandatoryKindRefusal({ platform: "vanta", unacquired: [] })).toEqual([]);
  });

  it("names the atlas, the kind and both ways out", () => {
    const lines = mandatoryKindRefusal({ platform: "vanta", unacquired: ["control"] });

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("the vanta atlas would publish control while having never acquired it");
    expect(lines[2]).toContain("declare it optional");
  });

  it("reads as a plural when more than one kind is owed", () => {
    const lines = mandatoryKindRefusal({ platform: "hex", unacquired: ["page", "project"] });

    expect(lines[0]).toBe("the hex atlas would publish page, project while having never acquired them");
  });
});
