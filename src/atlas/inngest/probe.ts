/**
 * Running the unauthenticated probes, and the controls that decide whether any of them mean anything.
 *
 * The transport is a seam ({@link InngestProbeTransport}), so what a status means is provable against a fake
 * and only {@link httpProbeTransport} ever reaches the network. What is genuinely here is the ORDER: a
 * control is probed before the addresses it governs, and an address whose control agreed is never credited
 * with existence however it answered.
 */
import { ok, type Result } from "../../lib/result.js";

import {
  controlPathFor,
  controlPrefixFor,
  INNGEST_DASHBOARD_ORIGIN,
  type InngestDashboardRoute,
  probePathFor,
} from "./dashboardRoutes.js";
import type { InngestProbeOutcome } from "./projection.js";
import {
  INNGEST_V1_ABSENT_CONTROLS,
  INNGEST_V1_ADDRESSES,
  INNGEST_V1_CONTROLS,
  INNGEST_V2_CONTROL,
  INNGEST_V2_REFERENCE_ADDRESS,
  v1EvidenceOf,
} from "./restAddresses.js";
import { INNGEST_REST_ORIGIN, inngestOperationProviderId } from "./restCatalogue.js";
import type { InngestProbeTransport } from "./transport.js";

/** The status a route that does not exist answers, on every surface probed here. */
const NOT_FOUND = 404;

/** What one address answered, reduced to the line a `probeNote` carries. */
function noteOf({ url, status, location }: { url: string; status: number; location: string | null }): string {
  const suffix = location === null ? "" : ` → ${location}`;
  return `GET ${url} answered ${String(status)}${suffix}`;
}

/** Everything the v1 probe established, keyed by PROVIDER ID — `v1 <operationId>`, never the id alone. */
export interface InngestV1ProbeResult {
  /** Every control's own note, kept so a reader can check the method rather than trust it. */
  readonly controlNotes: readonly string[];
  /** True when every invented v1 address answered 404, which is what makes the rest mean anything. */
  readonly controlsDiscriminate: boolean;
  /**
   * One outcome per catalogue operation the reviewed table claims an address for, keyed by
   * `inngestOperationProviderId` rather than by the operation id.
   *
   * MEASURED while building this: `CancelRun`, `CreateWebhook` and `ListWebhooks` each exist in BOTH published
   * versions against different addresses, so a map keyed on the id alone had v2's pass silently overwrite
   * v1's evidence for all three — three rows reporting the v2 control's note about an address v1 discriminates
   * on. It is the same collision `restCatalogue.ts`'s provider key exists to prevent, arrived at from the
   * other direction.
   */
  readonly outcomes: ReadonlyMap<string, InngestProbeOutcome>;
}

/**
 * Probe every invented v1 address, and report whether they all answered 404.
 *
 * Split out because it is the half that decides whether anything else in the v1 pass means anything, and a
 * reader should be able to see it without the address loop beside it.
 *
 * @param probeTransport how an address's answer is obtained
 * @returns each control's own note and whether they all answered 404, or why a request could not be made
 */
async function probeV1Controls({
  probeTransport,
}: {
  probeTransport: InngestProbeTransport;
}): Promise<Result<{ notes: readonly string[]; discriminates: boolean }>> {
  const notes: string[] = [];
  let discriminates = true;
  for (const path of [...INNGEST_V1_CONTROLS, ...INNGEST_V1_ABSENT_CONTROLS]) {
    const url = `${INNGEST_REST_ORIGIN}${path}`;
    const answer = await probeTransport({ url });
    if (answer.isErr()) {
      return answer.map(() => ({ discriminates: false, notes: [] }));
    }
    notes.push(noteOf({ location: answer.value.location, status: answer.value.status, url }));
    if (answer.value.status !== NOT_FOUND) {
      discriminates = false;
    }
  }
  return ok({ discriminates, notes });
}

/**
 * Probe the v1 REST surface: its controls first, then every reviewed address.
 *
 * @param probeTransport how an address's answer is obtained
 * @returns what was established, or why a request could not be made at all
 */
export async function probeInngestV1({
  probeTransport,
}: {
  probeTransport: InngestProbeTransport;
}): Promise<Result<InngestV1ProbeResult>> {
  const controls = await probeV1Controls({ probeTransport });
  if (controls.isErr()) {
    return controls.map(() => ({ controlNotes: [], controlsDiscriminate: false, outcomes: new Map() }));
  }
  const { discriminates, notes } = controls.value;
  const outcomes = new Map<string, InngestProbeOutcome>();
  for (const address of INNGEST_V1_ADDRESSES) {
    const url = `${INNGEST_REST_ORIGIN}${address.probePath}`;
    const answer = await probeTransport({ url });
    const outcome: InngestProbeOutcome = answer.isErr()
      ? { evidence: "probe-failed", note: answer.error.join("; ") }
      : {
          evidence: discriminates ? v1EvidenceOf({ status: answer.value.status }) : "unprobeable-control-agrees",
          note:
            `${noteOf({ location: answer.value.location, status: answer.value.status, url })} ` +
            `(path shape ${address.pathShape}, address REVIEWED rather than vendor-declared)`,
        };
    for (const operationId of address.operationIds) {
      outcomes.set(inngestOperationProviderId({ operation: { operationId, version: "v1" } }), outcome);
    }
  }
  return ok({ controlNotes: notes, controlsDiscriminate: discriminates, outcomes });
}

/** What the v2 control established — which on this surface is that nothing can be. */
export interface InngestV2ProbeResult {
  /** True when the invented address answered exactly what a real one did, so no v2 route is probeable. */
  readonly controlAgrees: boolean;
  readonly note: string;
}

/**
 * Probe the v2 REST surface's control against one real v2 address.
 *
 * MEASURED: both answer `401 authorization_header_missing`, so this returns `controlAgrees` and
 * every v2 operation is recorded `unprobeable-control-agrees`. The DISAGREEMENT is the interesting direction
 * — it would mean v2 had begun routing before authenticating, and a real v2 route census became compilable.
 *
 * @param probeTransport how an address's answer is obtained
 * @returns what the control established, or why a request could not be made at all
 */
export async function probeInngestV2Control({
  probeTransport,
}: {
  probeTransport: InngestProbeTransport;
}): Promise<Result<InngestV2ProbeResult>> {
  const controlUrl = `${INNGEST_REST_ORIGIN}${INNGEST_V2_CONTROL}`;
  const realUrl = `${INNGEST_REST_ORIGIN}${INNGEST_V2_REFERENCE_ADDRESS}`;
  const control = await probeTransport({ url: controlUrl });
  if (control.isErr()) {
    return control.map(() => ({ controlAgrees: false, note: "" }));
  }
  const real = await probeTransport({ url: realUrl });
  if (real.isErr()) {
    return real.map(() => ({ controlAgrees: false, note: "" }));
  }
  const agrees = control.value.status === real.value.status;
  return ok({
    controlAgrees: agrees,
    note:
      `${noteOf({ location: control.value.location, status: control.value.status, url: controlUrl })}; ` +
      `${noteOf({ location: real.value.location, status: real.value.status, url: realUrl })}` +
      (agrees
        ? " — the invented address answers exactly what a real one does, so no v2 route's existence can be established without a credential"
        : " — the invented address now answers differently, so v2 has begun discriminating and a real route census is compilable"),
  });
}

/** What the dashboard probe established, per declared route. */
export interface InngestDashboardProbeResult {
  /** Every control's own note, one per parent prefix visited. */
  readonly controlNotes: readonly string[];
  /** One outcome per declared route, keyed by the route's own path. */
  readonly outcomes: ReadonlyMap<string, InngestProbeOutcome>;
  /** The concrete address each route was probed at, keyed by the route's own path. */
  readonly probedUrls: ReadonlyMap<string, string | null>;
}

/** The evidence a dashboard answer earns, once its own prefix has been shown to discriminate. */
function dashboardEvidenceOf({ status }: { status: number }): InngestProbeOutcome["evidence"] {
  const OK = 200;
  const REDIRECT_FLOOR = 300;
  const REDIRECT_CEILING = 400;
  const SERVER_ERROR = 500;
  if (status === NOT_FOUND) {
    return "absent-404";
  }
  if (status >= REDIRECT_FLOOR && status < REDIRECT_CEILING) {
    return "exists-sign-in-redirect";
  }
  if (status === OK) {
    return "exists-unauthenticated";
  }
  if (status >= SERVER_ERROR) {
    return "probe-failed";
  }
  return "exists-auth-required";
}

/**
 * The concrete address each declared route is probed at, and the absolute URL a reader would open.
 *
 * @param routes every route the application's own table declares
 * @param environmentSlug the slug the application named, or `null`
 * @returns the probeable paths, and one entry per route for what a reader would open
 */
function dashboardAddresses({
  routes,
  environmentSlug,
}: {
  routes: readonly InngestDashboardRoute[];
  environmentSlug: string | null;
}): { paths: ReadonlyMap<string, string>; probedUrls: ReadonlyMap<string, string | null> } {
  const paths = new Map<string, string>();
  const probedUrls = new Map<string, string | null>();
  for (const route of routes) {
    const path = probePathFor({ environmentSlug, route });
    probedUrls.set(route.routePath, path === null ? null : `${INNGEST_DASHBOARD_ORIGIN}${path}`);
    if (path !== null) {
      paths.set(route.routePath, path);
    }
  }
  return { paths, probedUrls };
}

/**
 * Probe one control per parent prefix, and report which prefixes discriminate.
 *
 * @param paths the concrete addresses this run is about to visit
 * @param probeTransport how an address's answer is obtained
 * @returns each control's note and its prefix's verdict, or why a request could not be made
 */
async function dashboardControls({
  paths,
  probeTransport,
}: {
  paths: ReadonlyMap<string, string>;
  probeTransport: InngestProbeTransport;
}): Promise<Result<{ notes: readonly string[]; discriminates: ReadonlyMap<string, boolean> }>> {
  const notes: string[] = [];
  const discriminates = new Map<string, boolean>();
  for (const prefix of new Set([...paths.values()].map((path) => controlPrefixFor({ path })))) {
    const url = `${INNGEST_DASHBOARD_ORIGIN}${controlPathFor({ prefix })}`;
    const answer = await probeTransport({ url });
    if (answer.isErr()) {
      return answer.map(() => ({ discriminates: new Map<string, boolean>(), notes: [] }));
    }
    notes.push(noteOf({ location: answer.value.location, status: answer.value.status, url }));
    discriminates.set(prefix, answer.value.status === NOT_FOUND);
  }
  return ok({ discriminates, notes });
}

/**
 * Why one route carries no concrete address at all.
 *
 * @param route the declared route
 * @param environmentSlug the slug the application named, or `null`
 * @returns the sentence a `unprobeable-parameterised` outcome carries
 */
function noAddressBecause({
  route,
  environmentSlug,
}: {
  route: InngestDashboardRoute;
  environmentSlug: string | null;
}): string {
  if (environmentSlug === null && route.routePath.includes("$envSlug")) {
    return "the sign-in page named no default environment slug, so this route has no concrete address to probe";
  }
  return "the route carries an identifier segment this atlas will not invent, so it has no concrete address";
}

/**
 * Probe every declared dashboard route, taking a control at each parent prefix first.
 *
 * A prefix whose control answers anything but 404 is serving the same answer to any address at all, so every
 * route under it is `unprobeable-control-agrees` however it answered — see `dashboardRoutes.ts` for the
 * measurement that makes this the rule rather than a precaution.
 *
 * @param routes every route the application's own table declares
 * @param environmentSlug the default environment slug the application named, or `null`
 * @param probeTransport how an address's answer is obtained
 * @returns what was established per route, or why a request could not be made at all
 */
export async function probeInngestDashboard({
  routes,
  environmentSlug,
  probeTransport,
}: {
  routes: readonly InngestDashboardRoute[];
  environmentSlug: string | null;
  probeTransport: InngestProbeTransport;
}): Promise<Result<InngestDashboardProbeResult>> {
  const { paths, probedUrls } = dashboardAddresses({ environmentSlug, routes });
  const controls = await dashboardControls({ paths, probeTransport });
  if (controls.isErr()) {
    return controls.map(() => ({ controlNotes: [], outcomes: new Map(), probedUrls: new Map() }));
  }
  const outcomes = new Map<string, InngestProbeOutcome>();
  for (const route of routes) {
    const path = paths.get(route.routePath);
    if (path === undefined) {
      outcomes.set(route.routePath, {
        evidence: "unprobeable-parameterised",
        note: noAddressBecause({ environmentSlug, route }),
      });
      continue;
    }
    const url = `${INNGEST_DASHBOARD_ORIGIN}${path}`;
    const answer = await probeTransport({ url });
    if (answer.isErr()) {
      outcomes.set(route.routePath, { evidence: "probe-failed", note: answer.error.join("; ") });
      continue;
    }
    const note = noteOf({ location: answer.value.location, status: answer.value.status, url });
    const open = controls.value.discriminates.get(controlPrefixFor({ path })) === true;
    outcomes.set(route.routePath, {
      evidence: open ? dashboardEvidenceOf({ status: answer.value.status }) : "unprobeable-control-agrees",
      note: open
        ? note
        : `${note} — but the invented control under this prefix answers the same, so nothing is established`,
    });
  }
  return ok({ controlNotes: controls.value.notes, outcomes, probedUrls });
}
