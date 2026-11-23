/**
 * `slopweaver store import-atlas` — every registered atlas's published generation, into the store.
 *
 * All atlas data belongs in Supabase, because that is where all the data should sit. Until this verb the
 * answer was no: `~/.slopweaver/atlas` held hundreds of thousands of entity rows in hundreds of kind files across a few dozen platforms and
 * the store held eight tables, none of them an atlas table. Nothing under `atlas/` is in the file backup
 * either (`../../../store/backup/plan.ts`'s `BACKED_UP_FILE_ROOTS`), and about twenty board rows record
 * that most of these atlases cannot resync unattended — so "re-walk the providers" was never a recovery
 * path that existed.
 *
 * ## A thin shell, as every `store` verb here is
 *
 * The selection is `../../../store/atlas/plan.ts`, the projection `project.ts`, the bounded read
 * `read.ts`, the transaction `store.ts`, and the arguments and report `./importAtlasCore.ts`. This file
 * opens a connection, walks the plan and closes it in a `finally`. `--dry-run` opens no connection at all
 * — not a transaction that rolls back, no connection — which is the preview an operator reads first and
 * the one mode in which nothing can go wrong.
 *
 * ## Why a refused LINE is not a refused file
 *
 * A kind file whose ENVELOPE will not read is refused whole and named, because nothing after line 1 can be
 * attributed without it. A single entity line that will not read is counted and skipped, because the other
 * 64,369 rows in that file are fine. Both are reported; neither is silent. See
 * `../../../store/atlas/errors.ts` for why the two are different variants of one union.
 */
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import {
  kindStatusRow,
  type ManifestKindStatus,
  type PlannedKindFile,
  type PlannedPlatform,
  planAtlasImport,
  unmanifestedKindStatus,
} from "../../../store/atlas/plan.js";
import { type AtlasEnvelopeRead, readEntitySlice, readKindEnvelope } from "../../../store/atlas/read.js";
import {
  type AtlasKindEnvelopeRows,
  replaceKindSlice,
  SLICE_ROWS,
  storedKindDigests,
} from "../../../store/atlas/store.js";
import { connectStore, type StoreClient } from "../../../store/client.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { storeTail } from "./core.js";
import {
  IMPORT_ATLAS_USAGE,
  type ImportAtlasArgs,
  type ImportAtlasReport,
  importAtlasLines,
  type KindOutcome,
  type PlatformRefusal,
  parseImportAtlasArgs,
} from "./importAtlasCore.js";

/** What the walk accumulates as it goes. */
interface ImportTally {
  readonly kinds: KindOutcome[];
  readonly refusedFiles: PlatformRefusal[];
  filesPlanned: number;
}

/**
 * The outcome shape a kind that WROTE NOTHING reports — every count zero.
 *
 * A skipped kind that reported its envelope's coverage and gap counts would say it had written rows it
 * deliberately did not touch, which is the one thing a convergence report must never do.
 *
 * @param planned the file
 * @param kind the envelope's kind
 * @returns the zeroed outcome, marked skipped
 */
function wroteNothing({ planned, kind }: { planned: PlannedKindFile; kind: string }): KindOutcome {
  return {
    channels: 0,
    coverage: 0,
    entities: 0,
    entitiesCollapsed: 0,
    file: planned.file,
    gaps: 0,
    gapsCollapsed: 0,
    kind,
    nulsStripped: 0,
    platform: planned.platform,
    refusalCount: 0,
    refusals: [],
    skipped: true,
    writeFailure: undefined,
  };
}

/**
 * Whether this kind's slice in the store is already the slice on disk.
 *
 * The manifest's digest is over the exact kind-file bytes (`atlasFile.ts`'s `digestOfKindFile`), so an
 * unchanged one means there is nothing to re-read. A kind the manifest does not name has no digest to
 * compare and is always re-read.
 *
 * @param cell the manifest's own cell for this kind
 * @param held the digest the store recorded for this `(platform, kind)`, when it holds one
 * @returns whether the read can be skipped
 */
function alreadyStored({ cell, held }: { cell: ManifestKindStatus; held: string | null | undefined }): boolean {
  return cell.digest !== null && held === cell.digest;
}

/**
 * The bounded rows line 1 projected, as the transaction takes them.
 *
 * @param envelope what line 1 gave
 * @param platform the platform directory
 * @param cell the manifest's own cell for this kind
 * @returns the coverage, gap and status rows
 */
function envelopeRowsFor({
  envelope,
  platform,
  cell,
}: {
  envelope: AtlasEnvelopeRead["envelope"];
  platform: string;
  cell: ManifestKindStatus;
}): AtlasKindEnvelopeRows {
  return {
    coverage: envelope.coverage,
    gaps: envelope.gaps,
    status: kindStatusRow({
      cell,
      generationAt: envelope.generationAt,
      kind: envelope.kind,
      platform,
      readEpoch: envelope.readEpoch,
      schemaVersion: envelope.schemaVersion,
    }),
  };
}

/**
 * Write one kind's slice, and shape what happened as an outcome.
 *
 * @param client the open store
 * @param planned the file
 * @param read what line 1 gave
 * @param cell the manifest's own cell for this kind
 * @returns the outcome, carrying `writeFailure` when the transaction refused
 */
async function writeKind({
  client,
  planned,
  read,
  cell,
}: {
  client: StoreClient;
  planned: PlannedKindFile;
  read: AtlasEnvelopeRead;
  cell: ManifestKindStatus;
}): Promise<KindOutcome> {
  const { envelope, entitiesFrom } = read;
  const written = await replaceKindSlice({
    client,
    envelopeRows: envelopeRowsFor({ cell, envelope, platform: planned.platform }),
    from: entitiesFrom,
    kind: envelope.kind,
    nextSlice: ({ from, linesBefore }) =>
      readEntitySlice({
        from,
        generationAt: envelope.generationAt,
        kind: envelope.kind,
        limit: SLICE_ROWS,
        linesBefore,
        path: planned.path,
        platform: planned.platform,
      }),
    platform: planned.platform,
  });
  const empty = wroteNothing({ kind: envelope.kind, planned });
  if (written.isErr()) {
    // NOT an ordinary zero-row kind: the file exists on disk and its slice is not in the store, which is
    // the exact asymmetry this verb removes. Carried as a field so the exit code and report both see it.
    logger.error({ msg: written.error.message });
    return { ...empty, skipped: false, writeFailure: written.error.message };
  }
  return {
    ...empty,
    channels: written.value.channels,
    coverage: written.value.coverage,
    entities: written.value.entities,
    entitiesCollapsed: written.value.entitiesCollapsed,
    gaps: written.value.gaps,
    gapsCollapsed: envelope.gapsCollapsed,
    nulsStripped: written.value.nulsStripped,
    refusalCount: written.value.refusalCount,
    refusals: written.value.refusals,
    skipped: false,
  };
}

/**
 * Read one kind file and replace its slice, or say why it could not be read.
 *
 * @param client the open store, or `undefined` under `--dry-run`
 * @param planned the file, its platform and its basename
 * @param platformPlan the platform's plan, carrying its manifest
 * @param stored every `(platform, kind)` digest the store already holds
 * @param force whether to re-write a kind whose digest already matches
 * @returns what the kind did, or the refusal that stopped it
 */
async function importOneKind({
  client,
  planned,
  platformPlan,
  stored,
  force,
}: {
  client: StoreClient | undefined;
  planned: PlannedKindFile;
  platformPlan: PlannedPlatform;
  stored: ReadonlyMap<string, string | null>;
  force: boolean;
}): Promise<{ outcome: KindOutcome } | { refusal: PlatformRefusal }> {
  const read = readKindEnvelope({ path: planned.path, platform: planned.platform });
  if ("error" in read) {
    return { refusal: { error: read.error, file: planned.path, platform: planned.platform } };
  }
  const { envelope } = read.envelope;
  // Spelled as an if rather than a coalesce or a ternary, so "the manifest does not name this kind" is
  // a line of code: it is the state that decides whether the digest fast path can apply at all.
  let cell = unmanifestedKindStatus({ entityCount: 0 });
  const named = platformPlan.manifest.get(envelope.kind);
  if (named !== undefined) {
    cell = named;
  }
  const empty = wroteNothing({ kind: envelope.kind, planned });
  if (!force && alreadyStored({ cell, held: stored.get(`${planned.platform}\u0000${envelope.kind}`) })) {
    return { outcome: empty };
  }
  if (client === undefined) {
    // A dry run writes nothing, so it reports what it WOULD have written: the envelope counts are the
    // only figures it can honestly produce, and the entity counts stay zero because nothing was read.
    return {
      outcome: {
        ...empty,
        coverage: envelope.coverage.length,
        gaps: envelope.gaps.length,
        gapsCollapsed: envelope.gapsCollapsed,
        skipped: false,
      },
    };
  }
  return { outcome: await writeKind({ cell, client, planned, read: read.envelope }) };
}

/**
 * Walk every planned platform, importing each kind in turn.
 *
 * @param client the open store, or `undefined` under `--dry-run`
 * @param plan the platforms to walk
 * @param stored every `(platform, kind)` digest the store already holds
 * @param force whether to re-write a kind whose digest already matches
 * @returns what every kind did, and every file that could not be read
 */
async function walkPlan({
  client,
  plan,
  stored,
  force,
}: {
  client: StoreClient | undefined;
  plan: readonly PlannedPlatform[];
  stored: ReadonlyMap<string, string | null>;
  force: boolean;
}): Promise<ImportTally> {
  const tally: ImportTally = { filesPlanned: 0, kinds: [], refusedFiles: [] };
  for (const platformPlan of plan) {
    for (const planned of platformPlan.files) {
      tally.filesPlanned += 1;
      const done = await importOneKind({ client, force, planned, platformPlan, stored });
      if ("refusal" in done) {
        tally.refusedFiles.push(done.refusal);
        continue;
      }
      tally.kinds.push(done.outcome);
    }
  }
  return tally;
}

/**
 * Open the store, unless this is a dry run.
 *
 * @param args what the verb was asked to do
 * @returns the client (or `undefined` for a dry run), or the exit code to return
 */
async function openUnlessDry({
  args,
}: {
  args: ImportAtlasArgs;
}): Promise<{ client: StoreClient | undefined } | { code: number }> {
  if (args.dryRun) {
    return { client: undefined };
  }
  const opened = await connectStore(args.home === undefined ? {} : { home: args.home });
  if (opened.isErr()) {
    logger.error({ msg: opened.error.message });
    return { code: EXIT_ERROR };
  }
  return { client: opened.value };
}

/**
 * Emit the report, as JSON on stdout or as lines on stderr.
 *
 * @param args what the verb was asked to do
 * @param report the whole result
 */
function emit({ args, report }: { args: ImportAtlasArgs; report: ImportAtlasReport }): void {
  if (args.json) {
    logger.out({ line: safeJsonStringify({ label: "store import-atlas report", value: report }) });
    return;
  }
  importAtlasLines({ report }).forEach((msg) => {
    logger.error({ msg });
  });
}

/**
 * Run the verb.
 *
 * Exported so `src/__tests__/unit/cli/store/importAtlasRun.test.ts` can drive it against a temp home under
 * `--dry-run`, which opens no connection — the property that makes the whole shell unit-testable.
 *
 * @param argv the full process argv (`[node, cli, store, import-atlas, …]`)
 * @returns the process exit code
 */
export async function runImportAtlas(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: IMPORT_ATLAS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseImportAtlasArgs({ argv: rest });
  if (parsed.isErr()) {
    parsed.error.forEach((msg) => {
      logger.error({ msg });
    });
    logger.error({ msg: IMPORT_ATLAS_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const started = Date.now();
  const plan = planAtlasImport({
    ...(args.home === undefined ? {} : { home: args.home }),
    ...(args.platform === undefined ? {} : { only: args.platform }),
  });
  if (plan.length === 0) {
    logger.error({ msg: nothingPlanned({ platform: args.platform }) });
    return EXIT_ERROR;
  }
  const opened = await openUnlessDry({ args });
  if ("code" in opened) {
    return opened.code;
  }
  const client = opened.client;
  try {
    const stored = await readStoredDigests({ client });
    if ("code" in stored) {
      return stored.code;
    }
    const tally = await walkPlan({ client, force: args.force, plan, stored: stored.digests });
    emit({
      args,
      report: {
        dryRun: args.dryRun,
        elapsedMs: Date.now() - started,
        filesPlanned: tally.filesPlanned,
        kinds: tally.kinds,
        platformsPlanned: plan.length,
        refusedFiles: tally.refusedFiles,
      },
    });
    const unwritten = tally.kinds.some((kind) => kind.writeFailure !== undefined);
    return tally.refusedFiles.length > 0 || unwritten ? EXIT_ERROR : EXIT_OK;
  } finally {
    await client?.close();
  }
}

/**
 * The digests the store already holds, read once so the skip decision is one query for the whole run.
 *
 * @param client the open store, or `undefined` under `--dry-run`, which holds none
 * @returns the digest map, or the exit code to return
 */
async function readStoredDigests({
  client,
}: {
  client: StoreClient | undefined;
}): Promise<{ digests: ReadonlyMap<string, string | null> } | { code: number }> {
  if (client === undefined) {
    return { digests: new Map() };
  }
  const digests = await storedKindDigests({ client });
  if (digests.isErr()) {
    logger.error({ msg: digests.error.message });
    return { code: EXIT_ERROR };
  }
  return { digests: digests.value };
}

/**
 * What to say when the plan is empty, which is a state fact rather than a failure of this code.
 *
 * @param platform the platform the operator named, when they named one
 * @returns the line to print
 */
function nothingPlanned({ platform }: { platform: string | undefined }): string {
  if (platform === undefined) {
    return "store import-atlas: no registered atlas has a published generation under this home";
  }
  return `store import-atlas: ${platform} has no published generation under this home`;
}

/** The verb, as the manifest loads it. */
export const storeImportAtlasCommand = defineCommand({ run: runImportAtlas });
