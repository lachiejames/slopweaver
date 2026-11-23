/**
 * `slopweaver store rehearse` — restore the newest store backup into a throwaway Postgres of its own and prove
 * it against the live store, without ever writing to the live database. The engine is
 * `src/store/backup/rehearsal.ts`; the runbook is `docs/store/restore-runbook.md`.
 *
 * **The run's one write to the live store is its own proof**, and it comes last: once the throwaway has been
 * stopped and the verdict is in hand, one knowledge row is appended through the same `recordMemory` path
 * `knowledge record` uses. The owner asked for both in one ask — never write to the live database, and file the
 * rehearsal's proof as a knowledge row — and the register IS a table in that database, so the engine holds no
 * live write capability at all and the shell performs the append after the engine is done. `--no-record` skips
 * it, and a refused target never reaches it.
 */
import { randomUUID } from "node:crypto";

import type { KnowledgeDomainPort } from "../../../knowledge/domainPort.js";
import { knowledgeDomainPort } from "../../../knowledge/domainStoreRows.js";
import { lessonRecording } from "../../../knowledge/lessonRecording.js";
import { recordMemory } from "../../../knowledge/memoryRecordStore.js";
import { buildLessonRow } from "../../../knowledge/row.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { REHEARSAL_RECIPE_ID } from "../../../live/automation/standingStoreRows.js";
import { secretFilePath } from "../../../stateHome.js";
import { openDestinationBackup } from "../../../store/backup/keyWrapStore.js";
import { localDirectoryTransport } from "../../../store/backup/localDirectoryTransport.js";
import { readMasterPassword } from "../../../store/backup/masterPassword.js";
import { type MasterPasswordError, MasterPasswordErrors } from "../../../store/backup/masterPasswordErrors.js";
import { SUPABASE_PROJECT_ID } from "../../../store/backup/plan.js";
import { type RehearsalDeps, runRehearsal } from "../../../store/backup/rehearsal.js";
import {
  containerNameTaken,
  inspectLiveContainer,
  restoreIntoThrowaway,
  startThrowaway,
  stopThrowaway,
  waitForThrowaway,
} from "../../../store/backup/rehearsalDocker.js";
import { type RehearsalError, RehearsalErrors } from "../../../store/backup/rehearsalErrors.js";
import { writeRehearsalRecord } from "../../../store/backup/rehearsalRecord.js";
import type { RehearsalReport } from "../../../store/backup/rehearsalReport.js";
import { fetchRehearsalSource, readOtherLegs } from "../../../store/backup/rehearsalSource.js";
import { verifyAgainstLive } from "../../../store/backup/rehearsalVerify.js";
import { BACKUP_PASSPHRASE_SECRET } from "../../../store/backup/secretsBundle.js";
import type { BackupTransport } from "../../../store/backup/transport.js";
import { restoreVault, vaultRowCount } from "../../../store/backup/vault.js";
import { connectStore } from "../../../store/client.js";
import { storeUrl } from "../../../store/config.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { storeCommandErrorLines } from "./errors.js";
import {
  parseStoreRehearseArgs,
  passedOrFailedRecord,
  rehearsalLesson,
  rehearsalLines,
  type StoreRehearseArgs,
} from "./rehearseCore.js";
import { fail, refuse, resolveDestination, resolvedHome } from "./verbShell.js";

const REHEARSE_USAGE =
  "usage: slopweaver store rehearse [--from <project>/<instant>/] [--destination <dir>] [--into <database>] [--port <n>]\n" +
  "                                 [--container <name>] [--sample-size <n>] [--keep] [--no-record] [--home <dir>] [--json]\n" +
  "  Restores the newest backup in the destination (or --from's) into a THROWAWAY Postgres — its own container, no\n" +
  "  mounts, loopback only, the live stack's own image — and checks the copy against the live store read-only:\n" +
  "  the schema, every table's count, and the newest rows byte-equal; storage.tar lists, every files-leg object\n" +
  "  is in the destination, and the Vault leg's secrets come back into the copy, counted. Every object is\n" +
  "  decrypted with the backup key unwrapped from the wrap beside the backup under the master password in\n" +
  "  secrets/backup-passphrase — never the Keychain, so it proves a wiped Mac's path. The throwaway is stopped\n" +
  "  (it was started --rm) unless --keep. Defaults: slopweaver_rehearsal on 127.0.0.1:55422 in slopweaver_rehearsal_db. A name, port\n" +
  "  or container equal to the live store's is refused before anything is read. Files one knowledge row with the\n" +
  "  numbers unless --no-record, and exits 1 when the rehearsal fails. See docs/store/restore-runbook.md.";

/** The backup a rehearsal opened with the master password: the key it was written under, and its reader. */
interface OpenedBackup {
  readonly key: Buffer;
  readonly transport: BackupTransport;
}

/**
 * Open the chosen backup with the master password the nightly reads: the key comes out of the wrap beside it, never
 * the Keychain, so the rehearsal proves the path a wiped Mac takes. An absent or malformed password is reported
 * HERE, after the target guard has run, so a refused target still exits usage and records nothing.
 *
 * @param plain the destination's plain transport, which the manifest header and the wrap are read through
 * @param password the master password read from `secrets/`, or why there is none
 * @param passwordPath where that password's file lives, which an absent one's refusal names
 * @param prefix the chosen backup
 * @returns the opened backup, or why it could not be opened
 */
async function openWithMasterPassword({
  plain,
  password,
  passwordPath,
  prefix,
}: {
  plain: BackupTransport;
  password: Result<string | null, MasterPasswordError>;
  passwordPath: string;
  prefix: string;
}): Promise<Result<OpenedBackup, RehearsalError>> {
  const step = "opening the backup with the master password";
  if (password.isErr()) {
    return err(RehearsalErrors.stepFailed({ reasons: [password.error.message], step }));
  }
  if (password.value === null) {
    const absent = MasterPasswordErrors.absent({ path: passwordPath });
    return err(RehearsalErrors.stepFailed({ reasons: [absent.message], step }));
  }
  const opened = await openDestinationBackup({
    password: password.value,
    prefix,
    project: SUPABASE_PROJECT_ID,
    transport: plain,
  });
  if (opened.isErr()) {
    return err(RehearsalErrors.stepFailed({ reasons: [opened.error.message], step }));
  }
  return ok({ key: opened.value.key, transport: opened.value.destination.transport });
}

/**
 * The production effects over a resolved destination: listed through its plain transport, and read past the choice
 * through the backup the master password opened.
 *
 * @param home the Slopweaver home the download lands under, and whose `secrets/` holds the master password
 * @param destination the destination root
 * @returns every effect the engine performs through
 */
function productionDeps({ home, destination }: { home: string; destination: string }): RehearsalDeps {
  const plain = localDirectoryTransport({ root: destination, rootPolicy: "require-existing" });
  const password = readMasterPassword({ home });
  let current: OpenedBackup | null = null;
  // An invariant, not a guess: `prepareRehearsal` fetches before it reads the other legs, the Vault is restored
  // after that, and a fetch that could not open the backup stops the run before either.
  const opened = (): OpenedBackup => current!;
  return {
    containerNameTaken,
    fetchSource: async ({ prefix }) => {
      const open = await openWithMasterPassword({
        password,
        passwordPath: secretFilePath({ home, name: BACKUP_PASSPHRASE_SECRET }),
        plain,
        prefix,
      });
      if (open.isErr()) {
        return err(open.error);
      }
      current = open.value;
      return fetchRehearsalSource({ destination, home, prefix, transport: open.value.transport });
    },
    inspectLiveContainer,
    listBackups: ({ prefix }) => plain.list({ prefix }),
    nowIso: () => new Date().toISOString(),
    readOtherLegs: ({ directory }) => readOtherLegs({ directory, transport: opened().transport }),
    restoreIntoThrowaway,
    restoreVault: (args) => restoreVault({ ...args, key: opened().key }),
    startThrowaway,
    stopThrowaway,
    vaultRowCount,
    verify: verifyAgainstLive,
    waitForThrowaway,
  };
}

/**
 * File the rehearsal's proof as one knowledge row — the run's single write to the live store.
 *
 * @param domains where the install's own domains are read, which the row's domain is checked against
 * @param home the Slopweaver home
 * @param report what the rehearsal found
 * @returns the row's id, or why it could not be filed
 */
async function fileProof({
  domains,
  home,
  report,
}: {
  domains: KnowledgeDomainPort;
  home: string;
  report: RehearsalReport;
}): Promise<Result<string>> {
  const lesson = rehearsalLesson({ report });
  const installDomains = await domains.read({ home });
  if (installDomains.isErr()) {
    return err([installDomains.error.message]);
  }
  const row = buildLessonRow({
    caveat:
      "The byte-equal sample is only the newest rows of each table with a primary key: a table with no primary key or no rows is reported unsampled and does not fail the run, the run fails only when no sampled row matched at all, and an older row is checked by the counts alone, never byte for byte. The files leg is checked against the destination listing only: no blob is reassembled or hashed, and a zstd chunk passes at any non-empty length.",
    claim: lesson.claim,
    domain: "store",
    evidence: lesson.evidence,
    installDomains: installDomains.value,
    learner: "fleet",
    recordedAtIso: report.finishedAtIso,
    repro: "slopweaver store rehearse",
    run: REHEARSAL_RECIPE_ID,
    surface: "cli",
    tier: 1,
    verdict: lesson.verdict,
  });
  if (row.isErr()) {
    return err([row.error.message]);
  }
  const opened = await connectStore({ home });
  if (opened.isErr()) {
    return err([opened.error.message]);
  }
  const client = opened.value;
  try {
    const recording = lessonRecording({
      behaviourChange: undefined,
      importKey: null,
      learner: row.value.learner,
      lesson: row.value,
      recordingId: randomUUID(),
      retrievalCue: undefined,
    });
    const written = await recordMemory({ client, row: recording });
    if (written.isErr()) {
      return err([written.error.message]);
    }
    return ok(row.value.id);
  } finally {
    await client.close();
  }
}

/**
 * Rehearse a restore of the newest store backup.
 *
 * @param argv the full process argv
 * @returns the process exit code — 0 passed, 1 failed or could not run, 2 refused before anything ran
 */
export async function runStoreRehearse(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(argv[3] === "rehearse" ? 4 : 3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: REHEARSE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseStoreRehearseArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ lines: storeCommandErrorLines({ error: parsed.error }), usage: REHEARSE_USAGE });
  }
  const args = parsed.value;
  const home = resolvedHome({ home: args.home });
  const url = storeUrl({ home });
  if (url.isErr()) {
    return fail({ lines: [url.error.message] });
  }
  const resolved = resolveDestination({ home, override: args.destination });
  if (resolved.isErr()) {
    return fail({ lines: resolved.error });
  }
  const destination = resolved.value.root;
  let report: Awaited<ReturnType<typeof runRehearsal>>;
  try {
    report = await runRehearsal({
      deps: productionDeps({ destination, home }),
      destination,
      from: args.from,
      keep: args.keep,
      liveUrl: url.value,
      requested: args.requested,
      sampleSize: args.sampleSize,
    });
  } catch (cause: unknown) {
    // A throw outside the throwaway (a destination read, say) must still leave a FAILED record: left alone, the
    // previous month's "passed" would stand and the monitor would read this run as clear.
    const message = cause instanceof Error ? cause.message : String(cause);
    return stoppedEarly({ home, message, targetIsLive: false });
  }
  if (report.isErr()) {
    const targetIsLive = report.error.code === "REHEARSAL_TARGET_IS_LIVE";
    return stoppedEarly({ home, message: report.error.message, targetIsLive });
  }
  return reportRehearsal({ args, domains: knowledgeDomainPort(), home, report: report.value });
}

/**
 * A rehearsal that stopped before it had a verdict: a refused target exits usage and records nothing, because
 * nothing ran; anything else records a FAILED run for the monitor.
 *
 * @param message why it stopped
 * @param targetIsLive whether the stop was the guard refusing a live coordinate
 * @returns the exit code
 */
function stoppedEarly({
  home,
  message,
  targetIsLive,
}: {
  home: string;
  message: string;
  targetIsLive: boolean;
}): number {
  const lines = [`store rehearse: ${message}`];
  if (targetIsLive) {
    lines.forEach((msg) => {
      logger.error({ msg });
    });
    return EXIT_USAGE;
  }
  writeRehearsalRecord({
    home,
    record: { atIso: new Date().toISOString(), failures: lines, prefix: null, status: "failed" },
  });
  return fail({ lines });
}

/**
 * Record, print and file a rehearsal that reached a verdict.
 *
 * @param args the parsed flags, for `--json` and `--no-record`
 * @param domains where the filed row's domain is checked
 * @param report what the rehearsal found
 * @returns 0 when it passed, 1 when it failed or its row could not be filed
 */
async function reportRehearsal({
  args,
  domains,
  home,
  report,
}: {
  args: StoreRehearseArgs;
  domains: KnowledgeDomainPort;
  home: string;
  report: RehearsalReport;
}): Promise<number> {
  writeRehearsalRecord({ home, record: passedOrFailedRecord({ report }) });
  if (args.json) {
    logger.out({ line: safeJsonStringify({ label: "store rehearse report", value: report }) });
  } else {
    rehearsalLines({ report }).forEach((line) => {
      logger.out({ line });
    });
  }
  if (args.record) {
    const filed = await fileProof({ domains, home, report });
    if (filed.isErr()) {
      return fail({ lines: ["the rehearsal ran, but its knowledge row was not filed:", ...filed.error] });
    }
    logger.error({ msg: `knowledge row ${filed.value} filed (store · ${rehearsalLesson({ report }).verdict})` });
  }
  return report.verdict.passed ? EXIT_OK : EXIT_ERROR;
}

export const storeRehearseCommand = defineCommand({ run: runStoreRehearse });
