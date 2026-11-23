/**
 * The typed failures of building a Vanta evidence document and of the browser walk's tenant probe —
 * `controlEvidence.ts`, `controlsEvidence.ts` and `browserWalk.ts`.
 *
 * A union of its own per `.claude/rules/error-handling.md`. Both builders and the walk's root resolver keep
 * their `readonly string[]` contract, because their callers fold the lines into a mixed list, so
 * {@link vantaEvidenceErrorLines} is where a failure becomes exactly the lines it printed before it had a
 * type.
 *
 * Pure: values in, values out.
 */
import { type VantaSchemaIssues, vantaIssueLines } from "./httpErrors.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** Every way building a Vanta evidence document, or probing the web client for its tenant, can fail. */
export type VantaEvidenceError =
  | Listed<"CONTROL_EVIDENCE_INVALID">
  | Listed<"CONTROLS_EVIDENCE_INVALID">
  | (Plain<"TENANT_PROBE_FAILED"> & { readonly detail: string });

/** The one builder behind both document-schema refusals: a header naming the document, then its issues. */
function invalid<C extends string>({
  code,
  document,
  issues,
}: {
  code: C;
  document: string;
  issues: VantaSchemaIssues;
}): Listed<C> {
  const reasons = [
    `the ${document} evidence Vanta returned does not satisfy this package's own document schema:`,
    ...vantaIssueLines({ issues }),
  ];
  return { code, message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const VantaEvidenceErrors = {
  controlEvidenceInvalid: ({ issues }: { issues: VantaSchemaIssues }): VantaEvidenceError =>
    invalid({ code: "CONTROL_EVIDENCE_INVALID", document: "control", issues }),
  controlsEvidenceInvalid: ({ issues }: { issues: VantaSchemaIssues }): VantaEvidenceError =>
    invalid({ code: "CONTROLS_EVIDENCE_INVALID", document: "controls", issues }),
  tenantProbeFailed: ({ detail }: { detail: string }): VantaEvidenceError => ({
    code: "TENANT_PROBE_FAILED",
    detail,
    message: `could not reach the Vanta web client to learn its tenant: ${detail}`,
  }),
} as const;

/**
 * The lines one failure prints, exactly as the builder or walk printed them before it had a type: a
 * list-carrying failure as its list, and every other failure as its one message.
 *
 * @returns the lines, in order
 */
export function vantaEvidenceErrorLines({ error }: { error: VantaEvidenceError }): readonly string[] {
  if (error.code === "CONTROL_EVIDENCE_INVALID" || error.code === "CONTROLS_EVIDENCE_INVALID") {
    return error.reasons;
  }
  return [error.message];
}
