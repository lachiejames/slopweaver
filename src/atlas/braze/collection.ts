/**
 * Reading Braze's official Postman collection into operation rows — pure over the bytes.
 *
 * ## Why a Postman collection is a first-class channel and not a curiosity
 *
 * It is what Braze's own reference links as the way to call this API, and it is the only machine-readable
 * description of the surface Braze ships as a FILE. It carries things the reference does not — the headers a
 * request sends, the folder grouping Braze chose, the body fields of an example call — and it OMITS things
 * the reference has. That asymmetry is the point: `docs/atlas-intent/04-corroboration.md` makes corroboration between
 * surfaces an output, and this is the first atlas here able to produce real disagreements on the day it
 * lands, because both of its published channels fill without any credential.
 *
 * ## What the collection is fetched from, and why that address is not in the reference
 *
 * Braze's page links a Postman documenter VIEW, which is a web page. The collection JSON behind it comes from
 * `documenter.gw.postman.com`, an address Postman does not document. That is deliberate and allowed: the
 * owner's ruling, recorded in `docs/atlas-intent/02-both-surfaces.md`, is that an undocumented endpoint is a usable source
 * as long as it actually works — reach is judged by whether a call returns, never by whether a vendor wrote
 * it down. `specLock.ts` pins the address and `sync.ts` records the census it returned.
 *
 * ## Duplicates are real and are counted rather than hidden
 *
 * MEASURED: 99 requests normalise to 95 distinct method-and-path pairs. Braze ships the same
 * operation more than once under different names — a phone-number example beside an email one, and one copy
 * of `POST /v2/subscription/status/set` whose URL contains a literal space. The first request to claim a key
 * wins and the rest are reported, because "the collection has 99 requests" and "the collection describes 95
 * operations" are different facts and a reader chasing a count needs to know which one they have.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { brazeDispositionFor } from "./dispositions.js";
import { BrazeAtlasErrors, brazeAtlasErrorLines } from "./errors.js";
import type { BrazeDisposition } from "./model.js";
import { brazeOperationProviderId, brazePathDefect } from "./pathKey.js";

/** One operation, as the collection declares it. */
export interface BrazeCollectionOperationRow {
  readonly disposition: BrazeDisposition;
  readonly dispositionReason: string;
  readonly dispositionRuleId: string;
  /** The folder path inside the collection, outermost first. */
  readonly folders: readonly string[];
  readonly headers: readonly string[];
  readonly method: string;
  /** The request's name in the collection. */
  readonly name: string;
  /** What is wrong with the published address, or `null` when nothing is. */
  readonly pathDefect: string | null;
  /** The path exactly as the collection writes it, host variable removed and defect included. */
  readonly pathShape: string;
  readonly providerId: string;
  readonly queryParams: readonly string[];
  readonly requestBodyFields: readonly string[];
}

/**
 * What one read of the collection found.
 *
 * @internal
 */
export interface BrazeCollectionSurface {
  /** One row per DISTINCT operation, first occurrence winning. */
  readonly rows: readonly BrazeCollectionOperationRow[];
  /** How many requests the collection contains, before duplicates are collapsed. */
  readonly requestCount: number;
  /** The names of requests dropped as duplicates of an earlier one, with the key they collided on. */
  readonly duplicates: readonly { readonly name: string; readonly providerId: string }[];
}

/**
 * Read the collection.
 *
 * @param text the collection document, as UTF-8
 * @returns every distinct operation it declares, or why it could not be read
 */
export function readBrazeCollection({ text }: { text: string }): Result<BrazeCollectionSurface> {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (cause) {
    return err(brazeAtlasErrorLines({ error: BrazeAtlasErrors.collectionNotJson({ cause }) }));
  }
  if (!isRecord(document)) {
    return err(brazeAtlasErrorLines({ error: BrazeAtlasErrors.collectionNotObject() }));
  }
  const top = document["item"];
  if (!Array.isArray(top)) {
    return err(brazeAtlasErrorLines({ error: BrazeAtlasErrors.collectionWithoutItems() }));
  }
  const rows: BrazeCollectionOperationRow[] = [];
  const duplicates: { name: string; providerId: string }[] = [];
  const claimed = new Set<string>();
  let requestCount = 0;
  const visit = ({ items, folders }: { items: readonly unknown[]; folders: readonly string[] }): void => {
    for (const item of items) {
      if (!isRecord(item)) {
        continue;
      }
      const nested = item["item"];
      if (Array.isArray(nested)) {
        visit({ folders: [...folders, stringOr({ fallback: "", value: item["name"] })], items: nested });
        continue;
      }
      const request = item["request"];
      if (!isRecord(request)) {
        continue;
      }
      requestCount += 1;
      const row = readRequest({ folders, name: stringOr({ fallback: "", value: item["name"] }), request });
      if (row === null) {
        continue;
      }
      if (claimed.has(row.providerId)) {
        duplicates.push({ name: row.name, providerId: row.providerId });
        continue;
      }
      claimed.add(row.providerId);
      rows.push(row);
    }
  };
  visit({ folders: [], items: top });
  if (rows.length === 0) {
    return err(brazeAtlasErrorLines({ error: BrazeAtlasErrors.collectionWithoutRequests() }));
  }
  return ok({ duplicates, requestCount, rows });
}

/** One request into a row, or `null` when it declares no usable method and address. */
function readRequest({
  request,
  folders,
  name,
}: {
  request: Record<string, unknown>;
  folders: readonly string[];
  name: string;
}): BrazeCollectionOperationRow | null {
  const method = stringOr({ fallback: "", value: request["method"] }).toUpperCase();
  const raw = rawUrlOf({ url: request["url"] });
  if (method === "" || raw === "") {
    return null;
  }
  // `!`: split always yields at least one element, so index 0 is never absent.
  const pathShape = raw.split("?")[0]!.replace(/^https?:\/\/\{\{[^}]*\}\}/, "");
  const verdict = brazeDispositionFor({ method, path: raw });
  return {
    disposition: verdict.disposition,
    dispositionReason: verdict.reason,
    dispositionRuleId: verdict.ruleId,
    folders: folders.filter((folder) => folder !== ""),
    headers: headerNames({ headers: request["header"] }),
    method,
    name: name === "" ? `${method} ${pathShape}` : name,
    pathDefect: brazePathDefect({ form: "request", path: raw }),
    pathShape: pathShape === "" ? raw : pathShape,
    providerId: brazeOperationProviderId({ method, path: raw }),
    queryParams: queryNames({ raw, url: request["url"] }),
    requestBodyFields: bodyFieldNames({ body: request["body"] }),
  };
}

/** Postman writes a URL either as a string or as an object carrying `raw`. */
function rawUrlOf({ url }: { url: unknown }): string {
  if (typeof url === "string") {
    return url;
  }
  if (isRecord(url)) {
    return stringOr({ fallback: "", value: url["raw"] });
  }
  return "";
}

/** Header NAMES only. A collection's header values are Braze's own placeholders, and this atlas holds none. */
function headerNames({ headers }: { headers: unknown }): readonly string[] {
  if (!Array.isArray(headers)) {
    return [];
  }
  const names = new Set<string>();
  for (const header of headers) {
    if (isRecord(header)) {
      const key = stringOr({ fallback: "", value: header["key"] });
      if (key !== "") {
        names.add(key);
      }
    }
  }
  return [...names].toSorted();
}

/** Query parameter names, from the structured form when Postman gives one and from the raw URL otherwise. */
function queryNames({ url, raw }: { url: unknown; raw: string }): readonly string[] {
  const names = new Set([...structuredQueryNames({ url }), ...rawQueryNames({ raw })]);
  return [...names].toSorted();
}

/** The names Postman's own parsed `url.query` array carries, when it gives one. */
function structuredQueryNames({ url }: { url: unknown }): readonly string[] {
  if (!isRecord(url) || !Array.isArray(url["query"])) {
    return [];
  }
  return url["query"]
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => stringOr({ fallback: "", value: entry["key"] }))
    .filter((key) => key !== "");
}

/** The names in the raw URL's own query string, which is the only form some requests carry. */
function rawQueryNames({ raw }: { raw: string }): readonly string[] {
  const query = raw.split("?")[1];
  if (query === undefined) {
    return [];
  }
  return query
    .split("&")
    .map((pair) => pair.split("=")[0])
    .filter((key): key is string => key !== undefined && key !== "");
}

/** Top-level field names of an example request body. Never a value. */
function bodyFieldNames({ body }: { body: unknown }): readonly string[] {
  if (!isRecord(body)) {
    return [];
  }
  const raw = stringOr({ fallback: "", value: body["raw"] });
  if (raw === "") {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Braze's examples are hand-written and several carry comments or trailing commas. An unparsable body is
    // a fact about the example, not a reason to refuse the request — the operation itself is still declared.
    return [];
  }
  return isRecord(parsed) ? Object.keys(parsed).toSorted() : [];
}

/** A string, or the fallback when the value is not one. */
function stringOr({ value, fallback }: { value: unknown; fallback: string }): string {
  return typeof value === "string" ? value : fallback;
}

/** Whether a value is a plain object this reader may index. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
