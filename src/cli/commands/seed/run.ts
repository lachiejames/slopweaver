/**
 * `slopweaver seed --demo` — write the bundled SYNTHETIC demo corpus into the local bronze store, so the
 * whole `refresh`→`derive`→`distil`→`store read` loop (and `audit`) runs offline in seconds on tiny, hygiene-clean
 * data. It scaffolds the home (idempotent {@link runInit}) then commits {@link demoRecords} through the SAME
 * production writer real ingest uses ({@link writeCorpusRecords} — redact → dedup → JSONL), so it exercises
 * the REAL seams, not a fake code path. Re-running is safe: identical rows dedup out.
 *
 * It stops at bronze, and says so. Reading is the STORE's job which retired
 * the ranked bronze path — there is no local index to build any more, and the `store` verbs select from Postgres.
 * So the free, offline, no-service part of the loop is what this verb delivers, and the line it prints names
 * `slopweaver store ingest --source <s>` as the step that puts what it just wrote where a question can reach
 * it — `store load` pulls from the providers and reads no bronze file, so it cannot. A demo that
 * silently wrote synthetic records into whichever database the install had selected would be worse than one
 * that ends here.
 *
 * A thin effectful shell; the demo records + window ({@link ../../../init/demoFixture}) and member rows
 * ({@link ../../../init/demoMembers}) are pure.
 */
import { writeCorpusRecords } from "../../../corpus/corpusWriter.js";
import { writeMemberRows } from "../../../corpus/members/store.js";
import { DEMO_WINDOW, demoRecords } from "../../../init/demoFixture.js";
import { demoMembers } from "../../../init/demoMembers.js";
import { runInit } from "../../../init/stateInit.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

const USAGE = "usage: slopweaver seed --demo [--home <dir>]";

/**
 * Write the demo MEMBER rows through the real member store, grouped by source (PR4.8 — the identity
 * substrate that lets the account-kind rules fire offline). Re-running dedups to zero, like the records.
 *
 * @param home the Slopweaver home
 * @returns how many rows were written, or the io errors
 */
function seedDemoMembers({ home }: { home: string }): Result<number> {
  const rows = demoMembers();
  const sources = [...new Set(rows.map((row) => row.source))];
  let total = 0;
  for (const source of sources) {
    const wrote = writeMemberRows({ home, rows: rows.filter((row) => row.source === source), source });
    if (wrote.isErr()) {
      return err(wrote.error);
    }
    total += wrote.value.written;
  }
  return ok(total);
}

/**
 * Run the seed verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export function runSeed(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["run"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: { boolean: ["demo"], value: ["home"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      logger.error({ msg: e });
    });
    logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  const { values, flags } = parsed.value;
  if (!flags.has("demo")) {
    logger.error({ msg: "seed: nothing to do — pass --demo to write the bundled synthetic demo corpus" });
    logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: values["home"] });
  runInit({ home });
  const records = demoRecords();
  const written = writeCorpusRecords({ home, records, window: DEMO_WINDOW });
  if (written.isErr()) {
    written.error.forEach((e) => {
      logger.error({ msg: `seed: ${e}` });
    });
    return EXIT_ERROR;
  }
  logger.info({
    msg: `seed: wrote ${String(written.value.written)} demo record(s), deduped ${String(written.value.deduped)} (from ${String(records.length)})`,
  });
  const members = seedDemoMembers({ home });
  if (members.isErr()) {
    members.error.forEach((e) => {
      logger.error({ msg: `seed: ${e}` });
    });
    return EXIT_ERROR;
  }
  logger.info({ msg: `seed: wrote ${String(members.value)} demo member row(s)` });
  logger.info({
    msg:
      "next: slopweaver derive && slopweaver distil && slopweaver audit — and `slopweaver store ingest --source <s> --limit 500 --all` " +
      "for each of slack, github, linear and notion to put these records where `store read` and `store cite` read from, " +
      "which needs a selected Postgres (`store status` says which)",
  });
  logger.out({ line: String(written.value.written) });
  return EXIT_OK;
}

export const seedRunCommand = defineCommand({ run: runSeed });
