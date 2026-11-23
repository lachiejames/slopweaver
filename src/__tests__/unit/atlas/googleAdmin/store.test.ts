/**
 * The publish gate, and the property it exists for.
 *
 * On this platform the shape-indexed kinds are the Workspace audit log and the Chrome browsing summaries,
 * so the gate is what keeps a generation from becoming the densest record of employee behaviour on the
 * machine. It must let a full compiled generation through and refuse a single stored record, and the two
 * cases must be distinguished by something a rename cannot move.
 */
import { describe, expect, it } from "vitest";

import {
  emptyGoogleAdminChannels,
  emptyGoogleAdminKindFile,
  type GoogleAdminAtlasEntity,
} from "../../../../atlas/googleAdmin/model.js";
import { refuseStoredObservations, shapeIndexedKinds } from "../../../../atlas/googleAdmin/store.js";
import { buildGoogleAdminGeneration } from "../../../../atlas/googleAdmin/sync.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";

/** One entity of a given family, with nothing any channel has looked at. */
function entity({ family }: { family: GoogleAdminAtlasEntity["family"] }): GoogleAdminAtlasEntity {
  return { channels: emptyGoogleAdminChannels(), family, id: "e", kind: "reports-activities", providerId: "p" };
}

describe("refuseStoredObservations", () => {
  it("passes the whole compiled generation, all 336 methods included", () => {
    const generation = unwrap(buildGoogleAdminGeneration({ at: AT }));
    expect(refuseStoredObservations({ files: generation.files }).isOk()).toBe(true);
  });

  it("refuses one stored audit event, naming the kind and the count", () => {
    const file = {
      ...emptyGoogleAdminKindFile({ kind: "reports-activities", updatedAt: AT }),
      entities: [entity({ family: "record" })],
    };
    const gate = refuseStoredObservations({ files: { "reports-activities": file } });
    expect(gate.isErr()).toBe(true);
    expect(gate._unsafeUnwrapErr()).toStrictEqual([
      "reports-activities carries 1 stored record(s) and its disposition is shape-index — docs/atlas-intent/06-holdings.md says this family is reached and its shape stored, never a row per record",
    ]);
  });

  it("counts every stored record of a kind, and only records, toward the one refusal line", () => {
    const file = {
      ...emptyGoogleAdminKindFile({ kind: "reports-activities", updatedAt: AT }),
      entities: [
        entity({ family: "record" }),
        entity({ family: "record-shape" }),
        entity({ family: "record" }),
        entity({ family: "record" }),
      ],
    };
    const gate = refuseStoredObservations({ files: { "reports-activities": file } });
    expect(gate._unsafeUnwrapErr()).toStrictEqual([
      "reports-activities carries 3 stored record(s) and its disposition is shape-index — docs/atlas-intent/06-holdings.md says this family is reached and its shape stored, never a row per record",
    ]);
  });

  it("allows a declared record shape on the same kind, because a shape is not a record", () => {
    const file = {
      ...emptyGoogleAdminKindFile({ kind: "reports-activities", updatedAt: AT }),
      entities: [entity({ family: "record-shape" })],
    };
    expect(refuseStoredObservations({ files: { "reports-activities": file } }).isOk()).toBe(true);
  });

  it("guards the mixed kind holding the Chrome browsing summaries, which a kind-level list missed", () => {
    // `chrome-management-security-insights` shape-indexes four operations
    // individually while the rest of the kind is configuration, so the seven-kind list never guarded it.
    expect([...shapeIndexedKinds()]).toContain("chrome-management-security-insights");
    const file = {
      ...emptyGoogleAdminKindFile({ kind: "chrome-management-security-insights", updatedAt: AT }),
      entities: [{ ...entity({ family: "record" }), kind: "chrome-management-security-insights" as const }],
    };
    const gate = refuseStoredObservations({ files: { "chrome-management-security-insights": file } });
    expect(gate.isErr()).toBe(true);
    expect(gate._unsafeUnwrapErr()[0]).toContain("chrome-management-security-insights carries 1 stored record(s)");
  });

  it("guards every kind the registry shape-indexes, which is more than the kind-level rule names", () => {
    expect(shapeIndexedKinds().length).toBe(8);
    expect([...shapeIndexedKinds()]).toStrictEqual([
      "alertcenter-alerts",
      "chrome-management-events",
      "chrome-management-reports",
      "chrome-management-security-insights",
      "reports-activities",
      "reports-customer-usage-reports",
      "reports-entity-usage-reports",
      "reports-user-usage-report",
    ]);
  });

  it("catches a shape-indexed record hidden in another kind's slot", () => {
    // Nothing makes the map key, the file's own kind and an entity's kind agree,
    // so a gate that looked its guarded kinds UP found nothing to look at. It now reads what is there.
    const file = {
      ...emptyGoogleAdminKindFile({ kind: "reports-activities", updatedAt: AT }),
      entities: [entity({ family: "record" })],
    };
    const gate = refuseStoredObservations({ files: { "directory-users": file } });
    expect(gate.isErr()).toBe(true);
    expect(gate._unsafeUnwrapErr()).toStrictEqual([
      "the file filed under directory-users declares kind reports-activities — a mislabelled slot, which is how a record of a shape-indexed kind reaches disk under a name that does not describe it",
      "reports-activities carries 1 stored record(s) and its disposition is shape-index — docs/atlas-intent/06-holdings.md says this family is reached and its shape stored, never a row per record",
    ]);
  });

  it("reads a file the publisher would reach through a prototype, which its own entries do not list", () => {
    // Unreachable from any caller here; the invariant it enforces — the gate
    // reads exactly what `kit/store.ts` writes — is what makes the fix worth keeping.
    const file = {
      ...emptyGoogleAdminKindFile({ kind: "reports-activities", updatedAt: AT }),
      entities: [entity({ family: "record" })],
    };
    // oxlint-disable-next-line no-unsafe-type-assertion
    const smuggled = Object.create({ "reports-activities": file }) as Record<string, never>;
    expect(Object.keys(smuggled)).toStrictEqual([]);
    expect(refuseStoredObservations({ files: smuggled }).isErr()).toBe(true);
  });

  it("allows a stored record on a kind whose disposition is entity", () => {
    const file = {
      ...emptyGoogleAdminKindFile({ kind: "directory-users", updatedAt: AT }),
      entities: [{ ...entity({ family: "record" }), kind: "directory-users" as const }],
    };
    expect(refuseStoredObservations({ files: { "directory-users": file } }).isOk()).toBe(true);
  });
});
