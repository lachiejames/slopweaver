/**
 * Emit `src/atlas/vanta/generated/getEndpoints.ts` from the OpenAPI document pinned in
 * `src/atlas/vanta/generated/specLock.ts`.
 *
 * ```bash
 * yarn tsx tools/generateVantaEndpoints.ts --spec <file>    # write the table from a local copy
 * yarn tsx tools/generateVantaEndpoints.ts --fetch          # fetch the pinned URL, then write
 * yarn tsx tools/generateVantaEndpoints.ts --verify         # check the committed table only
 * yarn tsx tools/generateVantaEndpoints.ts --verify --fetch # plus the digest, byte length and census
 * ```
 *
 * `--verify` on its own checks the committed table and needs no network, which is what CI runs: the
 * reviewed boundary is the TABLE, not whatever the vendor served this morning.
 *
 * REFUSES when a digest, a byte length, an operation count or a per-disposition count moves. A generated
 * table nobody reviewed is the thing every check here exists to prevent, and a census that counts only the
 * TOTAL cannot see a row changing side — which is precisely the movement that matters, because a row
 * leaving `not-fetched` is coverage arriving and a row entering it is coverage lost.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { fetchPinnedText } from "../src/atlas/kit/pinnedSpec.js";
import {
  collectionPathFor,
  type VantaDetailAddedFields,
  type VantaEndpointDisposition,
  vantaEndpointVerdict,
} from "../src/atlas/vanta/endpointDisposition.js";
import { VANTA_DISPOSITION_CENSUS, VANTA_SPEC_CENSUS, VANTA_SPEC_PIN } from "../src/atlas/vanta/generated/specLock.js";
import { VANTA_SYNCED_SPEC_PATHS } from "../src/atlas/vanta/inventory.js";
import { isRecord } from "../src/lib/parsers.js";

const OUTPUT = "src/atlas/vanta/generated/getEndpoints.ts";

/** The HTTP methods an OpenAPI path item may key an operation by. */
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** One decided GET operation, as the generator assembles it before printing. */
interface Row {
  readonly because: string;
  readonly disposition: VantaEndpointDisposition;
  readonly operationId: string;
  readonly path: string;
  readonly summary: string;
  readonly tag: string;
}

/**
 * Read the pinned document, from a local file or from the pinned URL.
 *
 * @param specFile a local copy to read instead of fetching, or `null` to fetch
 * @returns the document's exact bytes as text
 */
async function loadSpecText({ specFile }: { specFile: string | null }): Promise<string> {
  if (specFile !== null) {
    return readFileSync(specFile, "utf8");
  }
  const fetched = await fetchPinnedText({
    pin: {
      byteLength: VANTA_SPEC_PIN.byteLength,
      id: "manage-vanta",
      sha256: VANTA_SPEC_PIN.sha256,
      url: VANTA_SPEC_PIN.url,
    },
  });
  if (fetched.isErr()) {
    throw new Error(`could not fetch ${VANTA_SPEC_PIN.url}: ${fetched.error.join("; ")}`);
  }
  return fetched.value;
}

/**
 * Refuse a document whose bytes or census are not the reviewed ones.
 *
 * @param text the document's exact bytes as text
 * @param paths how many keys the document carries under `paths`
 * @param operations how many operations of every method it declares
 * @param getOperations how many of those are GET
 */
function assertPin({
  text,
  paths,
  operations,
  getOperations,
}: {
  text: string;
  paths: number;
  operations: number;
  getOperations: number;
}): void {
  const byteLength = Buffer.byteLength(text);
  const sha256 = createHash("sha256").update(text).digest("hex");
  const problems: string[] = [];
  if (byteLength !== VANTA_SPEC_PIN.byteLength) {
    problems.push(`byteLength ${String(byteLength)} != pinned ${String(VANTA_SPEC_PIN.byteLength)}`);
  }
  if (sha256 !== VANTA_SPEC_PIN.sha256) {
    problems.push(`sha256 ${sha256} != pinned ${VANTA_SPEC_PIN.sha256}`);
  }
  if (paths !== VANTA_SPEC_CENSUS.paths) {
    problems.push(`paths ${String(paths)} != census ${String(VANTA_SPEC_CENSUS.paths)}`);
  }
  if (operations !== VANTA_SPEC_CENSUS.operations) {
    problems.push(`operations ${String(operations)} != census ${String(VANTA_SPEC_CENSUS.operations)}`);
  }
  if (getOperations !== VANTA_SPEC_CENSUS.getOperations) {
    problems.push(`GET operations ${String(getOperations)} != census ${String(VANTA_SPEC_CENSUS.getOperations)}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `the served document is not the reviewed one:\n  ${problems.join("\n  ")}\nUpdate specLock.ts deliberately, and review the table diff.`,
    );
  }
}

/**
 * Follow one `$ref` into the document, one hop at a time, refusing a cycle rather than recursing forever.
 *
 * @param document the whole parsed document
 * @param node the node to resolve
 * @returns the node with its `$ref` chain followed, or the node unchanged when it carries none
 */
function resolveRef({ document, node }: { document: Record<string, unknown>; node: unknown }): unknown {
  let current = node;
  const seen = new Set<string>();
  while (isRecord(current) && typeof current["$ref"] === "string") {
    const pointer = current["$ref"];
    if (seen.has(pointer)) {
      return null;
    }
    seen.add(pointer);
    let target: unknown = document;
    for (const segment of pointer.replace(/^#\//, "").split("/")) {
      target = isRecord(target) ? target[segment] : undefined;
    }
    current = target;
  }
  return current;
}

/**
 * The field names one GET operation's 200 response carries on each ROW it returns.
 *
 * A collection answers `{ results: { data: [row] } }` or `{ results: [row] }`; a detail read answers the row
 * itself. All three are unwrapped to the same thing — the row's own property names — so a detail read and
 * its collection can be compared on the only axis the `covered-by-list` claim is about.
 *
 * @param document the whole parsed document
 * @param operation the GET operation
 * @returns the row's property names, or `null` when the response declares no object shape to read
 */
function rowFieldsOf({
  document,
  operation,
}: {
  document: Record<string, unknown>;
  operation: Record<string, unknown>;
}): readonly string[] | null {
  const responses = resolveRef({ document, node: operation["responses"] });
  const ok = isRecord(responses) ? resolveRef({ document, node: responses["200"] }) : null;
  const content = isRecord(ok) ? resolveRef({ document, node: ok["content"] }) : null;
  const json = isRecord(content) ? resolveRef({ document, node: content["application/json"] }) : null;
  let schema = isRecord(json) ? resolveRef({ document, node: json["schema"] }) : null;
  const step = ({ from, key }: { from: unknown; key: string }): unknown => {
    const properties = isRecord(from) ? resolveRef({ document, node: from["properties"] }) : null;
    return isRecord(properties) ? resolveRef({ document, node: properties[key] }) : null;
  };
  const results = step({ from: schema, key: "results" });
  if (results !== null && results !== undefined) {
    const data = step({ from: results, key: "data" });
    schema = data ?? results;
  }
  if (isRecord(schema) && schema["type"] === "array") {
    schema = resolveRef({ document, node: schema["items"] });
  }
  const properties = isRecord(schema) ? resolveRef({ document, node: schema["properties"] }) : null;
  return isRecord(properties) ? Object.keys(properties).toSorted() : null;
}

/**
 * Per detail path, the response fields its own collection's rows do NOT carry.
 *
 * This is what turns `covered-by-list` from an inference about a path's SHAPE into a claim about the two
 * responses — see `endpointDisposition.ts`'s {@link VantaDetailAddedFields}. A detail read whose collection
 * is not documented, or whose response declares no readable object, is simply absent from the map and is
 * decided exactly as before.
 *
 * @param document the whole parsed document
 * @returns the added fields, keyed by detail path
 */
function detailAddedFieldsOf({ document }: { document: Record<string, unknown> }): VantaDetailAddedFields {
  const pathItems = document["paths"];
  if (!isRecord(pathItems)) {
    return new Map();
  }
  const fieldsByPath = new Map<string, readonly string[]>();
  for (const [path, item] of Object.entries(pathItems)) {
    const operation = isRecord(item) ? item["get"] : null;
    if (!isRecord(operation)) {
      continue;
    }
    const fields = rowFieldsOf({ document, operation });
    if (fields !== null) {
      fieldsByPath.set(path, fields);
    }
  }
  const added = new Map<string, readonly string[]>();
  for (const [path, fields] of fieldsByPath) {
    const collection = collectionPathFor({ path });
    const collectionFields = collection === null ? undefined : fieldsByPath.get(collection);
    if (collectionFields === undefined) {
      continue;
    }
    const extra = fields.filter((field) => !collectionFields.includes(field));
    if (extra.length > 0) {
      added.set(path, extra);
    }
  }
  return added;
}

/**
 * Turn the document's GET operations into decided rows, refusing any it cannot name.
 *
 * @param text the document's exact bytes as text
 * @returns every GET row sorted by path, and the counts a pin check needs
 */
function extract({ text }: { text: string }): { rows: readonly Row[]; paths: number; operations: number } {
  const document: unknown = JSON.parse(text);
  if (!isRecord(document) || !isRecord(document["paths"])) {
    throw new Error("the document declares no `paths` object");
  }
  const pathItems = document["paths"];
  const rows: Row[] = [];
  const syncedPaths = new Set(VANTA_SYNCED_SPEC_PATHS);
  const detailAddedFields = detailAddedFieldsOf({ document });
  let operations = 0;
  for (const [path, item] of Object.entries(pathItems)) {
    if (!isRecord(item)) {
      throw new Error(`path ${path} is not an object`);
    }
    for (const method of METHODS) {
      if (isRecord(item[method])) {
        operations += 1;
      }
    }
    const operation = item["get"];
    if (!isRecord(operation)) {
      continue;
    }
    const operationId = operation["operationId"];
    if (typeof operationId !== "string" || operationId.length === 0) {
      throw new Error(`GET ${path} declares no operationId, so it cannot be named`);
    }
    const tags = operation["tags"];
    const tag = Array.isArray(tags) && typeof tags[0] === "string" ? tags[0] : "";
    if (tag.length === 0) {
      throw new Error(`GET ${path} declares no tag, so it cannot be grouped`);
    }
    const summary = operation["summary"];
    if (typeof summary !== "string" || summary.length === 0) {
      throw new Error(`GET ${path} declares no summary, so its row would say nothing`);
    }
    const verdict = vantaEndpointVerdict({ detailAddedFields, path, syncedPaths });
    rows.push({ because: verdict.because, disposition: verdict.disposition, operationId, path, summary, tag });
  }
  return {
    operations,
    paths: Object.keys(pathItems).length,
    rows: rows.toSorted((a, b) => a.path.localeCompare(b.path)),
  };
}

/**
 * Refuse a table whose per-disposition counts are not the reviewed ones.
 *
 * @param rows the decided rows
 */
function assertDispositionCensus({ rows }: { rows: readonly Row[] }): void {
  const counted: Readonly<Record<string, number>> = {
    coveredByList: rows.filter((row) => row.disposition === "covered-by-list").length,
    entitlementRefused: rows.filter((row) => row.disposition === "entitlement-refused").length,
    notFetched: rows.filter((row) => row.disposition === "not-fetched").length,
    synced: rows.filter((row) => row.disposition === "synced").length,
  };
  const expected: Readonly<Record<string, number>> = VANTA_DISPOSITION_CENSUS;
  const problems = Object.entries(counted)
    .filter(([key, value]) => value !== expected[key])
    .map(([key, value]) => `${key} ${String(value)} != census ${String(expected[key])}`);
  if (problems.length > 0) {
    throw new Error(
      `a row changed side:\n  ${problems.join("\n  ")}\nUpdate VANTA_DISPOSITION_CENSUS deliberately — a row leaving not-fetched is coverage arriving, and a row entering it is coverage lost.`,
    );
  }
}

/**
 * Print the table module.
 *
 * @param rows the decided rows
 * @returns the module's whole source text
 */
function render({ rows }: { rows: readonly Row[] }): string {
  const counts = {
    coveredByList: rows.filter((row) => row.disposition === "covered-by-list").length,
    notFetched: rows.filter((row) => row.disposition === "not-fetched").length,
    refused: rows.filter((row) => row.disposition === "entitlement-refused").length,
    synced: rows.filter((row) => row.disposition === "synced").length,
  };
  const body = rows
    .map(
      (row) =>
        `  { because: ${JSON.stringify(row.because)}, disposition: ${JSON.stringify(row.disposition)}, operationId: ${JSON.stringify(row.operationId)}, path: ${JSON.stringify(row.path)}, summary: ${JSON.stringify(row.summary)}, tag: ${JSON.stringify(row.tag)} },`,
    )
    .join("\n");
  return `/**
 * GENERATED — do not hand-edit. Regenerate with \`yarn tsx tools/generateVantaEndpoints.ts\` and review the
 * diff. Built from the OpenAPI document pinned in \`specLock.ts\`.
 *
 * ${String(rows.length)} GET operations: ${String(counts.synced)} synced, ${String(counts.coveredByList)} covered by a list this atlas walks, ${String(counts.refused)} refused by entitlement, ${String(counts.notFetched)} never fetched.
 *
 * The last number is the one that matters: it is the answer to "which API endpoints exist but you never
 * hit". **This constant is where that list lives** — \`slopweaver atlas vanta coverage\` prints the
 * descriptor's exclusions and the stored gaps, not these rows, and an earlier draft of this header claimed
 * otherwise. A Codex review pass caught it, which is the same false-claim-in-canon class the whole change
 * is about. What the number is ratcheted by is \`src/devLint/atlasContentCoverage.ts\`.
 */
import type { VantaEndpointDisposition } from "../endpointDisposition.js";

/** One documented GET operation, and what this atlas does with it. */
export interface VantaGetEndpointRow {
  /** Why the disposition is what it is, in words a reader can go and falsify. */
  readonly because: string;
  readonly disposition: VantaEndpointDisposition;
  /** Vanta's own \`operationId\`, unique across the document. */
  readonly operationId: string;
  /** The document's own path template, relative to the \`https://api.vanta.com/v1\` server. */
  readonly path: string;
  readonly summary: string;
  /** Vanta's own first tag, kept verbatim so the provider's vocabulary stays greppable beside ours. */
  readonly tag: string;
}

/** Every documented GET operation, sorted by path. */
export const VANTA_GET_ENDPOINTS: readonly VantaGetEndpointRow[] = [
${body}
];
`;
}

/**
 * Re-decide every committed row from its own path and refuse one whose disposition is not what
 * {@link vantaEndpointVerdict} would give it.
 *
 * The census this sits beside counts each disposition and nothing else, so a count-PRESERVING swap — moving
 * one path out of `entitlement-refused` and another in — passed verification while the table said something
 * false about both. A Codex review pass produced exactly that swap and measured the generator exiting 0 on
 * it. Totals cannot see a row changing side with another row; re-deciding each row can.
 *
 * **It runs with no document, so it is BOUNDED, and the bound is the two dispositions the document
 * decides.** `covered-by-list` and `not-fetched` are told apart only by the detail-response fields
 * {@link detailAddedFieldsOf} measures, which needs the specification this lane deliberately does not fetch.
 * Re-deciding those rows against an empty map would call every one of them `covered-by-list`, so they are
 * skipped and `--verify --fetch` is what covers them, by re-extracting the whole table. This
 * function once passed no map at all and the offline lane — the one this file's own header says CI runs — died on
 * `Cannot read properties of undefined (reading 'get')` at the first detail row. Reproduce the fix:
 * `yarn tsx tools/generateVantaEndpoints.ts --verify`.
 *
 * @param rows the committed table
 */
function assertEachRowsOwnDisposition({ rows }: { rows: readonly Row[] }): void {
  const syncedPaths = new Set(VANTA_SYNCED_SPEC_PATHS);
  const detailAddedFields: VantaDetailAddedFields = new Map();
  const decidable = rows.filter((row) => row.disposition !== "covered-by-list" && row.disposition !== "not-fetched");
  const wrong = decidable
    .map((row) => ({ row, want: vantaEndpointVerdict({ detailAddedFields, path: row.path, syncedPaths }) }))
    .filter((pair) => pair.want.disposition !== pair.row.disposition)
    .map(
      (pair) =>
        `${pair.row.path}: table says ${pair.row.disposition}, endpointDisposition.ts says ${pair.want.disposition}`,
    );
  if (wrong.length > 0) {
    throw new Error(
      `${String(wrong.length)} committed row(s) carry a disposition this generator would not give them — ${wrong.join(" · ")}`,
    );
  }
}

/**
 * Fetch or read, check the pin, decide every row, check the census, and write or verify.
 *
 * @returns nothing
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const verify = argv.includes("--verify");
  const shouldFetch = argv.includes("--fetch");
  const specIndex = argv.indexOf("--spec");
  const specFile = specIndex >= 0 ? (argv[specIndex + 1] ?? null) : null;

  if (verify && !shouldFetch && specFile === null) {
    const committed = readFileSync(OUTPUT, "utf8");
    const { VANTA_GET_ENDPOINTS } = (await import("../src/atlas/vanta/generated/getEndpoints.js")) as {
      VANTA_GET_ENDPOINTS: readonly Row[];
    };
    assertDispositionCensus({ rows: VANTA_GET_ENDPOINTS });
    if (VANTA_GET_ENDPOINTS.length !== VANTA_SPEC_CENSUS.getOperations) {
      throw new Error(
        `the committed table holds ${String(VANTA_GET_ENDPOINTS.length)} rows, census says ${String(VANTA_SPEC_CENSUS.getOperations)}`,
      );
    }
    const rerendered = render({ rows: VANTA_GET_ENDPOINTS });
    if (rerendered !== committed) {
      throw new Error(`${OUTPUT} is not what this generator would print from its own rows — it has been hand-edited`);
    }
    assertEachRowsOwnDisposition({ rows: VANTA_GET_ENDPOINTS });
    process.stdout.write(`${OUTPUT}: ${String(VANTA_GET_ENDPOINTS.length)} rows, census matches\n`);
    return;
  }

  const text = await loadSpecText({ specFile });
  const { rows, paths, operations } = extract({ text });
  assertPin({ getOperations: rows.length, operations, paths, text });
  assertDispositionCensus({ rows });
  const rendered = render({ rows });
  if (verify) {
    if (rendered !== readFileSync(OUTPUT, "utf8")) {
      throw new Error(`${OUTPUT} disagrees with the served document — regenerate and review the diff`);
    }
    process.stdout.write(`${OUTPUT}: verified against the served document\n`);
    return;
  }
  writeFileSync(OUTPUT, rendered);
  process.stdout.write(`${OUTPUT}: wrote ${String(rows.length)} rows\n`);
}

await main();
