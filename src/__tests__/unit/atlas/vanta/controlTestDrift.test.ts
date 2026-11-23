import { describe, expect, it } from "vitest";

import { vantaControlDtoSchema, vantaControlsPageSchema } from "../../../../atlas/vanta/apiSchemas.js";
import { vantaTestDtoSchema } from "../../../../atlas/vanta/censusApiSchemas.js";
import { vantaControlDetailDtoSchema } from "../../../../atlas/vanta/controlEvidenceApiSchemas.js";
import { vantaLibraryControlDtoSchema } from "../../../../atlas/vanta/libraryControlApiSchemas.js";

/**
 * The two drifts that failed `resync-atlas-vanta`: every `controls-active` row arrived carrying
 * `implementationDetails` (optional, nullable string in the pinned document), and some `tests-list` rows carried
 * `latestFlipDate: null` (required, nullable). Both schemas stay `.strict()`. Every id is synthetic.
 */
const controlJson = {
  creationDate: null,
  customFields: [],
  description: "drift control description",
  domains: ["DRIFT_DOMAIN"],
  externalId: null,
  id: "drift-control-id",
  modificationDate: null,
  name: "drift control name",
  owner: null,
  role: null,
  source: "Vanta",
} as const;

const testJson = {
  category: "drift-category",
  deactivatedStatusInfo: { deactivatedReason: null, isDeactivated: false, lastUpdatedDate: null },
  description: "drift test description",
  failureDescription: "drift test failure",
  id: "drift-test-id",
  integrations: ["drift-integration"],
  lastTestRunDate: "2026-10-17T05:00:00.000Z",
  latestFlipDate: "2026-10-16T05:00:00.000Z",
  name: "drift test name",
  owner: null,
  remediationDescription: "drift test remediation",
  remediationStatusInfo: { itemCount: 0, soonestRemediateByDate: null, status: "drift-status" },
  status: "OK",
  version: { major: 1, minor: 0 },
} as const;

const pageInfo = { endCursor: null, hasNextPage: false, hasPreviousPage: false, startCursor: null };

describe("vantaControlDtoSchema and implementationDetails", () => {
  it("keeps a string implementationDetails exactly as returned", () => {
    const row = { ...controlJson, implementationDetails: "enforced by the IdP's MFA policy" };
    expect(vantaControlDtoSchema.parse(row)).toStrictEqual(row);
  });

  it("keeps a null implementationDetails as null", () => {
    const row = { ...controlJson, implementationDetails: null };
    expect(vantaControlDtoSchema.parse(row)).toStrictEqual(row);
  });

  it("reads a row without implementationDetails, which the document leaves optional", () => {
    expect(vantaControlDtoSchema.parse(controlJson)).toStrictEqual(controlJson);
  });

  it("parses a controls page whose every row carries the key — the page that came back INCOMPLETE", () => {
    const page = {
      results: {
        data: [
          { ...controlJson, implementationDetails: "first" },
          { ...controlJson, id: "drift-control-id-2", implementationDetails: null },
        ],
        pageInfo,
      },
    };
    expect(vantaControlsPageSchema.parse(page).results.data.map((row) => row.implementationDetails)).toEqual([
      "first",
      null,
    ]);
  });

  it("reads a row without role, which the document leaves optional", () => {
    const { role: _omitted, ...withoutRole } = controlJson;
    expect(vantaControlDtoSchema.parse(withoutRole)).toStrictEqual(withoutRole);
  });

  it("keeps a string role exactly as returned", () => {
    const row = { ...controlJson, role: "CONTROLLER" };
    expect(vantaControlDtoSchema.parse(row)).toStrictEqual(row);
  });

  it("still refuses a role that is neither a string nor null, at its path", () => {
    const parsed = vantaControlDtoSchema.safeParse({ ...controlJson, role: 1 });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.path).toEqual(["role"]);
  });

  it("still refuses an unknown key on the row, naming it", () => {
    const parsed = vantaControlDtoSchema.safeParse({ ...controlJson, somethingNew: 1 });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toBe(`Unrecognized key: "somethingNew"`);
  });
});

/** The controls-LIBRARY row, the third strict schema that parses a control object. Every id is synthetic. */
const libraryControlJson = {
  creationDate: null,
  customFields: [],
  deactivationReason: null,
  description: "drift-library-description",
  domains: [],
  externalId: null,
  frameworks: [],
  id: "drift-library-id",
  modificationDate: null,
  name: "drift-library-name",
  owner: null,
  role: null,
  source: "Vanta",
} as const;

describe("vantaLibraryControlDtoSchema and implementationDetails", () => {
  it("keeps a string implementationDetails exactly as returned", () => {
    const row = { ...libraryControlJson, implementationDetails: "implemented via MFA" };
    expect(vantaLibraryControlDtoSchema.parse(row)).toStrictEqual(row);
  });

  it("keeps a null implementationDetails as null", () => {
    const row = { ...libraryControlJson, implementationDetails: null };
    expect(vantaLibraryControlDtoSchema.parse(row)).toStrictEqual(row);
  });

  it("reads a library row without implementationDetails", () => {
    expect(vantaLibraryControlDtoSchema.parse(libraryControlJson)).toStrictEqual(libraryControlJson);
  });

  it("still refuses an unknown key on the library row, naming it", () => {
    const parsed = vantaLibraryControlDtoSchema.safeParse({ ...libraryControlJson, somethingNew: 1 });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toBe(`Unrecognized key: "somethingNew"`);
  });
});

describe("vantaTestDtoSchema and latestFlipDate", () => {
  it("keeps a null latestFlipDate as null — a test that never flipped", () => {
    const row = { ...testJson, latestFlipDate: null };
    expect(vantaTestDtoSchema.parse(row)).toStrictEqual(row);
  });

  it("keeps a string latestFlipDate exactly as returned", () => {
    expect(vantaTestDtoSchema.parse(testJson)).toStrictEqual(testJson);
  });

  it("refuses a row without latestFlipDate, which the document marks required", () => {
    const { latestFlipDate: _omitted, ...withoutFlip } = testJson;
    const parsed = vantaTestDtoSchema.safeParse(withoutFlip);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.path).toEqual(["latestFlipDate"]);
  });
});

/**
 * The same `implementationDetails` drift reached `GET /v1/controls/{controlId}`, which the first fix missed:
 * `atlas vanta control-evidence --control <id>` refused every control with `Unrecognized key`.
 */
describe("vantaControlDetailDtoSchema and implementationDetails", () => {
  const detailJson = {
    ...controlJson,
    note: null,
    numDocumentsPassing: 1,
    numDocumentsTotal: 2,
    numTestsPassing: 3,
    numTestsTotal: 4,
    status: "IN_PROGRESS",
  } as const;

  it("keeps a string implementationDetails exactly as returned", () => {
    const row = { ...detailJson, implementationDetails: "remediated per the findings register" };
    expect(vantaControlDetailDtoSchema.parse(row)).toStrictEqual(row);
  });

  it("keeps a null implementationDetails as null", () => {
    const row = { ...detailJson, implementationDetails: null };
    expect(vantaControlDetailDtoSchema.parse(row)).toStrictEqual(row);
  });

  it("reads a detail without implementationDetails, which the document leaves optional", () => {
    expect(vantaControlDetailDtoSchema.parse(detailJson)).toStrictEqual(detailJson);
  });

  it("reads a detail without role, which ControlDetail leaves optional", () => {
    const { role: _omitted, ...withoutRole } = detailJson;
    expect(vantaControlDetailDtoSchema.parse(withoutRole)).toStrictEqual(withoutRole);
  });

  it("still refuses a detail role that is neither a string nor null, at its path", () => {
    const parsed = vantaControlDetailDtoSchema.safeParse({ ...detailJson, role: 1 });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.path).toEqual(["role"]);
  });

  it("still refuses an unknown key on the detail, naming it", () => {
    const parsed = vantaControlDetailDtoSchema.safeParse({ ...detailJson, somethingNew: 1 });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toBe(`Unrecognized key: "somethingNew"`);
  });
});
