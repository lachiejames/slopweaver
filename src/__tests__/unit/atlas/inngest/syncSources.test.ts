import { describe, expect, it } from "vitest";

import type { InngestDashboardRoute } from "../../../../atlas/inngest/dashboardRoutes.js";
import { InngestAtlasErrors, inngestAtlasErrorLines } from "../../../../atlas/inngest/errors.js";
import { probeInngestV1 } from "../../../../atlas/inngest/probe.js";
import {
  INNGEST_V1_ABSENT_CONTROLS,
  INNGEST_V1_ADDRESSES,
  INNGEST_V1_CONTROLS,
} from "../../../../atlas/inngest/restAddresses.js";
import { readInngestPublishedSources, sweepInngestProbes } from "../../../../atlas/inngest/syncSources.js";
import type {
  InngestDocumentTransport,
  InngestProbeAnswer,
  InngestProbeTransport,
} from "../../../../atlas/inngest/transport.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";

const CATALOGUE = [
  "# Inngest API",
  "- v1",
  "  - **Events**",
  "  - [List events](/v1/events/ListEvents): Fetches recent events.",
  "  - **Webhooks**",
  "  - [Create webhook](/v1/webhooks/CreateWebhook): Create a new webhook endpoint.",
  "- v2",
  "  - **Apps**",
  "  - [Get apps](/v2/apps/GetApps): Lists active apps.",
].join("\n");

const SIGN_IN_PAGE =
  '<link rel="modulepreload" href="/assets/index-AAAA1111.js"/>' +
  '<script>window.__clerk_init_state = {"__signInFallbackRedirectUrl":"/env/production/apps"};</script>';

const BUNDLE_URL = "https://app.inngest.com/assets/index-AAAA1111.js";

const BUNDLE =
  'a=x.update({id:"/settings",path:"/settings",getParentRoute:()=>root}),' +
  'b=y.update({id:"/api-keys/",path:"/api-keys/",getParentRoute:()=>a})';

const DOCUMENTS: Readonly<Record<string, string>> = {
  [BUNDLE_URL]: BUNDLE,
  "https://api-docs.inngest.com/llms.txt": CATALOGUE,
  "https://app.inngest.com/sign-in": SIGN_IN_PAGE,
};

const NOT_FOUND: InngestProbeAnswer = { location: null, status: 404 };

/** One request either transport received, tagged with which transport received it. */
interface Request {
  readonly transport: "document" | "probe";
  readonly url: string;
}

/**
 * Deterministic transports over two address tables. A probe for an address absent from its table answers 404;
 * a probe address mapped to `null` fails at the transport, as an unreachable host would.
 */
function transports({ probes }: { probes: Readonly<Record<string, InngestProbeAnswer | null>> }): {
  documentTransport: InngestDocumentTransport;
  probeTransport: InngestProbeTransport;
  requests: Request[];
} {
  const requests: Request[] = [];
  const documentTransport: InngestDocumentTransport = async ({ url }) => {
    requests.push({ transport: "document", url });
    const text = DOCUMENTS[url];
    if (text === undefined) {
      throw new Error(`no document scripted for ${url}`);
    }
    return ok(text);
  };
  const probeTransport: InngestProbeTransport = async ({ url }) => {
    requests.push({ transport: "probe", url });
    const answer = probes[url];
    if (answer === null) {
      return err(
        inngestAtlasErrorLines({
          error: InngestAtlasErrors.probeFailed({ cause: new Error("connection reset"), url }),
        }),
      );
    }
    if (answer === undefined) {
      return ok(NOT_FOUND);
    }
    return ok(answer);
  };
  return { documentTransport, probeTransport, requests };
}

describe("readInngestPublishedSources", () => {
  it("compiles both documents, lists only the mirror at or above 500 and reads the default environment", async () => {
    const { documentTransport, probeTransport, requests } = transports({
      probes: {
        "https://api-docs.inngest.com/llms-full.txt": { location: null, status: 500 },
        "https://api-docs.inngest.com/v1/events/ListEvents.md": { location: null, status: 499 },
      },
    });

    const sources = unwrap(await readInngestPublishedSources({ documentTransport, probeTransport }));

    expect(sources).toEqual({
      brokenMirrors: ["https://api-docs.inngest.com/llms-full.txt (HTTP 500)"],
      environmentSlug: "production",
      operations: [
        {
          description: "Fetches recent events.",
          group: "Events",
          operationId: "ListEvents",
          referenceUrl: "https://api-docs.inngest.com/v1/events/ListEvents",
          title: "List events",
          version: "v1",
        },
        {
          description: "Create a new webhook endpoint.",
          group: "Webhooks",
          operationId: "CreateWebhook",
          referenceUrl: "https://api-docs.inngest.com/v1/webhooks/CreateWebhook",
          title: "Create webhook",
          version: "v1",
        },
        {
          description: "Lists active apps.",
          group: "Apps",
          operationId: "GetApps",
          referenceUrl: "https://api-docs.inngest.com/v2/apps/GetApps",
          title: "Get apps",
          version: "v2",
        },
      ],
      routes: [
        { parameterised: false, routePath: "/settings", section: "settings" },
        { parameterised: false, routePath: "/settings/api-keys", section: "settings" },
      ],
    });
    expect(requests).toEqual([
      { transport: "document", url: "https://api-docs.inngest.com/llms.txt" },
      { transport: "probe", url: "https://api-docs.inngest.com/llms-full.txt" },
      { transport: "probe", url: "https://api-docs.inngest.com/v1/events/ListEvents.md" },
      { transport: "document", url: "https://app.inngest.com/sign-in" },
      { transport: "document", url: BUNDLE_URL },
    ]);
  });
});

describe("sweepInngestProbes", () => {
  const SETTINGS_ROUTE: InngestDashboardRoute = { parameterised: false, routePath: "/settings", section: "settings" };
  const SWEEP_PROBES: Readonly<Record<string, InngestProbeAnswer | null>> = {
    "https://api.inngest.com/gql": { location: null, status: 422 },
    "https://api.inngest.com/v2/apps": { location: null, status: 401 },
    "https://api.inngest.com/v2/zzzsyntheticzzz-control": { location: null, status: 401 },
    "https://app.inngest.com/settings": { location: "/sign-in?redirect_url=%2Fx", status: 307 },
  };
  const V1_URLS = [
    ...[...INNGEST_V1_CONTROLS, ...INNGEST_V1_ABSENT_CONTROLS].map((path) => `https://api.inngest.com${path}`),
    ...INNGEST_V1_ADDRESSES.map((address) => `https://api.inngest.com${address.probePath}`),
  ];

  it("probes v1, then v2, then the dashboard, then GraphQL, and returns what each established", async () => {
    const { probeTransport, requests } = transports({ probes: SWEEP_PROBES });

    const sweep = unwrap(
      await sweepInngestProbes({ environmentSlug: "production", probeTransport, routes: [SETTINGS_ROUTE] }),
    );

    expect(sweep.v1).toEqual(
      unwrap(await probeInngestV1({ probeTransport: transports({ probes: SWEEP_PROBES }).probeTransport })),
    );
    expect(sweep.v1.controlsDiscriminate).toBe(true);
    expect(sweep.v2).toEqual({
      controlAgrees: true,
      note:
        "GET https://api.inngest.com/v2/zzzsyntheticzzz-control answered 401; GET https://api.inngest.com/v2/apps answered 401" +
        " — the invented address answers exactly what a real one does, so no v2 route's existence can be established without a credential",
    });
    expect(sweep.dashboard).toEqual({
      controlNotes: ["GET https://app.inngest.com/zzzsyntheticzzz-control answered 404"],
      outcomes: new Map([
        [
          "/settings",
          {
            evidence: "exists-sign-in-redirect",
            note: "GET https://app.inngest.com/settings answered 307 → /sign-in?redirect_url=%2Fx",
          },
        ],
      ]),
      probedUrls: new Map([["/settings", "https://app.inngest.com/settings"]]),
    });
    expect(sweep.graphql).toEqual({
      note: "GET https://api.inngest.com/gql answered 422 to a request carrying no document",
      reachable: true,
    });
    expect(requests.map(({ url }) => url)).toEqual([
      ...V1_URLS,
      "https://api.inngest.com/v2/zzzsyntheticzzz-control",
      "https://api.inngest.com/v2/apps",
      "https://app.inngest.com/zzzsyntheticzzz-control",
      "https://app.inngest.com/settings",
      "https://api.inngest.com/gql",
    ]);
  });

  it("stops at a v2 transport failure, returning its lines and probing neither the dashboard nor GraphQL", async () => {
    const failing = "https://api.inngest.com/v2/zzzsyntheticzzz-control";
    const { probeTransport, requests } = transports({ probes: { ...SWEEP_PROBES, [failing]: null } });

    const lines = unwrapErr(
      await sweepInngestProbes({ environmentSlug: "production", probeTransport, routes: [SETTINGS_ROUTE] }),
    );

    expect(lines).toEqual(["https://api.inngest.com/v2/zzzsyntheticzzz-control could not be probed: connection reset"]);
    expect(lines).toEqual(
      inngestAtlasErrorLines({
        error: InngestAtlasErrors.probeFailed({ cause: new Error("connection reset"), url: failing }),
      }),
    );
    expect(requests.map(({ url }) => url)).toEqual([...V1_URLS, failing]);
  });
});
