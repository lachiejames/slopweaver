/**
 * Emit `src/atlas/googleSecops/generated/surfaces.ts`, the Chronicle v1 method inventory, from the
 * googleapis protos and service config pinned in `generated/protoLock.ts` (what each pin means: `pin.ts`).
 *
 * ```bash
 * yarn tsx tools/generateGoogleSecopsSurfaces.ts --fetch <dir>    # fetch the pinned files, then write
 * yarn tsx tools/generateGoogleSecopsSurfaces.ts --spec-dir <dir> # write from files already fetched
 * yarn tsx tools/generateGoogleSecopsSurfaces.ts --verify         # check the committed table only
 * yarn tsx tools/generateGoogleSecopsSurfaces.ts --verify --spec-dir <dir>  # plus digests, parse, byte-equal table
 * ```
 *
 * `<dir>` holds the sixteen files `protoLock.ts` pins, under their own names. They are needed only to
 * WRITE and to check the pin; `--verify` on its own checks the committed files, which is what the unit
 * lane duplicates, because the reviewed boundary is the table rather than googleapis' bytes. A write
 * re-renders `protoLock.ts` with the new `GOOGLE_SECOPS_INVENTORY_SHA256` too. Every `--verify` first
 * requires both generated modules — the whole of `generated/` — to be byte-equal to `surfacesRender.ts`'s
 * rendering of their own imports (so neither can carry code), then recomputes the digest from the table and the lock's per-file counts, so
 * a hand-edited path, scope list, row order, or a `declared` or unpublished count moved between files fails
 * without the fetched files. Both paths are resolved from this file, so the tool behaves the same from any
 * working directory.
 *
 * REFUSES when a byte length, a digest, a per-file declared count, the unpublished-service list or any
 * census number moves — printing EVERY moved value at once, so moving the pin is one read of one failure.
 * Every row is decided by `src/atlas/googleSecops/inventory.ts`, which is pure and unit-tested; this file
 * only reads bytes and writes the table. `tools/generateGoogleAdminSurfaces.ts` is the sibling.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { googleSecopsCustomGetReads, googleSecopsDispositionFor } from "../src/atlas/googleSecops/dispositions.js";
import {
  GOOGLE_SECOPS_INVENTORY_CENSUS,
  GOOGLE_SECOPS_INVENTORY_SHA256,
  GOOGLE_SECOPS_PINS,
  GOOGLE_SECOPS_PROTO_COMMIT,
  GOOGLE_SECOPS_UNPUBLISHED_SERVICES,
} from "../src/atlas/googleSecops/generated/protoLock.js";
import { parseGoogleSecopsGeneratorArgs } from "../src/atlas/googleSecops/generatorArgs.js";
import {
  compileGoogleSecopsInventory,
  type GoogleSecopsInventory,
  googleSecopsCensusMatches,
  googleSecopsInventoryCensus,
} from "../src/atlas/googleSecops/inventory.js";
import { CHRONICLE_SERVICE_CONFIG_DOCUMENT } from "../src/atlas/googleSecops/serviceConfig.js";
import type { GoogleSecopsSurfaceRow } from "../src/atlas/googleSecops/surfaceRow.js";
import { renderGoogleSecopsLock, renderGoogleSecopsSurfaces } from "../src/atlas/googleSecops/surfacesRender.js";
import {
  googleSecopsInventoryDigest,
  googleSecopsInventoryMatchesLock,
} from "../src/atlas/googleSecops/tableIntegrity.js";

/** The table this tool writes, resolved from this file rather than the working directory. */
const OUTPUT = fileURLToPath(new URL("../src/atlas/googleSecops/generated/surfaces.ts", import.meta.url));

/** The lock module, which this tool re-renders with the new digest, resolved the same way. */
const LOCK = fileURLToPath(new URL("../src/atlas/googleSecops/generated/protoLock.ts", import.meta.url));

/** Refuse a lock module that is not the literal text the renderer emits for its own imports. */
function checkLockRendered(): void {
  const rendered = renderGoogleSecopsLock({
    census: GOOGLE_SECOPS_INVENTORY_CENSUS,
    commit: GOOGLE_SECOPS_PROTO_COMMIT,
    digest: GOOGLE_SECOPS_INVENTORY_SHA256,
    pins: GOOGLE_SECOPS_PINS,
    unpublished: GOOGLE_SECOPS_UNPUBLISHED_SERVICES,
  });
  if (readFileSync(LOCK, "utf8") !== rendered) {
    throw new Error(`${LOCK} is not the literal text the generator renders for its own values — re-render it`);
  }
}

/**
 * Refuse a table that is out of id order or, with the lock's per-file counts, does not hash to its digest.
 *
 * @param rows the table, committed or freshly compiled
 */
function checkInventoryDigest({ rows }: { rows: readonly GoogleSecopsSurfaceRow[] }): void {
  const matches = googleSecopsInventoryMatchesLock({
    declared: GOOGLE_SECOPS_PINS,
    pinnedSha256: GOOGLE_SECOPS_INVENTORY_SHA256,
    rows,
    unpublished: GOOGLE_SECOPS_UNPUBLISHED_SERVICES,
  });
  if (matches.isErr()) {
    throw new Error(matches.error.message);
  }
}

/**
 * Re-render the lock module with the digest of the table just written, over the counts just checked.
 *
 * @param rows the rows written to the table
 * @returns the digest written
 */
function writeLock({ rows }: { rows: readonly GoogleSecopsSurfaceRow[] }): string {
  const digest = googleSecopsInventoryDigest({
    declared: GOOGLE_SECOPS_PINS,
    rows,
    unpublished: GOOGLE_SECOPS_UNPUBLISHED_SERVICES,
  });
  const text = renderGoogleSecopsLock({
    census: GOOGLE_SECOPS_INVENTORY_CENSUS,
    commit: GOOGLE_SECOPS_PROTO_COMMIT,
    digest,
    pins: GOOGLE_SECOPS_PINS,
    unpublished: GOOGLE_SECOPS_UNPUBLISHED_SERVICES,
  });
  writeFileSync(LOCK, text, "utf8");
  return digest;
}

/**
 * Fetch every pinned file into a directory, so the pin can be reproduced in one command.
 *
 * @param specDirectory where to write them
 */
async function fetchDocuments({ specDirectory }: { specDirectory: string }): Promise<void> {
  mkdirSync(specDirectory, { recursive: true });
  for (const pin of GOOGLE_SECOPS_PINS) {
    if (!pin.url.includes(`/${GOOGLE_SECOPS_PROTO_COMMIT}/`)) {
      throw new Error(`${pin.id}: ${pin.url} is not addressed at the pinned commit ${GOOGLE_SECOPS_PROTO_COMMIT}`);
    }
    const response = await fetch(pin.url, { redirect: "error" });
    if (!response.ok) {
      throw new Error(`${pin.url} answered ${String(response.status)}`);
    }
    writeFileSync(join(specDirectory, pin.id), Buffer.from(await response.arrayBuffer()));
  }
  process.stdout.write(
    `fetched ${String(GOOGLE_SECOPS_PINS.length)} files at ${GOOGLE_SECOPS_PROTO_COMMIT} to ${specDirectory}\n`,
  );
}

/**
 * Read every pinned file and check its bytes against the pin, reporting EVERY mismatch at once.
 *
 * @param specDirectory where the fetched files live
 * @returns each file's text, keyed by its pinned id
 */
function loadAndVerify({ specDirectory }: { specDirectory: string }): ReadonlyMap<string, string> {
  const texts = new Map<string, string>();
  const problems: string[] = [];
  for (const pin of GOOGLE_SECOPS_PINS) {
    const path = join(specDirectory, pin.id);
    if (!existsSync(path)) {
      throw new Error(`${path} is absent — fetch every file with --fetch, or from the URLs in protoLock.ts`);
    }
    const bytes = readFileSync(path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== pin.byteLength || sha256 !== pin.sha256) {
      problems.push(
        `${pin.id}: read ${String(bytes.byteLength)} bytes sha256 ${sha256}, pinned ${String(pin.byteLength)} bytes sha256 ${pin.sha256}`,
      );
    }
    texts.set(pin.id, bytes.toString("utf8"));
  }
  if (problems.length > 0) {
    throw new Error(`the fetched bytes are not the pinned ones:\n${problems.join("\n")}`);
  }
  return texts;
}

/**
 * Compile the inventory from the verified texts and check every count the lock pins about the parse.
 *
 * @param texts each pinned file's text
 * @returns the compiled inventory
 */
function compileAndCheck({ texts }: { texts: ReadonlyMap<string, string> }): GoogleSecopsInventory {
  const serviceConfig = texts.get(CHRONICLE_SERVICE_CONFIG_DOCUMENT);
  if (serviceConfig === undefined) {
    throw new Error(`${CHRONICLE_SERVICE_CONFIG_DOCUMENT} is not pinned in protoLock.ts`);
  }
  const protos = GOOGLE_SECOPS_PINS.filter((pin) => pin.id.endsWith(".proto")).map((pin) => ({
    document: pin.id,
    text: texts.get(pin.id)!,
  }));
  const compiled = compileGoogleSecopsInventory({
    protos,
    serviceConfig,
    serviceConfigDocument: CHRONICLE_SERVICE_CONFIG_DOCUMENT,
  });
  if (compiled.isErr()) {
    throw new Error(compiled.error.message);
  }
  const problems: string[] = [];
  for (const pin of GOOGLE_SECOPS_PINS) {
    const declared = compiled.value.declaredByDocument[pin.id];
    if (declared !== pin.declared) {
      problems.push(`${pin.id}: ${String(declared)} methods declared, pin says ${String(pin.declared)}`);
    }
  }
  const unpublished = JSON.stringify(compiled.value.unpublished);
  if (unpublished !== JSON.stringify(GOOGLE_SECOPS_UNPUBLISHED_SERVICES)) {
    problems.push(
      `unpublished services: read ${unpublished}, pinned ${JSON.stringify(GOOGLE_SECOPS_UNPUBLISHED_SERVICES)}`,
    );
  }
  const census = googleSecopsInventoryCensus({ rows: compiled.value.rows });
  const matches = googleSecopsCensusMatches({ census, pinned: GOOGLE_SECOPS_INVENTORY_CENSUS });
  if (matches.isErr()) {
    problems.push(matches.error.message);
  }
  verifyRulesFire({ rows: compiled.value.rows });
  if (problems.length > 0) {
    throw new Error(
      `the compiled inventory does not match protoLock.ts:\n${problems.join("\n")}\nmeasured census: ${JSON.stringify(census)}`,
    );
  }
  return compiled.value;
}

/**
 * Check that every custom-GET verdict `dispositions.ts` states still names a row.
 *
 * A verdict naming nothing fails SILENTLY by never matching, which is the staleness a census cannot see.
 *
 * @param rows the inventory to check
 */
function verifyRulesFire({ rows }: { rows: readonly GoogleSecopsSurfaceRow[] }): void {
  const ids = new Set(rows.map((row) => row.id));
  for (const id of googleSecopsCustomGetReads()) {
    if (!ids.has(id)) {
      throw new Error(`dispositions.ts names ${id}, which the inventory does not hold — the verdict is stale`);
    }
  }
}

/**
 * Check the committed table: its census, and every row's disposition re-derived from the rules.
 *
 * Imported dynamically, because the module it reads is the one this tool writes: a static import would
 * make the generator unable to run on a tree where the table does not exist yet.
 *
 * @returns how many rows were checked
 */
async function verifyCommittedTable(): Promise<number> {
  const module = await import("../src/atlas/googleSecops/generated/surfaces.js");
  const rows: readonly GoogleSecopsSurfaceRow[] = module.GOOGLE_SECOPS_SURFACES;
  if (readFileSync(OUTPUT, "utf8") !== renderGoogleSecopsSurfaces({ rows })) {
    throw new Error(`${OUTPUT} is not the literal text the generator renders for its own rows — it was hand-edited`);
  }
  checkInventoryDigest({ rows });
  const matches = googleSecopsCensusMatches({
    census: googleSecopsInventoryCensus({ rows }),
    pinned: GOOGLE_SECOPS_INVENTORY_CENSUS,
  });
  if (matches.isErr()) {
    throw new Error(matches.error.message);
  }
  verifyRulesFire({ rows });
  for (const row of rows) {
    const verdict = googleSecopsDispositionFor({ httpMethod: row.httpMethod, id: row.id, rpc: row.rpc });
    if (verdict.isErr()) {
      throw new Error(verdict.error.message);
    }
    if (verdict.value.disposition !== row.disposition || verdict.value.exclusionReason !== row.exclusionReason) {
      throw new Error(`${row.id}: stored ${row.disposition}/${String(row.exclusionReason)}, the rule says otherwise`);
    }
    if (row.disposition === "entity" && row.httpMethod !== "GET") {
      throw new Error(
        `${row.id}: an entity row is a ${row.httpMethod} — read-only forever means only a GET is ever one`,
      );
    }
    if (row.scopes.length === 0) {
      throw new Error(`${row.id}: no scopes — a method no rule matched must never be emitted`);
    }
  }
  return rows.length;
}

/** Run the tool. */
async function main(): Promise<void> {
  const args = parseGoogleSecopsGeneratorArgs({ argv: process.argv.slice(2) });
  if (args.isErr()) {
    throw new Error(args.error.join("; "));
  }
  const { fetchInto, specDirectory, verifyOnly } = args.value;
  if (verifyOnly) {
    // First, before anything reads a pin: every later check trusts these imports to be the literal data.
    checkLockRendered();
  }
  if (specDirectory === undefined) {
    if (!verifyOnly) {
      throw new Error("writing the inventory needs --fetch <dir> or --spec-dir <dir>; --verify alone checks the table");
    }
    const checked = await verifyCommittedTable();
    process.stdout.write(`verified ${String(checked)} committed methods against every census and disposition rule\n`);
    return;
  }
  if (fetchInto !== undefined) {
    await fetchDocuments({ specDirectory: fetchInto });
  }
  const inventory = compileAndCheck({ texts: loadAndVerify({ specDirectory }) });
  if (verifyOnly) {
    checkInventoryDigest({ rows: inventory.rows });
    if (readFileSync(OUTPUT, "utf8") !== renderGoogleSecopsSurfaces({ rows: inventory.rows })) {
      throw new Error(`${OUTPUT} is not what the pinned files compile to — re-run with --spec-dir to rewrite it`);
    }
    process.stdout.write(
      `verified ${String(inventory.rows.length)} methods across ${String(GOOGLE_SECOPS_PINS.length)} pinned files\n`,
    );
    return;
  }
  writeFileSync(OUTPUT, renderGoogleSecopsSurfaces({ rows: inventory.rows }), "utf8");
  const digest = writeLock({ rows: inventory.rows });
  process.stdout.write(
    `wrote ${String(inventory.rows.length)} methods to ${OUTPUT}, inventory sha256 ${digest} to ${LOCK}\n`,
  );
}

await main();
