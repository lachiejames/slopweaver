/**
 * `slopweaver store import-fleet` — the board, the run journals, the Codex passes, the owner's speech-to-text
 * dictations and interactive Codex messages, the ledgers, the owner-turn files and the measurements, into the store.
 *
 * The two captured-turn legs (`./importCaptureLegs.ts`) are the only ones whose source sits outside the home; where
 * each is, and why a non-default `--home` reads neither without a flag, is `../../../store/fleet/captureSources.ts`.
 *
 * Everything the user-level Slopweaver directory keeps belongs in Supabase: that is where all the data sits, and it
 * makes the install more portable. This is the record tier of that — the tables are in
 * `../../../store/schema/board.ts`, `runs.ts`, `ledgers.ts`, `ownerTurn.ts` and `measurement.ts`, the projections in
 * `../../../store/fleet/`, and this file is the shell that reads the home and calls both.
 *
 * ## Three properties, each a refusal rather than a hope
 *
 * **It is re-runnable, and that is a per-table decision rather than a global one.** A board document is
 * MUTABLE, so it is re-projected whole and upserted on its slug. A ledger line is written once, keyed on
 * the hash of its own bytes and position — and a ledger whose table is now the authority (the door, autonomy,
 * grants) imports ONCE, read back and marked, and verifies only after that (`./importDoorLeg.ts`,
 * `./importAutonomyLeg.ts`). `../../../store/fleet/store.ts` carries the asymmetry and why it is not tidiness.
 *
 * **A source record that cannot be projected is NAMED, never skipped quietly.** Each is a thing that
 * exists on disk and does not exist in the store, which is the exact asymmetry this verb removes; a count
 * with no messages would hide it. The refusals ride out in the report and the verb exits non-zero.
 *
 * **`--dry-run` opens no connection at all.** Not a transaction that rolls back — no connection. It is the
 * preview an operator reads before the first real import, and the one mode in which nothing can go wrong.
 *
 * ## The scratch tiers it deliberately cannot see — and the one file shape it reads inside one of them
 *
 * `supervisor-scratch/` and the `.scratch` siblings under `orchestration/` are the scratch tier of the
 * three-tier rule — `node_modules`, build output and working copies, reproducible or dead. No leg
 * here reads the `.scratch` siblings, and none should ever be added. What the `orchestration` half gets is
 * `slopweaver home reclaim`, which takes a finished pass's whole scratch and, by ruling,
 * carries no retention policy at all: a directory goes because of what it IS, never because of its age.
 *
 * `supervisor-scratch/` has exactly ONE carve-out, the `owner-turns` leg (`./importOwnerTurnsLeg.ts`): its
 * `owner-turn-*.txt` files, and the same files under `handovers/archive/`, are the owner's words verbatim — not
 * reproducible, not dead, and cited as anchors throughout canon. The loss audit found them in no
 * backup precisely because this directory is a tier nothing imported, so they are read into `owner_turn`
 * and nothing else under the directory is. Everything else there still gets nothing, and the reason is a
 * finding rather than an omission: a reclaim treated byte-identical files there as
 * duplicates and took live supervisor-chair state a script opens by NAME. `../../../home/reclaim/roots.ts`
 * carries it whole.
 *
 * ## The `authored` leg reads a declared set of top-level directories, and only those
 *
 * The audit's "briefs, artifacts, judgement, profile, registers, morning, the rest" class
 * (`./importAuthoredLeg.ts`). It enters a top-level directory only when
 * `../../../store/fleet/authoredDirectories.ts` classifies it `authored`, so an unclassified directory — or a
 * credential one — is never read by accident, and a new directory stays out until somebody classifies it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, join } from "node:path";
import { scanBoard } from "../../../handover/store.js";
import { accountDefaultHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { stateHomePaths } from "../../../stateHome.js";
import { connectStore, type StoreClient } from "../../../store/client.js";
import { projectBoardDoc } from "../../../store/fleet/boardRow.js";
import { resolveCodexHome, resolveDictationsFolder } from "../../../store/fleet/captureSources.js";
import { projectCodexPass } from "../../../store/fleet/codexPass.js";
import { FleetImportErrors } from "../../../store/fleet/errors.js";
import { projectRunJournal } from "../../../store/fleet/runJournal.js";
import { importBoardRows, importCodexPasses, importRun } from "../../../store/fleet/store.js";
import type { NewCodexPassRecord } from "../../../store/schema/runs.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { codexPassDirs, readIfPresent } from "./codexPassDirs.js";
import { storeTail } from "./core.js";
import { autonomyImportStoreOver, runAutonomyLeg } from "./importAutonomyLeg.js";
import { captureWriterFor, runCodexMessagesLeg, runDictationsLeg } from "./importCaptureLegs.js";
import { doorImportStoreOver, runDoorLeg } from "./importDoorLeg.js";
import { type ImportFleetArgs, parseImportFleetArgs } from "./importFleetArgs.js";
import { FLUSH_ROWS, importFleetLines, type LegOutcome, newTally, outcomeOf } from "./importFleetCore.js";
import { type FleetLeg, IMPORT_FLEET_USAGE } from "./importFleetUsage.js";
import { HOME_ROOTED_LEGS } from "./importHomeRootedLegs.js";

/**
 * Project every board document and write the rows.
 *
 * @param client the open connection, or `undefined` on a dry run
 * @param handoverDir where the documents live
 * @returns what this leg did
 */
async function runBoardLeg({
  client,
  handoverDir,
}: {
  client: StoreClient | undefined;
  handoverDir: string;
}): Promise<LegOutcome> {
  const tally = newTally();
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    tally.refused.push(FleetImportErrors.legWriteFailed({ path: handoverDir, reason: scan.error.message }));
    return outcomeOf({ leg: "board", tally });
  }
  const rows = [];
  for (const doc of scan.value.docs) {
    const projected = projectBoardDoc({ doc, text: readFileSync(doc.path, "utf8") });
    if (projected.isErr()) {
      tally.refused.push(projected.error);
      continue;
    }
    tally.projected += 1;
    rows.push(projected.value);
  }
  // Each unreadable file is a document the board itself reports and this import cannot see. Counted in
  // the same column journals use, because both mean "a source record did not reach the store".
  tally.unreadableLines += scan.value.unreadable.length;
  if (client !== undefined && rows.length > 0) {
    const written = await importBoardRows({ client, rows });
    if (written.isErr()) {
      tally.refused.push(FleetImportErrors.legWriteFailed({ path: handoverDir, reason: written.error.message }));
      return outcomeOf({ leg: "board", tally });
    }
    tally.written = written.value;
  }
  return outcomeOf({ leg: "board", tally });
}

/**
 * Project every run journal and write each run with its own transaction.
 *
 * @param client the open connection, or `undefined` on a dry run
 * @param runsDir where the journals live
 * @returns what this leg did
 */
async function runRunsLeg({
  client,
  runsDir,
}: {
  client: StoreClient | undefined;
  runsDir: string;
}): Promise<LegOutcome> {
  const tally = newTally();
  if (!existsSync(runsDir)) {
    tally.absentSource = runsDir;
    return outcomeOf({ leg: "runs", tally });
  }
  for (const name of readdirSync(runsDir).toSorted()) {
    if (!name.endsWith(".jsonl")) {
      continue;
    }
    const path = join(runsDir, name);
    const projected = projectRunJournal({
      path,
      slug: name.slice(0, -".jsonl".length),
      text: readFileSync(path, "utf8"),
    });
    if (projected.isErr()) {
      tally.refused.push(projected.error);
      continue;
    }
    tally.projected += 1;
    tally.unreadableLines += projected.value.unreadableLines.length;
    if (client === undefined) {
      continue;
    }
    const written = await importRun({ client, projected: projected.value });
    if (written.isErr()) {
      tally.refused.push(FleetImportErrors.legWriteFailed({ path, reason: written.error.message }));
      continue;
    }
    tally.written += written.value;
  }
  return outcomeOf({ leg: "runs", tally });
}

/**
 * Project every Codex pass directory and write the rows.
 *
 * `.scratch` siblings are skipped by name, which is what keeps the 16 GB out — see the module header.
 *
 * @param client the open connection, or `undefined` on a dry run
 * @param orchestrationDir where the pass directories live
 * @returns what this leg did
 */
async function runCodexLeg({
  client,
  orchestrationDir,
}: {
  client: StoreClient | undefined;
  orchestrationDir: string;
}): Promise<LegOutcome> {
  const tally = newTally();
  if (!existsSync(orchestrationDir)) {
    tally.absentSource = orchestrationDir;
    return outcomeOf({ leg: "codex", tally });
  }
  const pending: NewCodexPassRecord[] = [];
  let nulsReplaced = 0;
  let passesWithNul = 0;
  const flush = async (): Promise<void> => {
    const rows = pending.splice(0, pending.length);
    if (client === undefined || rows.length === 0) {
      return;
    }
    const written = await importCodexPasses({ client, rows });
    if (written.isErr()) {
      tally.refused.push(FleetImportErrors.legWriteFailed({ path: orchestrationDir, reason: written.error.message }));
      return;
    }
    tally.written += written.value;
  };
  for (const dir of codexPassDirs({ orchestrationDir })) {
    const projected = projectCodexPass({
      artifactText: readIfPresent({ path: join(dir, "artifact.md") }),
      id: basename(dir),
      path: dir,
      recordText: readFileSync(join(dir, "record.json"), "utf8"),
    });
    if (projected.isErr()) {
      tally.refused.push(projected.error);
      continue;
    }
    tally.projected += 1;
    pending.push(projected.value.row);
    if (projected.value.nulsReplaced > 0) {
      nulsReplaced += projected.value.nulsReplaced;
      passesWithNul += 1;
    }
    if (pending.length >= FLUSH_ROWS) {
      await flush();
    }
  }
  await flush();
  const outcome = outcomeOf({ leg: "codex", tally });
  if (passesWithNul === 0) {
    return outcome;
  }
  return {
    ...outcome,
    notes: [
      `${String(nulsReplaced)} NUL(s) in ${String(passesWithNul)} pass(es) stored as U+FFFD, which neither Postgres text nor jsonb can hold; the files on disk keep them`,
    ],
  };
}

/** Run one leg by name, so the dispatcher below stays a table rather than a chain of branches. */
async function runLeg({
  args,
  leg,
  client,
}: {
  args: ImportFleetArgs;
  leg: FleetLeg;
  client: StoreClient | undefined;
}): Promise<LegOutcome> {
  const { adoptUnmatchedDoorLines, home } = args;
  const paths = stateHomePaths(home === undefined ? {} : { home });
  // The two legs whose source is OUTSIDE the home: read by default only for `~/.slopweaver` itself, with `~` the
  // ACCOUNT's home rather than `$HOME`, so a pointed-elsewhere `$HOME` cannot make its own directory the default.
  const sourceInput = { defaultHome: accountDefaultHome(), home: paths.root, userHome: userInfo().homedir };
  if (leg === "dictations") {
    return runDictationsLeg({
      recordings: resolveDictationsFolder({ ...sourceInput, flag: args.dictations }),
      write: captureWriterFor({ client }),
    });
  }
  if (leg === "codex-messages") {
    return runCodexMessagesLeg({
      write: captureWriterFor({ client }),
      codexHome: resolveCodexHome({ ...sourceInput, codexHomeEnv: process.env["CODEX_HOME"], flag: args.codexHome }),
    });
  }
  if (leg === "board") {
    return runBoardLeg({ client, handoverDir: paths.handovers });
  }
  if (leg === "runs") {
    return runRunsLeg({ client, runsDir: paths.runs });
  }
  if (leg === "codex") {
    return runCodexLeg({ client, orchestrationDir: paths.orchestration });
  }
  const homeRooted = HOME_ROOTED_LEGS[leg];
  if (homeRooted !== undefined) {
    return homeRooted({ client, home: paths.root });
  }
  if (leg === "door") {
    return runDoorLeg({
      adoptUnmatchedDoorLines,
      path: join(paths.ledgers, "door.jsonl"),
      store: client === undefined ? undefined : doorImportStoreOver({ client }),
    });
  }
  return runAutonomyLeg({
    home: paths.root,
    nowIso: new Date().toISOString(),
    path: paths.autonomyLedgerJsonl,
    store: client === undefined ? undefined : autonomyImportStoreOver({ client }),
  });
}

/**
 * Run the verb.
 *
 * Exported so `src/__tests__/unit/cli/store/importFleetRun.test.ts` can drive it against a temp home under
 * `--dry-run`, which opens no connection — the property that makes the whole shell unit-testable.
 *
 * @param argv the full process argv (`[node, cli, store, import-fleet, …]`)
 * @returns the process exit code
 */
export async function runImportFleet(argv: readonly string[]): Promise<number> {
  // `storeTail` rather than a slice of a fixed width: every other `store` verb reads its flags through it,
  // and it is what makes `slopweaver store import-fleet …` and a defaulted invocation parse the same way.
  const rest = storeTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: IMPORT_FLEET_USAGE });
    return EXIT_OK;
  }
  const parsed = parseImportFleetArgs({ argv: rest });
  if (parsed.isErr()) {
    parsed.error.forEach((msg) => {
      logger.error({ msg });
    });
    logger.error({ msg: IMPORT_FLEET_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  let client: StoreClient | undefined;
  if (!args.dryRun) {
    const opened = await connectStore(args.home === undefined ? {} : { home: args.home });
    if (opened.isErr()) {
      logger.error({ msg: opened.error.message });
      return EXIT_ERROR;
    }
    client = opened.value;
  }
  try {
    const legs: LegOutcome[] = [];
    for (const leg of args.legs) {
      legs.push(await runLeg({ args, client, leg }));
    }
    const report = { dryRun: args.dryRun, legs };
    if (args.json) {
      logger.out({ line: safeJsonStringify({ label: "store import-fleet report", value: report }) });
    } else {
      importFleetLines({ report }).forEach((msg) => {
        logger.error({ msg });
      });
    }
    return legs.some((leg) => leg.refused.length > 0) ? EXIT_ERROR : EXIT_OK;
  } finally {
    await client?.close();
  }
}

/** The verb, as the manifest loads it. */
export const storeImportFleetCommand = defineCommand({ run: runImportFleet });
