/**
 * The real {@link TriageApi}: the SDK's `ErrorTrackingApi.getIssue` and `updateIssueState` (PUT
 * `/api/v2/error-tracking/issues/{issue_id}/state`) on the shared client.
 *
 * ## Why the SDK and not `rawTransport.ts`
 *
 * `rawTransport.ts` is read-only by its TYPE, and a PUT allowlisted into it would retire the one property an
 * auditor reads off that file. So the write goes through the SDK here, named as a write, the same route
 * `historicalIngestion.ts` takes for its POST.
 */
import { client } from "@datadog/datadog-api-client";
import { z } from "zod";

import type { DatadogClient } from "./client.js";
import { ERROR_TRACKING_STATES } from "./errorTracking.js";
import type { TriageApi } from "./errorTrackingTriage.js";

/**
 * What a GET must carry: the issue resource itself, its id and its state. The id is checked against the one
 * asked for, so an answer for another issue never reads as this one's state. MEASURED on this install's site:
 * `slopweaver datadog triage --issue <issue-id> --state reviewed --dry-run --json`
 * parses, so the live answer carries `type: "issue"` and the id.
 */
const issueResponseSchema = z.object({
  data: z.object({
    attributes: z.object({ state: z.enum(ERROR_TRACKING_STATES) }),
    id: z.string(),
    type: z.literal("issue"),
  }),
});

/**
 * The two SDK operations {@link sdkTriageApi} binds — the shared client's `errorTracking` satisfies it, and a
 * test passes plain functions to check the 404 mapping and the exact body sent.
 */
export type ErrorTrackingIssueOps = Pick<DatadogClient["errorTracking"], "getIssue" | "updateIssueState">;

/**
 * The real seam over the shared client.
 *
 * A 404 on a read is the one failure that is an ANSWER — no such issue — and is mapped to `found: false`.
 * A read whose answer is not this issue with a recognisable state THROWS, so it reaches the caller as a failed
 * read rather than as a state nobody saw.
 *
 * @param errorTracking the shared client's Error Tracking API
 * @returns the seam
 */
export function sdkTriageApi({ errorTracking }: { errorTracking: ErrorTrackingIssueOps }): TriageApi {
  return {
    get: async ({ id }) => {
      let response: unknown;
      try {
        response = await errorTracking.getIssue({ issueId: id });
      } catch (cause: unknown) {
        if (cause instanceof client.ApiException && cause.code === 404) {
          return { found: false };
        }
        throw cause;
      }
      const parsed = issueResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error(`the answer for ${id} is not an issue with a recognisable state: ${parsed.error.message}`);
      }
      if (parsed.data.data.id !== id) {
        throw new Error(`the answer for ${id} is issue ${parsed.data.data.id}`);
      }
      return { found: true, state: parsed.data.data.attributes.state };
    },
    setState: async ({ id, state }) => {
      await errorTracking.updateIssueState({
        body: { data: { attributes: { state }, id, type: "error_tracking_issue" } },
        issueId: id,
      });
    },
  };
}
