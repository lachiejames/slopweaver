/**
 * Ask the Vanta Manage API which of its 107 documented GET operations this organisation's credential can
 * actually reach, and what each one returns.
 *
 * ```bash
 * yarn tsx tools/probeVantaGetEndpoints.ts            # probe every documented GET, print one row each
 * yarn tsx tools/probeVantaGetEndpoints.ts --json     # the same as one machine-readable report
 * ```
 *
 * ## Why a probe rather than a reading of the document
 *
 * `generated/getEndpoints.ts` says what this atlas DOES with each operation. It does not say what each
 * operation ANSWERS, and those are different questions: an operation nobody called may be a gap worth
 * closing, a route this organisation's entitlement refuses, or a route whose only identifier this account
 * has no way to obtain. A disposition assigned without asking cannot tell those apart, and the whole point
 * of the denominator is that an unasked question is not evidence.
 *
 * ## Identifiers are CHAINED, never synthesised
 *
 * A templated segment is filled from a real response, not from a placeholder: `{documentId}` comes from
 * `GET /documents`, `{uploadedFileId}` from `GET /documents/{documentId}/uploads`, and so on — the source
 * for one parameter is always the path prefix that ends immediately before it. Endpoints are probed
 * shortest-path-first so a parent is always asked before its children. A parameter no reachable parent
 * supplies is reported as `no-identifier`, which is a THIRD answer and not a failure: it says this account
 * cannot construct the request at all, which is exactly what a coverage claim needs to distinguish from a
 * refusal.
 *
 * The one seed is `{slugId}`, which no documented list operation returns — it is taken from the tenant slug
 * this install already holds, and a 404 on it is itself the finding.
 */
import { resolveVantaCommandCredentials } from "../src/atlas/vanta/credentialFiles.js";
import { VANTA_GET_ENDPOINTS, type VantaGetEndpointRow } from "../src/atlas/vanta/generated/getEndpoints.js";
import {
  isVantaHttpError,
  type VantaTransportFailure,
  vantaTransportFailureLines,
} from "../src/atlas/vanta/httpErrors.js";
import { createVantaTokenProvider } from "../src/atlas/vanta/oauth.js";
import { createVantaTransport } from "../src/atlas/vanta/transport.js";
import { slopweaverHome } from "../src/homeDir.js";
import { logger } from "../src/lib/logger.js";
import { isRecord } from "../src/lib/parsers.js";

/** How many rows a probe asks for. Small on purpose: this measures reachability, never content. */
const PROBE_PAGE_SIZE = "1";

/** What one documented GET answered. */
interface VantaProbeRow {
  readonly operationId: string;
  readonly path: string;
  readonly requestedPath: string | null;
  readonly disposition: string;
  readonly tag: string;
  /** The HTTP status, or `null` when the request was never sent. */
  readonly status: number | null;
  /** How many rows a list answer carried, or `null` when the answer was not a list. */
  readonly rows: number | null;
  readonly outcome: "answered" | "refused" | "absent" | "no-identifier" | "fault";
  /** The first row's own field names, so a collection's shape is recorded alongside its reachability. */
  readonly shape: readonly string[];
  readonly note: string;
}

/** Fail loudly. A probe that carries on past a broken assumption reports a reachability nobody measured. */
function refuse(message: string): never {
  process.stderr.write(`probeVantaGetEndpoints: ${message}\n`);
  process.exit(1);
}

/** The path prefix that ends immediately before this parameter — the operation whose answer supplies it. */
function sourcePrefixFor({ path, parameter }: { path: string; parameter: string }): string {
  const marker = `/{${parameter}}`;
  const at = path.indexOf(marker);
  return at < 0 ? path : path.slice(0, at);
}

/** Every `{brace}` parameter in a path template, in the order they appear. */
function parametersOf({ path }: { path: string }): readonly string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map(([, name = ""]) => name);
}

/**
 * The identifying field of one row. `id` is what twelve of the thirteen families key on, but several
 * Manage API collections name theirs after the noun instead — measured, `/integrations` answers
 * `integrationId` and carries no `id` at all, so a harvester reading only `id` reports a reachable child
 * as unreachable. A trailing-`Id` field is taken only when there is exactly one, so a row naming two
 * foreign keys is left alone rather than guessed at.
 */
function idOfRow({ row }: { row: Record<string, unknown> }): string | null {
  const own = row["id"];
  if (typeof own === "string") {
    return own;
  }
  const idish = Object.entries(row).filter(([key, value]) => key.endsWith("Id") && typeof value === "string");
  const only = idish.length === 1 ? idish[0] : undefined;
  return only === undefined ? null : String(only[1]);
}

/** Every row a Vanta answer carries, whether it came back as a page envelope, a bare array or one object. */
function rowsOf({ body }: { body: unknown }): readonly Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.filter((row): row is Record<string, unknown> => isRecord(row));
  }
  if (!isRecord(body)) {
    return [];
  }
  const results = body["results"];
  if (isRecord(results) && Array.isArray(results["data"])) {
    return results["data"].filter((row): row is Record<string, unknown> => isRecord(row));
  }
  if (Array.isArray(results)) {
    return results.filter((row): row is Record<string, unknown> => isRecord(row));
  }
  return [body];
}

/**
 * The value a templated segment takes, from a row of the answer that supplies it.
 *
 * The parameter's OWN name is tried first, because a Manage API sub-collection often names the field after
 * the segment rather than calling it `id` — `/integrations/{integrationId}/resource-kinds` answers rows
 * carrying both `integrationId` and `resourceKind`, and reading only an identifier field fills
 * `{resourceKind}` with an integration id and manufactures a 404.
 */
function segmentValue({ row, parameter }: { row: Record<string, unknown>; parameter: string }): string | null {
  const named = row[parameter];
  if (typeof named === "string") {
    return named;
  }
  // An identifier fallback is only sound for a segment that WANTS an identifier. A Codex review pass found
  // the hole: `/integrations/{integrationId}/resource-kinds` answers rows carrying `integrationId` and, when
  // the row is partial, no `resourceKind` — so a bare sole-`*Id` fallback filled `{resourceKind}` with an
  // integration id and turned the resulting HTTP 404 into a reported `absent`. In an instrument whose whole
  // value is that a 404 means something, a manufactured one is worse than no answer, so a segment that is
  // not itself id-shaped resolves to nothing and the row reports `no-identifier` instead.
  return parameter === "id" || parameter.endsWith("Id") ? idOfRow({ row }) : null;
}

/** How many rows a collection answer carried, or `null` when the answer was a single object. */
function rowsIn({ body }: { body: unknown }): number | null {
  if (Array.isArray(body)) {
    return body.length;
  }
  if (!isRecord(body)) {
    return null;
  }
  const results = body["results"];
  if (isRecord(results) && Array.isArray(results["data"])) {
    return results["data"].length;
  }
  return Array.isArray(results) ? results.length : null;
}

/** The top-level field names one answer carried, so a shape nobody expected is visible rather than silent. */
function shapeOf({ body }: { body: unknown }): readonly string[] {
  return rowsOf({ body })
    .slice(0, 1)
    .flatMap((row) => Object.keys(row).slice(0, 12));
}

/**
 * The HTTP status the provider refused with, read from the failure's typed code, or `null` when the failure
 * was not a refused status (a redirect, an unread body, an unreachable host, a policy refusal).
 */
function refusedStatusOf({ failure }: { failure: VantaTransportFailure }): number | null {
  if (isVantaHttpError(failure) && failure.code === "HTTP_STATUS") {
    return failure.status;
  }
  return null;
}

/** Classify one answered status into the vocabulary a coverage claim can use. */
function outcomeOf({ status }: { status: number }): VantaProbeRow["outcome"] {
  if (status >= 200 && status < 300) {
    return "answered";
  }
  if (status === 401 || status === 403) {
    return "refused";
  }
  if (status === 404) {
    return "absent";
  }
  return "fault";
}

async function main(): Promise<void> {
  const asJson = process.argv.includes("--json");
  const home = slopweaverHome();
  const credentials = resolveVantaCommandCredentials({
    env: process.env,
    home,
    inputs: { clientIdFile: null, clientSecretFile: null },
  });
  if (credentials.isErr()) {
    refuse(credentials.error.join("; "));
  }
  const transport = createVantaTransport({ logger });
  const tokenProvider = createVantaTokenProvider({ credentials: credentials.value, home, logger, transport });
  const token = await tokenProvider.getToken();
  if (token.isErr()) {
    refuse(vantaTransportFailureLines({ error: token.error }).join("; "));
  }
  const headers = { authorization: `Bearer ${token.value}`, accept: "application/json" };

  // One row harvested per path prefix, so a child's `{param}` is filled from the parent that answered it.
  // `/trust-centers` is deliberately NOT seeded: Vanta's own reference documents a Trust Center `slugId` as
  // an opaque identifier read off the Trust Center Overview page's URL or the public site's `data-slug`
  // attribute, and no documented GET operation returns one. Seeding it with the workspace slug — which an
  // earlier draft of this file did — produced 18 confident HTTP 404s that said nothing at all, because the
  // identifier was the wrong KIND rather than the object being absent. `no-identifier` is the true answer
  // until the browser channel supplies a real slug.
  const harvested = new Map<string, Record<string, unknown>>();

  const ordered = VANTA_GET_ENDPOINTS.toSorted(
    (a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path),
  );
  const rows: VantaProbeRow[] = [];

  for (const endpoint of ordered) {
    const row = await probeOne({ endpoint, harvested, headers, transport });
    rows.push(row);
    if (!asJson) {
      const where = row.requestedPath ?? row.path;
      const detail =
        row.status === null
          ? row.note
          : `HTTP ${String(row.status)}${row.rows === null ? "" : ` · ${String(row.rows)} row(s)`}`;
      process.stdout.write(`${row.outcome.padEnd(13)}\t${where}\t${detail}\n`);
    }
  }

  const tally: Record<string, number> = {};
  for (const row of rows) {
    tally[row.outcome] = (tally[row.outcome] ?? 0) + 1;
  }
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ rows, tally }, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `\nprobeVantaGetEndpoints: ${String(rows.length)} documented GET(s) — ` +
      Object.entries(tally)
        .map(([outcome, count]) => `${String(count)} ${outcome}`)
        .join(", ") +
      "\n",
  );
}

/** Send one documented GET, filling every `{param}` from what an earlier answer already supplied. */
async function probeOne({
  endpoint,
  harvested,
  headers,
  transport,
}: {
  endpoint: VantaGetEndpointRow;
  harvested: Map<string, Record<string, unknown>>;
  headers: Readonly<Record<string, string>>;
  transport: ReturnType<typeof createVantaTransport>;
}): Promise<VantaProbeRow> {
  const base = {
    disposition: endpoint.disposition,
    operationId: endpoint.operationId,
    path: endpoint.path,
    tag: endpoint.tag,
  };
  let filled = endpoint.path;
  for (const parameter of parametersOf({ path: endpoint.path })) {
    const prefix = sourcePrefixFor({ parameter, path: filled });
    const source = harvested.get(prefix) ?? null;
    const value = source === null ? null : segmentValue({ parameter, row: source });
    if (value === null) {
      return {
        ...base,
        note: `no answer supplies {${parameter}} — its source ${prefix} returned none`,
        outcome: "no-identifier",
        requestedPath: null,
        rows: null,
        shape: [],
        status: null,
      };
    }
    filled = filled.replace(`{${parameter}}`, encodeURIComponent(value));
  }
  const requestedPath = `/v1${filled}?pageSize=${PROBE_PAGE_SIZE}`;
  const response = await transport.request({ headers, method: "GET", path: requestedPath });
  if (response.isErr()) {
    // The transport turns every refused status into a typed HTTP_STATUS carrying it — which is the whole
    // measurement here, so it is read from the code rather than collapsed to "fault".
    const lines = vantaTransportFailureLines({ error: response.error });
    const refusedStatus = refusedStatusOf({ failure: response.error });
    return {
      ...base,
      note: lines.join("; "),
      outcome: refusedStatus === null ? "fault" : outcomeOf({ status: refusedStatus }),
      requestedPath,
      rows: null,
      shape: [],
      status: refusedStatus,
    };
  }
  const parsed: unknown = ((): unknown => {
    try {
      return JSON.parse(response.value.body);
    } catch {
      return null;
    }
  })();
  const outcome = outcomeOf({ status: response.value.status });
  if (outcome === "answered" && !harvested.has(filled)) {
    for (const row of rowsOf({ body: parsed }).slice(0, 1)) {
      harvested.set(filled, row);
    }
  }
  return {
    ...base,
    note: "",
    outcome,
    requestedPath,
    rows: rowsIn({ body: parsed }),
    shape: shapeOf({ body: parsed }),
    status: response.value.status,
  };
}

await main();
