/**
 * The Worker script readers: the account-level script inventory (a flat collection, one `SinglePage` call),
 * and one script's combined settings/bindings/content/deployments/versions/schedules/secrets/subdomain read
 * (a parent fan-out — see `projection/workerScript.ts`'s header for why all eight reads are folded together
 * as one atomic per-script attempt).
 *
 * Source content is read via the plain `scripts.get(scriptName)` call, which returns the script's raw text
 * content directly — not the multipart `scripts.content.get()` endpoint, which returns a full upload bundle
 * (worker.js plus any additional modules) as a raw `Response`. The plain call is what this atlas stores: it
 * captures a single-module Worker's real source in full, by the owner's own explicit choice (see
 * `projection/workerScript.ts`'s header), but does not capture every module of a multi-module bundle — a
 * known, accepted gap rather than an oversight, matching the proportionate scope every other reader in this
 * atlas keeps.
 */
import type Cloudflare from "cloudflare";

import { unsetFieldAsNull } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import { type CloudflareClientError, CloudflareClientErrors } from "../errors.js";
import { isCloudflareRawWorkerDeployment } from "../projection/workerDeployment.js";
import type { CloudflareRawWorkerScript, CloudflareRawWorkerScriptBundle } from "../projection/workerScript.js";

/**
 * The bindings a script's current version declares — none when the settings response omits the list, which
 * the SDK declares optional: a version with no bindings has nothing to list.
 *
 * @param versionSettings the script-and-version settings response
 * @returns the declared bindings, the response's own list when present
 */
function declaredBindings({
  versionSettings,
}: {
  versionSettings: { readonly bindings?: readonly unknown[] };
}): readonly unknown[] {
  const bindings = unsetFieldAsNull({ key: "bindings", record: versionSettings });
  if (bindings === null) {
    return [];
  }
  return bindings;
}

/**
 * The most deployments one page carries. MEASURED against a script declaring more deployments than one page holds:
 * `per_page: 1000` answered 100 with `per_page: 100` echoed back, and the default is 10 — so a read that
 * never pages keeps only the newest 10. Repro: `client.workers.scripts.deployments.list(<script>,
 * { account_id, per_page: 1000 })` and read `result_info`.
 */
const DEPLOYMENTS_PER_PAGE = 100;

/** One deployment, as the bundle stores it. */
type WorkerDeployment = CloudflareRawWorkerScriptBundle["deployments"][number];

/** The totals a deployments page declares in its `result_info`. */
interface DeploymentPaging {
  readonly totalCount: number;
  readonly totalPages: number;
}

/**
 * The deployments one `deployments.list` page carries. `cloudflare` 7.2.0 types this call as a
 * `V4PagePagination`, whose pager reads `result.items`, while still declaring each item as
 * `{ deployments: Deployment[] }` — and the live wire answers `result: { deployments: [...] }` (this atlas's
 * own stored deployments, read under 7.1.0, prove it). Iterating the pager would read ZERO deployments with no
 * error, so each page is awaited and its `result` read defensively: any other shape is a schema error.
 *
 * @param result the awaited page's `result`, as the wire sent it
 * @returns every deployment, or a schema error naming the shape that arrived
 */
function listedDeployments({
  result,
}: {
  result: unknown;
}): Result<readonly WorkerDeployment[], CloudflareClientError> {
  const deployments = isRecord(result) ? result["deployments"] : undefined;
  if (!Array.isArray(deployments)) {
    const keys = isRecord(result) ? Object.keys(result).join(", ") : typeof result;
    return err(
      CloudflareClientErrors.schema({
        cause: new Error(`expected result.deployments to be an array, got result keys: ${keys}`),
        operation: "workers-script-deployments-list",
      }),
    );
  }
  const items: readonly unknown[] = deployments;
  if (!items.every(isCloudflareRawWorkerDeployment)) {
    const index = items.findIndex((item) => !isCloudflareRawWorkerDeployment(item));
    return err(
      CloudflareClientErrors.schema({
        cause: new Error(`deployment ${String(index)} lacks a string id or carries a malformed field`),
        operation: "workers-script-deployments-list",
      }),
    );
  }
  return ok(items);
}

/**
 * The paging a deployments page declares — required, because it is the only way to know a read is whole. A
 * page count other than the one its own total fills at {@link DEPLOYMENTS_PER_PAGE} a page contradicts itself,
 * so it is a schema error too: an empty first page declaring zero deployments over two pages would otherwise
 * read whole without page 2 ever being asked for. An empty script may declare zero pages or one.
 *
 * @param resultInfo the page's `result_info`, as the wire sent it
 * @returns the declared total count and total pages, or a schema error when either is missing or they disagree
 */
function declaredDeploymentPaging({
  resultInfo,
}: {
  resultInfo: unknown;
}): Result<DeploymentPaging, CloudflareClientError> {
  if (
    !isRecord(resultInfo) ||
    typeof resultInfo["total_count"] !== "number" ||
    typeof resultInfo["total_pages"] !== "number"
  ) {
    return err(
      CloudflareClientErrors.schema({
        cause: new Error("expected result_info to declare a numeric total_count and total_pages"),
        operation: "workers-script-deployments-list",
      }),
    );
  }
  const totalCount = resultInfo["total_count"];
  const totalPages = resultInfo["total_pages"];
  const pagesTheCountFills = Math.ceil(totalCount / DEPLOYMENTS_PER_PAGE);
  const emptyDeclaredAsOnePage = totalCount === 0 && totalPages === 1;
  if (totalPages !== pagesTheCountFills && !emptyDeclaredAsOnePage) {
    return err(
      CloudflareClientErrors.schema({
        cause: new Error(
          `result_info declares ${String(totalPages)} pages for ${String(totalCount)} deployments at ${String(DEPLOYMENTS_PER_PAGE)} a page`,
        ),
        operation: "workers-script-deployments-list",
      }),
    );
  }
  return ok({ totalCount, totalPages });
}

/**
 * A deployments read that did not add up, as the schema error every check below returns.
 *
 * @param message what did not add up, in the words the error carries
 * @returns the schema error, labelled with the deployments list's operation
 */
function deploymentsSchemaError({ message }: { message: string }): CloudflareClientError {
  return CloudflareClientErrors.schema({ cause: new Error(message), operation: "workers-script-deployments-list" });
}

/**
 * Request one page of a script's deployments and read both halves of it: the deployments and the paging the
 * page declares.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param scriptName the script whose deployments to read
 * @param page the 1-based page to request
 * @returns the page's deployments and declared paging, or a schema error naming which half did not read
 */
async function readDeploymentsPage({
  client,
  accountId,
  scriptName,
  page,
}: {
  client: Cloudflare;
  accountId: string;
  scriptName: string;
  page: number;
}): Promise<
  Result<
    { readonly deployments: readonly WorkerDeployment[]; readonly paging: DeploymentPaging },
    CloudflareClientError
  >
> {
  const listed = await client.workers.scripts.deployments.list(scriptName, {
    account_id: accountId,
    page,
    per_page: DEPLOYMENTS_PER_PAGE,
  });
  const result: unknown = listed.result;
  const deployments = listedDeployments({ result });
  if (deployments.isErr()) {
    return err(deployments.error);
  }
  const resultInfo: unknown = listed.result_info;
  const paging = declaredDeploymentPaging({ resultInfo });
  if (paging.isErr()) {
    return err(paging.error);
  }
  return ok({ deployments: deployments.value, paging: paging.value });
}

/**
 * What a later page contradicts in the read so far: totals other than page 1's, or a deployment id already
 * read, on this page or an earlier one. Each id this page carries is added to `readIds` as it is checked.
 *
 * @param page the 1-based page number, for the message
 * @param paging the paging this page declares
 * @param declared the paging page 1 declared, the read's contract
 * @param deployments this page's deployments
 * @param readIds every deployment id read so far, extended in place
 * @returns the schema error naming the contradiction, or null when the page is consistent with the read
 */
function pageContradiction({
  page,
  paging,
  declared,
  deployments,
  readIds,
}: {
  page: number;
  paging: DeploymentPaging;
  declared: DeploymentPaging;
  deployments: readonly WorkerDeployment[];
  readIds: Set<string>;
}): CloudflareClientError | null {
  if (paging.totalCount !== declared.totalCount || paging.totalPages !== declared.totalPages) {
    return deploymentsSchemaError({
      message: `page ${String(page)} declares ${String(paging.totalCount)} deployments over ${String(paging.totalPages)} pages, page 1 declared ${String(declared.totalCount)} over ${String(declared.totalPages)}`,
    });
  }
  for (const deployment of deployments) {
    if (readIds.has(deployment.id)) {
      return deploymentsSchemaError({
        message: `page ${String(page)} repeats deployment ${deployment.id}, so the pages shifted mid-read or a page doubled an entry`,
      });
    }
    readIds.add(deployment.id);
  }
  return null;
}

/**
 * Read every deployment of one script, page by page. The SDK's pager cannot do it (it reads `result.items`,
 * see {@link listedDeployments}), so this requests `page` up to the declared `total_pages` and then requires
 * the deployments read to number exactly the declared `total_count`: a wire ignoring `page` reads too many, a
 * deployment landing mid-read shifts a page, and either is a schema error rather than a history stored short
 * or doubled. Page 1's declared totals are the read's contract: a later page declaring others is a schema error
 * too, so a total that shrinks mid-read cannot pass a short history, and so is any deployment id read twice,
 * on one page or across two — the offset shift a deploy landing mid-read causes. The residue is a shift that repeats nothing,
 * which no field on the wire distinguishes from a stable read. Reading past `total_count` stops at once,
 * so a wire repeating itself under a huge `total_pages` cannot keep the loop paging. A throw is left to the
 * caller's own mapping.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param scriptName the script whose deployments to read
 * @returns every deployment, or a schema error naming what did not add up
 */
async function readAllDeployments({
  client,
  accountId,
  scriptName,
}: {
  client: Cloudflare;
  accountId: string;
  scriptName: string;
}): Promise<Result<readonly WorkerDeployment[], CloudflareClientError>> {
  const first = await readDeploymentsPage({ accountId, client, page: 1, scriptName });
  if (first.isErr()) {
    return err(first.error);
  }
  const declared = first.value.paging;
  const deployments: WorkerDeployment[] = [];
  const readIds = new Set<string>();
  let current = first.value;
  for (let page = 1; ; page += 1) {
    const contradiction = pageContradiction({
      declared,
      deployments: current.deployments,
      page,
      paging: current.paging,
      readIds,
    });
    if (contradiction !== null) {
      return err(contradiction);
    }
    deployments.push(...current.deployments);
    const morePages =
      deployments.length <= declared.totalCount && current.deployments.length > 0 && page < declared.totalPages;
    if (!morePages) {
      break;
    }
    const next = await readDeploymentsPage({ accountId, client, page: page + 1, scriptName });
    if (next.isErr()) {
      return err(next.error);
    }
    current = next.value;
  }
  if (deployments.length !== declared.totalCount) {
    return err(
      deploymentsSchemaError({
        message: `read ${String(deployments.length)} of the ${String(declared.totalCount)} deployments the endpoint declares`,
      }),
    );
  }
  return ok(deployments);
}

/**
 * Read the account's Worker script inventory, exhausting pagination.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @returns every script's metadata, or the reason the read failed
 */
export async function readCloudflareWorkerScriptInventory({
  client,
  accountId,
}: {
  client: Cloudflare;
  accountId: string;
}): Promise<Result<readonly CloudflareRawWorkerScript[], CloudflareClientError>> {
  const scripts: CloudflareRawWorkerScript[] = [];
  try {
    for await (const script of client.workers.scripts.list({ account_id: accountId })) {
      if (typeof script.id !== "string" || script.id.length === 0) {
        continue;
      }
      scripts.push({ ...script, id: script.id });
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "workers-scripts-list" }));
  }
  return ok(scripts);
}

/**
 * Read one script's combined settings, bindings, content, deployments, versions, schedules, secrets and
 * subdomain state as one atomic attempt — a failure in any single read fails the whole bundle, rather than
 * preserving some collections while losing others.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param scriptName the script's own name — Workers addresses every sub-resource by name
 * @returns a one-element array holding the combined bundle, or the reason any read failed
 */
export async function readCloudflareWorkerScriptBundle({
  client,
  accountId,
  scriptName,
}: {
  client: Cloudflare;
  accountId: string;
  scriptName: string;
}): Promise<Result<readonly CloudflareRawWorkerScriptBundle[], CloudflareClientError>> {
  try {
    const [settings, versionSettings, content, deployments, schedules, subdomain] = await Promise.all([
      client.workers.scripts.settings.get(scriptName, { account_id: accountId }),
      client.workers.scripts.scriptAndVersionSettings.get(scriptName, { account_id: accountId }),
      client.workers.scripts.get(scriptName, { account_id: accountId }),
      readAllDeployments({ accountId, client, scriptName }),
      client.workers.scripts.schedules.get(scriptName, { account_id: accountId }),
      client.workers.scripts.subdomain.get(scriptName, { account_id: accountId }),
    ]);
    if (deployments.isErr()) {
      return err(deployments.error);
    }
    const versions: CloudflareRawWorkerScriptBundle["versions"][number][] = [];
    for await (const version of client.workers.scripts.versions.list(scriptName, { account_id: accountId })) {
      const { metadata, ...rest } = version;
      versions.push(metadata === undefined ? rest : { ...rest, metadata: { ...metadata } });
    }
    const secrets: CloudflareRawWorkerScriptBundle["secrets"][number][] = [];
    for await (const secret of client.workers.scripts.secrets.list(scriptName, { account_id: accountId })) {
      secrets.push({ ...secret });
    }
    return ok([
      {
        bindings: declaredBindings({ versionSettings }),
        content,
        deployments: deployments.value,
        schedules: schedules.schedules,
        secrets,
        settings: { ...settings },
        subdomainEnabled: subdomain.enabled,
        subdomainPreviewsEnabled: subdomain.previews_enabled,
        versions,
      },
    ]);
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "workers-script-bundle" }));
  }
}
