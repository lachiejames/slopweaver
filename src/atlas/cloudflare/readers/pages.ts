/**
 * The Cloudflare Pages readers: the account-level project inventory (a flat collection, cursor-exhausted),
 * and one project's combined deployments+domains read (a parent fan-out — see `projection/pages.ts`'s header
 * for why the two collections are read and folded together as one atomic per-project attempt).
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflarePagesRawChildItem, CloudflareRawPagesProject } from "../projection/pages.js";

/**
 * Read the account's Pages project inventory, exhausting pagination.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @returns every project's metadata, or the reason the read failed
 */
export async function readCloudflarePagesProjectInventory({
  client,
  accountId,
}: {
  client: Cloudflare;
  accountId: string;
}): Promise<Result<readonly CloudflareRawPagesProject[], CloudflareClientError>> {
  const projects: CloudflareRawPagesProject[] = [];
  try {
    for await (const project of client.pages.projects.list({ account_id: accountId })) {
      if (typeof project.id !== "string" || project.id.length === 0) {
        continue;
      }
      projects.push({ ...project, id: project.id });
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "pages-projects-list" }));
  }
  return ok(projects);
}

/**
 * Read one Pages project's deployments (cursor-exhausted by the SDK) and custom domains (a single,
 * non-paginated page) as one combined, atomic attempt — a failure in either collection fails the whole
 * project's read rather than preserving one collection while losing the other.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param projectName the project's own name — Pages addresses deployments/domains by name, never by id
 * @returns every deployment and domain this project currently has, or the reason the read failed
 */
export async function readCloudflarePagesProjectChildren({
  client,
  accountId,
  projectName,
}: {
  client: Cloudflare;
  accountId: string;
  projectName: string;
}): Promise<Result<readonly CloudflarePagesRawChildItem[], CloudflareClientError>> {
  const items: CloudflarePagesRawChildItem[] = [];
  try {
    for await (const deployment of client.pages.projects.deployments.list(projectName, { account_id: accountId })) {
      items.push({ deployment: { ...deployment }, itemKind: "deployment" });
    }
    for await (const domain of client.pages.projects.domains.list(projectName, { account_id: accountId })) {
      items.push({ domain: { ...domain }, itemKind: "domain" });
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "pages-project-children-list" }));
  }
  return ok(items);
}
