/**
 * The two network passes one sync makes, each behind a single call.
 *
 * `sync.ts` owns what a run does with what it learned. What is here is the LEARNING — read the two published
 * documents and compile them, then run every probe — and separating them is what keeps the run readable:
 * either half fails as a whole, so a caller has two failure points rather than nine.
 *
 * Both take the transports as arguments, so both are provable against deterministic fakes and only
 * `transport.ts` ever reaches the network.
 */
import { err, ok, type Result } from "../../lib/result.js";

import {
  compileDashboardRoutes,
  defaultEnvironmentSlug,
  entryBundleUrl,
  INNGEST_DASHBOARD_BOOTSTRAP_URL,
  type InngestDashboardRoute,
} from "./dashboardRoutes.js";
import { type InngestGraphqlProbeResult, probeInngestGraphql } from "./graphqlEndpoint.js";
import {
  type InngestDashboardProbeResult,
  type InngestV1ProbeResult,
  type InngestV2ProbeResult,
  probeInngestDashboard,
  probeInngestV1,
  probeInngestV2Control,
} from "./probe.js";
import {
  compileInngestCatalogue,
  INNGEST_MARKDOWN_MIRROR_URLS,
  INNGEST_REST_CATALOGUE_URL,
  type InngestCatalogueOperation,
} from "./restCatalogue.js";
import type { InngestDocumentTransport, InngestProbeTransport } from "./transport.js";

/** The lowest status this atlas reads as the vendor's own server failing. */
const SERVER_ERROR_FLOOR = 500;

/**
 * What one run read out of the two documents Inngest publishes to anybody.
 *
 * @internal
 */
export interface InngestPublishedSources {
  /** The mirror addresses that answered a server error, each with the status, or empty when both answered. */
  readonly brokenMirrors: readonly string[];
  /** The default environment slug the sign-in page named, or `null` when it named none. */
  readonly environmentSlug: string | null;
  readonly operations: readonly InngestCatalogueOperation[];
  readonly routes: readonly InngestDashboardRoute[];
}

/**
 * Read and compile the published REST catalogue and the dashboard's own route table.
 *
 * @param documentTransport how a document's bytes are obtained
 * @param probeTransport how the markdown mirror's status is obtained
 * @returns everything the published surfaces established, or the first reason none of it could be read
 *
 * @internal
 */
export async function readInngestPublishedSources({
  documentTransport,
  probeTransport,
}: {
  documentTransport: InngestDocumentTransport;
  probeTransport: InngestProbeTransport;
}): Promise<Result<InngestPublishedSources>> {
  const catalogueText = await documentTransport({ url: INNGEST_REST_CATALOGUE_URL });
  if (catalogueText.isErr()) {
    return err(catalogueText.error);
  }
  const catalogue = compileInngestCatalogue({ text: catalogueText.value });
  if (catalogue.isErr()) {
    return err(catalogue.error);
  }
  const brokenMirrors: string[] = [];
  for (const url of INNGEST_MARKDOWN_MIRROR_URLS) {
    const answer = await probeTransport({ url });
    if (answer.isOk() && answer.value.status >= SERVER_ERROR_FLOOR) {
      brokenMirrors.push(`${url} (HTTP ${String(answer.value.status)})`);
    }
  }
  const bootstrap = await documentTransport({ url: INNGEST_DASHBOARD_BOOTSTRAP_URL });
  if (bootstrap.isErr()) {
    return err(bootstrap.error);
  }
  const bundleUrl = entryBundleUrl({ html: bootstrap.value });
  if (bundleUrl.isErr()) {
    return err(bundleUrl.error);
  }
  const bundle = await documentTransport({ url: bundleUrl.value });
  if (bundle.isErr()) {
    return err(bundle.error);
  }
  const routes = compileDashboardRoutes({ bundle: bundle.value });
  if (routes.isErr()) {
    return err(routes.error);
  }
  return ok({
    brokenMirrors,
    environmentSlug: defaultEnvironmentSlug({ html: bootstrap.value }),
    operations: catalogue.value.operations,
    routes: routes.value,
  });
}

/**
 * What every probe one run sent established.
 *
 * @internal
 */
export interface InngestProbeSweep {
  readonly dashboard: InngestDashboardProbeResult;
  readonly graphql: InngestGraphqlProbeResult;
  readonly v1: InngestV1ProbeResult;
  readonly v2: InngestV2ProbeResult;
}

/**
 * Run every probe this atlas sends, in the order their controls require.
 *
 * @param routes the routes the dashboard's own table declares
 * @param environmentSlug the slug the sign-in page named, or `null`
 * @param probeTransport how an address's answer is obtained
 * @returns what every probe established, or the first reason a request could not be made at all
 *
 * @internal
 */
export async function sweepInngestProbes({
  routes,
  environmentSlug,
  probeTransport,
}: {
  routes: readonly InngestDashboardRoute[];
  environmentSlug: string | null;
  probeTransport: InngestProbeTransport;
}): Promise<Result<InngestProbeSweep>> {
  const v1 = await probeInngestV1({ probeTransport });
  if (v1.isErr()) {
    return err(v1.error);
  }
  const v2 = await probeInngestV2Control({ probeTransport });
  if (v2.isErr()) {
    return err(v2.error);
  }
  const dashboard = await probeInngestDashboard({ environmentSlug, probeTransport, routes });
  if (dashboard.isErr()) {
    return err(dashboard.error);
  }
  const graphql = await probeInngestGraphql({ probeTransport });
  if (graphql.isErr()) {
    return err(graphql.error);
  }
  return ok({ dashboard: dashboard.value, graphql: graphql.value, v1: v1.value, v2: v2.value });
}
