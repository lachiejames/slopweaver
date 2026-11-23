/**
 * Running the plan — the one place the Admin API is actually reached, and it does nothing else.
 *
 * `plan.ts` decided what may be called, `read.ts` calls one of them and `records.ts` says what came back
 * means. This walks the plan and assembles the observation `sync.ts` publishes from. It holds no judgement
 * about coverage, gaps or entities, which is why every one of those stayed testable without a network.
 *
 * ## One failing operation never sinks the run
 *
 * A grant that reaches twenty areas and is refused on the twenty-first should fill twenty and REPORT the
 * refusal, because the commonest refusal here is an API the Cloud project has not enabled — a console act
 * the owner can take in a minute, against a consent that is already correct. A run that aborted on the
 * first 403 would hide the nineteen it could have filled behind the one it could not.
 */
import type { OAuth2Client } from "googleapis-common";
import { scopeIdForToken } from "../../../lib/providerCall.js";
import { readGoogleAdminCollection } from "../../../live/googleAdmin/read.js";

import type { GoogleAdminFillObservation } from "./observation.js";
import { googleAdminFillPlan } from "./plan.js";

/** What a fill run reports back beyond the observation itself. */
export interface GoogleAdminFillReport {
  readonly observation: GoogleAdminFillObservation;
  /** How many operations answered. */
  readonly answered: number;
  /** How many were called and refused. */
  readonly refused: number;
  /** How many records were stored across every kind. */
  readonly records: number;
}

/**
 * Call every operation the grant reaches, and report what each one did.
 *
 * @param client the OAuth client from a resolved grant
 * @param granted the scope URIs that grant carries, which is what decides the plan
 * @param account the bound account, hashed into the shared rate scope and never stored
 * @param at this run's ISO timestamp
 * @param readCollection what reads one planned collection; the real Admin API unless a test supplies a fake
 * @returns the observation, plus the three counts a caller prints
 */
export async function runGoogleAdminFill({
  client,
  granted,
  account,
  at,
  readCollection = readGoogleAdminCollection,
}: {
  client: OAuth2Client;
  granted: readonly string[];
  account: string;
  at: string;
  readCollection?: typeof readGoogleAdminCollection;
}): Promise<GoogleAdminFillReport> {
  const plan = googleAdminFillPlan({ granted });
  const scopeId = scopeIdForToken({ token: account });
  const operations: GoogleAdminFillObservation["operations"] = [];
  const failed: GoogleAdminFillObservation["failed"] = [];
  for (const call of plan.calls) {
    const answered = await readCollection({ call, client, scopeId });
    if (answered.isErr()) {
      failed.push({ id: call.id, kind: call.kind, message: answered.error.message, status: answered.error.status });
      continue;
    }
    operations.push({
      aggregate: answered.value.shape === "aggregate",
      document: call.document,
      id: call.id,
      kind: call.kind,
      records: [...answered.value.records],
      truncated: answered.value.truncated,
    });
  }
  return {
    answered: operations.length,
    observation: {
      excluded: plan.excluded.map((entry) => ({
        detail: entry.detail,
        exclusion: entry.exclusion,
        id: entry.id,
        kind: entry.kind,
      })),
      failed,
      filledAtIso: at,
      grantedScopes: [...granted],
      operations,
    },
    records: operations.reduce((total, operation) => total + operation.records.length, 0),
    refused: failed.length,
  };
}
