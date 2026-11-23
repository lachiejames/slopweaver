import { describe, expect, it } from "vitest";

import { vantaFrameworkListDtoSchema } from "../../../../atlas/vanta/censusApiSchemas.js";
import { vantaFrameworkDtoSchema } from "../../../../atlas/vanta/controlEvidenceApiSchemas.js";

/** One framework row as Vanta's frameworks list answers it, before `status` is decided per case. */
const FRAMEWORK = {
  description: "Information security management",
  displayName: "ISO 27001:2022",
  id: "iso27001_2022",
  numControlsCompleted: 80,
  numControlsTotal: 93,
  numDocumentsPassing: 30,
  numDocumentsTotal: 38,
  numTestsPassing: 200,
  numTestsTotal: 256,
  shorthandName: "ISO 27001",
};

// The census sync and the live controls-evidence lister read the same endpoint through two schemas, and the
// sync once failed because neither admitted `status`; both are held to the same contract here.
describe.each([
  { name: "vantaFrameworkListDtoSchema (census sync)", schema: vantaFrameworkListDtoSchema },
  { name: "vantaFrameworkDtoSchema (live lister)", schema: vantaFrameworkDtoSchema },
])("$name", ({ schema }) => {
  it("admits a snoozed framework and keeps its status", () => {
    const parsed = schema.parse({ ...FRAMEWORK, status: "SNOOZED" });
    expect(parsed.status).toBe("SNOOZED");
  });

  it("admits a framework with no lifecycle status as null", () => {
    const parsed = schema.parse({ ...FRAMEWORK, status: null });
    expect(parsed.status).toBe(null);
  });

  it("admits a row Vanta answered without status information, adding no status key", () => {
    const parsed = schema.parse(FRAMEWORK);
    expect(Object.keys(parsed)).toEqual(Object.keys(FRAMEWORK));
  });

  it("refuses a status value Vanta does not document, naming the field", () => {
    const result = schema.safeParse({ ...FRAMEWORK, status: "PAUSED" });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => ({ code: issue.code, path: issue.path }))).toEqual([
      { code: "invalid_value", path: ["status"] },
    ]);
  });

  it("still refuses any other key Vanta adds", () => {
    const result = schema.safeParse({ ...FRAMEWORK, lifecycle: "ACTIVE" });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.code)).toEqual(["unrecognized_keys"]);
  });

  // A sync once exited 1 on exactly these two keys, which the served document's own example carries.
  it("admits isPurchased and activeVariants and keeps both", () => {
    const parsed = schema.parse({
      ...FRAMEWORK,
      activeVariants: [{ id: "SOC2_SECURITY", label: "Security" }],
      isPurchased: true,
    });
    expect(parsed.isPurchased).toBe(true);
    expect(parsed.activeVariants).toEqual([{ id: "SOC2_SECURITY", label: "Security" }]);
  });

  it("refuses an active variant carrying a key the document does not declare, naming its path", () => {
    const result = schema.safeParse({
      ...FRAMEWORK,
      activeVariants: [{ id: "SOC2_SECURITY", label: "Security", tier: 1 }],
      isPurchased: true,
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => ({ code: issue.code, path: issue.path }))).toEqual([
      { code: "unrecognized_keys", path: ["activeVariants", 0] },
    ]);
  });

  it("refuses an isPurchased that is not a boolean", () => {
    const result = schema.safeParse({ ...FRAMEWORK, isPurchased: "yes" });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => ({ code: issue.code, path: issue.path }))).toEqual([
      { code: "invalid_type", path: ["isPurchased"] },
    ]);
  });

  it("admits an unpurchased framework whose progress counts are Vanta's -1", () => {
    const parsed = schema.parse({
      ...FRAMEWORK,
      isPurchased: false,
      numControlsCompleted: -1,
      numControlsTotal: -1,
      numDocumentsPassing: -1,
      numDocumentsTotal: -1,
      numTestsPassing: -1,
      numTestsTotal: -1,
    });
    expect(parsed.numControlsTotal).toBe(-1);
  });
});

describe("vantaFrameworkDtoSchema (live lister) count floor", () => {
  it("refuses a count below Vanta's -1 sentinel", () => {
    const result = vantaFrameworkDtoSchema.safeParse({ ...FRAMEWORK, isPurchased: false, numControlsTotal: -2 });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => ({ code: issue.code, path: issue.path }))).toEqual([
      { code: "too_small", path: ["numControlsTotal"] },
    ]);
  });
});
