/**
 * One Worker deployment's raw shape, and the runtime check that admits one. The reader validates every listed
 * deployment because `cloudflare` 7.2.0's own types for `deployments.list` contradict the live wire — see
 * `readers/workerScript.ts`'s `listedDeployments` — so the shape the `worker-script` bundle stores
 * (`projection/workerScript.ts`) is the one this module proves, not the one the SDK declares for the call.
 */
import { isRecord } from "../../../lib/parsers.js";

/** One deployment, as the wire's `result.deployments` carries it (one wrapped array, read whole). */
export interface CloudflareRawWorkerDeployment {
  readonly id: string;
  readonly created_on?: string;
  readonly source?: string;
  readonly strategy?: string;
  readonly versions?: readonly { readonly percentage: number; readonly version_id: string }[];
  readonly annotations?: { readonly "workers/message"?: string; readonly "workers/triggered_by"?: string };
  readonly author_email?: string;
}

/**
 * Whether a field is absent or a string — the check every optional string of a deployment gets.
 *
 * @param value the field's raw value
 * @returns true when the field is undefined or a string
 */
function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/**
 * Whether one listed version is the `{ percentage, version_id }` pair a deployment routes traffic by.
 *
 * @param value one element of a deployment's `versions`
 * @returns true when it carries a numeric percentage and a string version id
 */
function isDeploymentVersion(value: unknown): value is { readonly percentage: number; readonly version_id: string } {
  return isRecord(value) && typeof value["percentage"] === "number" && typeof value["version_id"] === "string";
}

/**
 * Narrow one element of a `deployments.list` response into the raw deployment the projection reads. The check
 * is the SDK's own declared `Deployment`, held STRICT: `id`, `created_on`, `source`, the `percentage` strategy
 * and `versions` are required there and the live wire carries every one, so a deployment missing one, or
 * naming a strategy the SDK has not declared, is drift to surface rather than a record to store half-read.
 *
 * @param value one listed deployment, as the wire sent it
 * @returns true when the deployment matches the SDK's declared shape
 */
export function isCloudflareRawWorkerDeployment(value: unknown): value is CloudflareRawWorkerDeployment {
  if (!isRecord(value) || typeof value["id"] !== "string" || value["id"].length === 0) {
    return false;
  }
  const versions = value["versions"];
  const annotations = value["annotations"];
  return (
    typeof value["created_on"] === "string" &&
    typeof value["source"] === "string" &&
    value["strategy"] === "percentage" &&
    isOptionalString(value["author_email"]) &&
    Array.isArray(versions) &&
    versions.every(isDeploymentVersion) &&
    (annotations === undefined ||
      (isRecord(annotations) &&
        isOptionalString(annotations["workers/message"]) &&
        isOptionalString(annotations["workers/triggered_by"])))
  );
}
