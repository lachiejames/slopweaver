/**
 * The evidence document `slopweaver atlas vanta controls-evidence` emits, and the pure printable lines it
 * rests on. Every exported shape is a Zod schema, not a plain interface: this document crosses a real trust
 * boundary — written by one invocation, read back later by a `vanta controls-card` invocation.
 *
 * `filter` is a closed set, not a free string, so a document claiming to measure anything else is
 * unrepresentable. It has two members because there are two channels and they measure different things:
 *
 * - `NEEDS_ATTENTION` is the Controls list's own explicit filter in the web client. Version 2 carries it,
 *   and so does every version 1 document filed from that channel.
 * - `NOT_COMPLETED` is what the Manage API can measure. MEASURED over every control the tenant holds
 *   (`slopweaver atlas vanta controls-evidence --json`): `GET /v1/controls/{id}` grades a control
 *   `COMPLETED`, `IN_PROGRESS`, `NOT_STARTED` or `NO_EVIDENCE_MAPPED`, and `NEEDS_ATTENTION` is not a member
 *   of that enum at all — it is a TEST status. A document from the API channel that claimed the
 *   `NEEDS_ATTENTION` filter would be false, and its count read as zero, which is exactly what the first cut
 *   of `atlas vanta controls-evidence` reported before this was measured.
 *
 * The field is what tells the two apart, which is the whole reason it is on the document rather than implied
 * by whoever wrote it.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import { VantaEvidenceErrors, vantaEvidenceErrorLines } from "./evidenceErrors.js";

export const vantaCitationSchema = z.object({ label: z.string().min(1), url: z.url() }).strict();

/** A screenshot capture's outcome, folded into the evidence document. */
const vantaControlsScreenshotSchema = z.discriminatedUnion("status", [
  z
    .object({ displayedTotal: z.number().int().nonnegative(), path: z.string().min(1), status: z.literal("captured") })
    .strict(),
  z.object({ reason: z.string().min(1), status: z.literal("unavailable") }).strict(),
]);

/** What produced a count: the web client's own list filter, or the Manage API's own control grade. */
export const vantaControlsFilterSchema = z.enum(["NEEDS_ATTENTION", "NOT_COMPLETED"]);

/**
 * The verified evidence bundle: a live, filtered count, the citation a reply can point at, and whether a
 * corroborating screenshot exists.
 *
 * Version 1 is retained because filed evidence is durable. Version 2 adds Manage API framework completion
 * and a browser-corroborated focused framework without changing how existing version 1 documents are read.
 */
const vantaControlsEvidenceV1Schema = z
  .object({
    citation: vantaCitationSchema,
    filter: vantaControlsFilterSchema,
    generatedAt: z.iso.datetime(),
    kind: z.literal("vanta-controls-evidence"),
    schemaVersion: z.literal(1),
    screenshot: vantaControlsScreenshotSchema,
    tenantSlug: z.string().min(1),
    total: z.number().int().nonnegative(),
  })
  .strict();

const vantaFrameworkEvidenceSchema = z
  .object({
    controlsCompleted: z.number().int().nonnegative(),
    controlsNeedingAttention: z.number().int().nonnegative(),
    controlsTotal: z.number().int().nonnegative(),
    id: z.string().min(1),
    name: z.string().min(1),
    testsPassing: z.number().int().nonnegative(),
    testsTotal: z.number().int().nonnegative(),
  })
  .strict();

const vantaFocusedControlSchema = z
  .object({
    citation: vantaCitationSchema,
    externalId: z.string().min(1),
    frameworks: z.array(z.string().min(1)),
    name: z.string().min(1),
    owner: z.string(),
    providerId: z.string().min(1),
    testsPassing: z.number().int().nonnegative(),
    testsTotal: z.number().int().nonnegative(),
  })
  .strict();

const vantaControlsEvidenceV2Schema = z
  .object({
    citation: vantaCitationSchema,
    filter: z.literal("NEEDS_ATTENTION"),
    focus: z
      .object({
        citation: vantaCitationSchema,
        controls: z.array(vantaFocusedControlSchema).max(10),
        frameworkId: z.string().min(1),
        frameworkName: z.string().min(1),
        screenshot: vantaControlsScreenshotSchema,
        total: z.number().int().nonnegative(),
      })
      .strict(),
    frameworks: z.array(vantaFrameworkEvidenceSchema),
    generatedAt: z.iso.datetime(),
    kind: z.literal("vanta-controls-evidence"),
    schemaVersion: z.literal(2),
    screenshot: vantaControlsScreenshotSchema,
    tenantSlug: z.string().min(1),
    total: z.number().int().nonnegative(),
  })
  .strict();

export const vantaControlsEvidenceSchema = z.discriminatedUnion("schemaVersion", [
  vantaControlsEvidenceV1Schema,
  vantaControlsEvidenceV2Schema,
]);

export type VantaControlsEvidence = z.infer<typeof vantaControlsEvidenceSchema>;

/**
 * The printed screen. Pure, so its exact wording is testable without a filesystem.
 *
 * @param evidence the evidence document
 * @param artifactPath where the document itself was filed
 * @returns the report lines, in display order
 */
export function controlsEvidenceLines({
  evidence,
  artifactPath,
}: {
  evidence: VantaControlsEvidence;
  artifactPath: string;
}): readonly string[] {
  const lines = [
    `${String(evidence.total)} Vanta control(s) need attention for ${evidence.tenantSlug} (filter: ${evidence.filter})`,
    `citation: ${evidence.citation.url}`,
    evidence.screenshot.status === "captured"
      ? `screenshot: ${evidence.screenshot.path}`
      : `screenshot: unavailable — ${evidence.screenshot.reason}`,
    `evidence filed: ${artifactPath}`,
  ];
  if (evidence.schemaVersion === 1) {
    return lines;
  }
  return [
    ...lines.slice(0, -1),
    ...evidence.frameworks.map(
      (framework) =>
        `${framework.name}: ${String(framework.controlsNeedingAttention)} control gap(s); ${String(framework.controlsCompleted)}/${String(framework.controlsTotal)} complete; ${String(framework.testsPassing)}/${String(framework.testsTotal)} tests passing`,
    ),
    `${evidence.focus.frameworkName} focus: ${String(evidence.focus.total)} control(s) need attention; ${String(evidence.focus.controls.length)} visible row(s) captured`,
    evidence.focus.screenshot.status === "captured"
      ? `focused screenshot: ${evidence.focus.screenshot.path}`
      : `focused screenshot: unavailable — ${evidence.focus.screenshot.reason}`,
    `evidence filed: ${artifactPath}`,
  ];
}

/**
 * One failing control, as the plural verb prints it. Not part of the filed document: version 1 records the
 * COUNT the `NEEDS_ATTENTION` filter measures and has no slot for the rows behind it, and widening a durable
 * schema to carry them would strand every document already filed against it.
 */
export interface VantaFailingControlRow {
  readonly providerId: string;
  readonly externalId: string | null;
  readonly name: string;
  /** Vanta's own grade: `IN_PROGRESS`, `NOT_STARTED` or `NO_EVIDENCE_MAPPED` — never `COMPLETED` here. */
  readonly status: string;
  readonly testsPassing: number;
  readonly testsTotal: number;
}

/**
 * Build the filtered-count document, and prove it against its own schema before anyone files it.
 *
 * Version 1 rather than version 2, and the reason is a property of the channel rather than a shortcut:
 * version 2's `focus` block is a browser-corroborated view of one framework's control rows, and the Manage
 * API maps no control to a framework at all — so a version 2 document emitted from this channel would carry
 * an empty focus that reads as "nothing is failing there" rather than "nobody looked". A version 1 document
 * says exactly what was measured.
 *
 * @param citation where a reader can go and see this for themselves
 * @param filter which of the two definitions above produced `total`
 * @param generatedAt when this evidence was gathered
 * @param screenshot whether a corroborating shot exists, and why not when it does not
 * @param tenantSlug which Vanta workspace this was read from
 * @param total how many controls that filter matches
 * @returns the document, or every reason it does not satisfy its own schema
 */
export function buildVantaControlsEvidenceV1({
  citation,
  filter,
  generatedAt,
  screenshot,
  tenantSlug,
  total,
}: {
  citation: { readonly label: string; readonly url: string };
  filter: z.infer<typeof vantaControlsFilterSchema>;
  generatedAt: string;
  screenshot: VantaControlsEvidence["screenshot"];
  tenantSlug: string;
  total: number;
}): Result<VantaControlsEvidence> {
  const parsed = vantaControlsEvidenceV1Schema.safeParse({
    citation,
    filter,
    generatedAt,
    kind: "vanta-controls-evidence",
    schemaVersion: 1,
    screenshot,
    tenantSlug,
    total,
  });
  if (!parsed.success) {
    return err(
      vantaEvidenceErrorLines({ error: VantaEvidenceErrors.controlsEvidenceInvalid({ issues: parsed.error.issues }) }),
    );
  }
  return ok(parsed.data);
}
