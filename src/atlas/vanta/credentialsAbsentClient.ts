/**
 * The sync client used when no Vanta credentials are configured: every method fails the same way, so
 * credential absence flows through the exact same coverage, gap and merge machinery every other failure does
 * (`sync.ts`'s header).
 *
 * The failure is graded `API_CREDENTIAL_NOT_CONFIGURED` here, where absence is KNOWN, rather than rediscovered
 * later from its sentence.
 */
import { err, type Result } from "../../lib/result.js";
import type { VantaAtlasSyncClient } from "./client.js";
import { type VantaSurfaceError, VantaSurfaceErrors } from "./surfaceErrors.js";
import { VantaSyncErrors, vantaSyncErrorLines } from "./syncErrors.js";

/**
 * A client whose every method fails with the one credentials-absent error.
 *
 * @returns the client, every read already refused
 */
export function credentialsAbsentClient(): VantaAtlasSyncClient {
  const reasons = vantaSyncErrorLines({ error: VantaSyncErrors.credentialsAbsent() });
  const absent = VantaSurfaceErrors.apiCredentialNotConfigured({ reasons });
  const refuse = (): Promise<Result<never, VantaSurfaceError>> => Promise.resolve(err(absent));
  return {
    listCensusFamily: refuse,
    listChildSurface: refuse,
    listControlsActive: refuse,
    listControlsDeactivated: refuse,
    listEventLog: refuse,
    listEvidenceDocuments: refuse,
    listKnowledgeBaseResources: refuse,
    listPolicies: refuse,
    listRisksEnterpriseRisk: refuse,
    listRisksRiskScenario: refuse,
    listVendors: refuse,
  };
}
