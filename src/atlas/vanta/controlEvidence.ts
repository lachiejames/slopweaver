/**
 * The evidence document `slopweaver atlas vanta control-evidence` emits, and the pure printable lines it
 * rests on. A sibling of `controlsEvidence.ts` (the plural, filtered-count document) — this one is about a
 * SINGLE control by id.
 *
 * Everything here comes from the Manage API through `client.ts` — `getControl`, `listControlTests` and one
 * bounded `getTestEntitySample` per failing test. There is no browser leg, so `screenshot` is `unavailable`
 * on every document this verb files today; the slot stays because filed evidence is durable and a later
 * corroborated capture must not need a new schema version to land in it.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import type { VantaControlDetailDto, VantaControlTestDto, VantaTestEntityDto } from "./controlEvidenceApiSchemas.js";
import { vantaCitationSchema } from "./controlsEvidence.js";
import { VantaEvidenceErrors, vantaEvidenceErrorLines } from "./evidenceErrors.js";

const screenshotSchema = z.discriminatedUnion("status", [
  z.object({ path: z.string().min(1), status: z.literal("captured") }).strict(),
  z.object({ reason: z.string().min(1), status: z.literal("unavailable") }).strict(),
]);

const entitySchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    status: z.string().min(1),
    type: z.string(),
    updatedAt: z.iso.datetime().nullable(),
  })
  .strict();

const testEntitiesSchema = z.discriminatedUnion("status", [
  z
    .object({
      hasMore: z.boolean(),
      reportedItemCount: z.number().int().nonnegative(),
      sample: z.array(entitySchema).max(10),
      status: z.literal("captured"),
    })
    .strict(),
  z.object({ status: z.literal("not-requested") }).strict(),
  z.object({ reason: z.string().min(1), status: z.literal("unavailable") }).strict(),
]);

const controlTestSchema = z
  .object({
    category: z.string(),
    description: z.string(),
    entities: testEntitiesSchema,
    failureDescription: z.string(),
    id: z.string().min(1),
    integrations: z.array(z.string()),
    lastRunAt: z.iso.datetime(),
    name: z.string().min(1),
    remediation: z
      .object({
        itemCount: z.number().int().nonnegative(),
        remediateBy: z.iso.datetime().nullable(),
        status: z.string().min(1),
      })
      .strict(),
    remediationDescription: z.string(),
    status: z.string().min(1),
    version: z.object({ major: z.number().int().nonnegative(), minor: z.number().int().nonnegative() }).strict(),
  })
  .strict();

export const vantaControlEvidenceSchema = z
  .object({
    control: z
      .object({
        citation: vantaCitationSchema,
        description: z.string(),
        documentsPassing: z.number().int().nonnegative(),
        documentsTotal: z.number().int().nonnegative(),
        domains: z.array(z.string()),
        externalId: z.string().nullable(),
        name: z.string().min(1),
        owner: z.string().nullable(),
        providerId: z.string().min(1),
        status: z.string().min(1),
        testsPassing: z.number().int().nonnegative(),
        testsTotal: z.number().int().nonnegative(),
      })
      .strict(),
    generatedAt: z.iso.datetime(),
    kind: z.literal("vanta-control-evidence"),
    schemaVersion: z.literal(1),
    screenshot: screenshotSchema,
    tenantSlug: z.string().min(1),
    tests: z.array(controlTestSchema),
  })
  .strict();

export type VantaControlEvidence = z.infer<typeof vantaControlEvidenceSchema>;

/**
 * What a bounded entity read came to for ONE test. A missing map entry means the caller never asked, which
 * is why `not-requested` is a first-class outcome rather than an absence: a reader must be able to tell "no
 * failing entities" from "nobody looked".
 */
export type VantaTestEntitiesOutcome =
  | { readonly kind: "captured"; readonly sample: readonly VantaTestEntityDto[]; readonly hasMore: boolean }
  | { readonly kind: "unavailable"; readonly reason: string };

/** Project one entity read's outcome onto the document's own union. */
function entitiesFor({
  outcome,
}: {
  outcome: VantaTestEntitiesOutcome | undefined;
}): VantaControlEvidence["tests"][number]["entities"] {
  if (outcome === undefined) {
    return { status: "not-requested" };
  }
  if (outcome.kind === "unavailable") {
    return { reason: outcome.reason, status: "unavailable" };
  }
  return {
    hasMore: outcome.hasMore,
    reportedItemCount: outcome.sample.length,
    sample: outcome.sample.slice(0, 10).map((entity) => ({
      id: entity.id,
      name: entity.displayName,
      status: entity.entityStatus,
      type: entity.responseType,
      updatedAt: entity.lastUpdatedDate,
    })),
    status: "captured",
  };
}

/** Project the control-detail read onto the document's own control block. */
function controlFor({
  control,
  citation,
}: {
  control: VantaControlDetailDto;
  citation: { readonly label: string; readonly url: string };
}): Record<string, unknown> {
  return {
    citation,
    description: control.description,
    documentsPassing: control.numDocumentsPassing,
    documentsTotal: control.numDocumentsTotal,
    domains: control.domains,
    externalId: control.externalId,
    name: control.name,
    owner: control.owner === null ? null : control.owner.displayName,
    providerId: control.id,
    status: control.status,
    testsPassing: control.numTestsPassing,
    testsTotal: control.numTestsTotal,
  };
}

/** Project one control-test read, and whatever its entity read came to, onto the document's own test block. */
function testFor({
  test,
  entitiesByTestId,
}: {
  test: VantaControlTestDto;
  entitiesByTestId: ReadonlyMap<string, VantaTestEntitiesOutcome>;
}): Record<string, unknown> {
  return {
    category: test.category,
    description: test.description,
    entities: entitiesFor({ outcome: entitiesByTestId.get(test.id) }),
    failureDescription: test.failureDescription,
    id: test.id,
    integrations: test.integrations,
    lastRunAt: test.lastTestRunDate,
    name: test.name,
    remediation: {
      itemCount: test.remediationStatusInfo.itemCount,
      remediateBy: test.remediationStatusInfo.soonestRemediateByDate,
      status: test.remediationStatusInfo.status,
    },
    remediationDescription: test.remediationDescription,
    status: test.status,
    version: test.version,
  };
}

/**
 * Build the single-control evidence document from what the Manage API actually returned, and prove it
 * against its own schema before anyone files it.
 *
 * The document is durable and is read back by a later invocation, so the schema is the contract rather than
 * this function's type signature: a DTO field Vanta reshapes surfaces here as a refusal instead of as a
 * document nothing can parse.
 *
 * @param control the control-detail read
 * @param tests every mapped automated test, in Vanta's own order
 * @param entitiesByTestId what a bounded entity read came to, keyed by test id; an absent key is `not-requested`
 * @param citation where a reader can go and see this for themselves
 * @param generatedAt when this evidence was gathered
 * @param screenshot whether a corroborating shot exists, and why not when it does not
 * @param tenantSlug which Vanta workspace this was read from
 * @returns the document, or every reason it does not satisfy its own schema
 */
export function buildVantaControlEvidence({
  control,
  tests,
  entitiesByTestId,
  citation,
  generatedAt,
  screenshot,
  tenantSlug,
}: {
  control: VantaControlDetailDto;
  tests: readonly VantaControlTestDto[];
  entitiesByTestId: ReadonlyMap<string, VantaTestEntitiesOutcome>;
  citation: { readonly label: string; readonly url: string };
  generatedAt: string;
  screenshot: VantaControlEvidence["screenshot"];
  tenantSlug: string;
}): Result<VantaControlEvidence> {
  const parsed = vantaControlEvidenceSchema.safeParse({
    control: controlFor({ citation, control }),
    generatedAt,
    kind: "vanta-control-evidence",
    schemaVersion: 1,
    screenshot,
    tenantSlug,
    tests: tests.map((test) => testFor({ entitiesByTestId, test })),
  });
  if (!parsed.success) {
    return err(
      vantaEvidenceErrorLines({ error: VantaEvidenceErrors.controlEvidenceInvalid({ issues: parsed.error.issues }) }),
    );
  }
  return ok(parsed.data);
}

/**
 * The label a control is printed under: its external id where Vanta carries one, and its provider id for a
 * control without — `externalId` is declared nullable above, so a control with none is a state Vanta
 * reports, by design, and still needs a label a reader can quote back.
 */
function controlLabel({ control }: { control: VantaControlEvidence["control"] }): string {
  if (control.externalId === null) {
    return control.providerId;
  }
  return control.externalId;
}

/**
 * The printed screen. Pure, so its exact wording is testable without a filesystem.
 *
 * @param evidence the single-control evidence document
 * @param artifactPath where the document itself was filed
 * @returns the report lines, in display order
 */
export function controlEvidenceLines({
  evidence,
  artifactPath,
}: {
  evidence: VantaControlEvidence;
  artifactPath: string;
}): readonly string[] {
  const failing = evidence.tests.filter((test) => test.status === "NEEDS_ATTENTION");
  return [
    `${controlLabel({ control: evidence.control })}: ${evidence.control.name}`,
    `Vanta status: ${evidence.control.status}; automated tests: ${String(evidence.control.testsPassing)}/${String(evidence.control.testsTotal)} passing`,
    `${String(failing.length)} mapped automated test(s) need attention`,
    ...failing.map(
      (test) =>
        `- ${test.name}: ${test.remediation.itemCount.toLocaleString("en-AU")} failing item(s); remediation ${test.remediation.status}${test.remediation.remediateBy === null ? "" : ` by ${test.remediation.remediateBy}`}`,
    ),
    `citation: ${evidence.control.citation.url}`,
    evidence.screenshot.status === "captured"
      ? `screenshot: ${evidence.screenshot.path}`
      : `screenshot: unavailable — ${evidence.screenshot.reason}`,
    `evidence filed: ${artifactPath}`,
  ];
}
