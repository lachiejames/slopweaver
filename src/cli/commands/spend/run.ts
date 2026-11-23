/**
 * The `spend` noun's effectful shells — `import`, which reads one saved export and writes its snapshot, and
 * `read`, which reports the newest snapshot of each card. Neither reaches any network. `capture`, the one
 * verb that reads Airwallex live, is wired here and lives in `./capture.ts`.
 *
 * Data goes to STDOUT and diagnostics to STDERR, so `--json` stdout carries exactly one document.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { recordedProfilePort } from "../../../browser/recordedProfile.js";
import { slopweaverHome } from "../../../homeDir.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { merchantIdentityOf, type SpendMerchant } from "../../../spend/merchants/core.js";
import { parseCardExport } from "../../../spend/parse.js";
import { cardReport } from "../../../spend/report.js";
import { readLatestSnapshots, writeCardSnapshot } from "../../../spend/store.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { attachAirwallexTransport, runSpendCapture } from "./capture.js";
import { parseSpendImportArgs, parseSpendReadArgs, renderCardReport } from "./core.js";
import { type ReadSpendMerchants, readSpendMerchants, registeredMerchants } from "./merchantSeam.js";
import { SPEND_IMPORT_USAGE, SPEND_READ_USAGE, SPEND_USAGE } from "./usage.js";

/** The argv index the `spend <verb>` tail starts at — past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The injected edges, so each shell is exercised without touching the process streams or the clock. */
export interface SpendDeps {
  readonly readFile: (args: { path: string }) => string;
  readonly now: () => string;
  readonly defaultHome: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** The edges `import` and `read` add: the install's card-merchant register, read before anything else. */
export interface SpendRegisterDeps extends SpendDeps {
  readonly readMerchants: ReadSpendMerchants;
}

/**
 * The home a verb works under: the one it was given, else this install's.
 *
 * @param home the `--home` value, when given
 * @param deps the injected edges
 * @returns the home to use
 */
function homeFor({ deps, home }: { deps: SpendDeps; home: string | undefined }): string {
  if (home === undefined) {
    return deps.defaultHome();
  }
  return home;
}

/**
 * Run `spend import` against injected edges.
 *
 * @param rest the argv tail after `spend import`
 * @param deps the injected edges
 * @returns the process exit code
 */
export async function runSpendImport({
  deps,
  rest,
}: {
  deps: SpendRegisterDeps;
  rest: readonly string[];
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(SPEND_IMPORT_USAGE);
    return EXIT_OK;
  }
  const options = parseSpendImportArgs({ rest });
  if (options.isErr()) {
    for (const problem of options.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(SPEND_IMPORT_USAGE);
    return EXIT_USAGE;
  }
  const { asOf, json } = options.value;
  const home = homeFor({ deps, home: options.value.home });
  const merchants = await registeredMerchants({ deps, home, verb: "spend import" });
  if (merchants.isErr()) {
    return EXIT_ERROR;
  }
  const path = resolve(options.value.path);
  let text: string;
  try {
    text = deps.readFile({ path });
  } catch (error: unknown) {
    deps.writeDiagnostic(`spend import: could not read ${path}: ${errorMessage({ error })}`);
    return EXIT_ERROR;
  }
  const snapshot = parseCardExport({ asOf, importedAt: deps.now(), sourcePath: path, text });
  if (snapshot.isErr()) {
    deps.writeDiagnostic(`spend import: ${snapshot.error.message}`);
    return EXIT_ERROR;
  }
  const written = writeCardSnapshot({ home, snapshot: snapshot.value });
  if (written.isErr()) {
    deps.writeDiagnostic(`spend import: ${written.error.message}`);
    return EXIT_ERROR;
  }
  if (json) {
    deps.writeOut(safeJsonStringify({ label: "spend import", space: 2, value: snapshot.value }));
    return EXIT_OK;
  }
  const { last4, provider, transactions } = snapshot.value;
  deps.writeOut(
    `spend import: ${provider} card ${last4} as of ${asOf} — ${String(transactions.length)} row(s) → ${written.value}`,
  );
  const note = unregisteredNote({ merchants: merchants.value, transactions });
  if (note !== undefined) {
    deps.writeOut(note);
  }
  return EXIT_OK;
}

/**
 * The line naming every imported merchant string the register does not hold, when it holds any merchant at all.
 *
 * @param merchants the install's registered merchants
 * @param transactions the imported rows
 * @returns the note, or undefined when the register is empty or every merchant is registered
 */
function unregisteredNote({
  merchants,
  transactions,
}: {
  merchants: readonly SpendMerchant[];
  transactions: readonly { readonly merchant: string }[];
}): string | undefined {
  const unregistered = [
    ...new Set(
      transactions
        .map((row) => row.merchant)
        .filter((merchant) => merchantIdentityOf({ merchant, merchants }).kind === "raw"),
    ),
  ];
  if (merchants.length === 0 || unregistered.length === 0) {
    return undefined;
  }
  return `  no registered merchant, kept under its own name: ${unregistered.join(", ")}`;
}

/**
 * Run `spend read` against injected edges.
 *
 * @param rest the argv tail after `spend read`
 * @param deps the injected edges
 * @returns the process exit code — 3 when nothing has been imported
 */
export async function runSpendRead({
  deps,
  rest,
}: {
  deps: SpendRegisterDeps;
  rest: readonly string[];
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(SPEND_READ_USAGE);
    return EXIT_OK;
  }
  const options = parseSpendReadArgs({ rest });
  if (options.isErr()) {
    for (const problem of options.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(SPEND_READ_USAGE);
    return EXIT_USAGE;
  }
  const { by, card, json } = options.value;
  const home = homeFor({ deps, home: options.value.home });
  // The register first, so a store that cannot answer refuses rather than hiding behind "nothing imported".
  const merchants = await registeredMerchants({ deps, home, verb: "spend read" });
  if (merchants.isErr()) {
    return EXIT_ERROR;
  }
  const snapshots = readLatestSnapshots({ home, last4: card });
  if (snapshots.isErr()) {
    deps.writeDiagnostic(`spend read: ${snapshots.error.message}`);
    if (snapshots.error.code === "CARD_NOT_FOUND") {
      return EXIT_EXPECTED_EMPTY;
    }
    return EXIT_ERROR;
  }
  if (snapshots.value.length === 0) {
    deps.writeDiagnostic(
      "spend read: no card has been imported — `slopweaver spend import <path> --as-of <YYYY-MM-DD>` a pasted card page first",
    );
    return EXIT_EXPECTED_EMPTY;
  }
  const reports = snapshots.value.map((snapshot) => cardReport({ merchants: merchants.value, snapshot }));
  if (json) {
    deps.writeOut(safeJsonStringify({ label: "spend read", space: 2, value: { cards: reports } }));
    return EXIT_OK;
  }
  deps.writeOut(reports.map((report) => renderCardReport({ by, report })).join("\n\n"));
  return EXIT_OK;
}

/**
 * The production edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionSpendDeps(): SpendDeps {
  return {
    defaultHome: () => slopweaverHome(),
    now: () => new Date().toISOString(),
    readFile: ({ path }) => readFileSync(path, "utf8"),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver spend import <path> --as-of <day>` — store one pasted card-page export. */
export const spendImportCommand = defineCommand({
  run: (argv) =>
    runSpendImport({
      deps: { ...productionSpendDeps(), readMerchants: readSpendMerchants },
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});

/** `slopweaver spend capture --url <card page> (--discover | --store --last4 <nnnn>)` — the card page, in their Chrome. */
export const spendCaptureCommand = defineCommand({
  run: (argv) => {
    const profiles = recordedProfilePort();
    return runSpendCapture({
      deps: {
        ...productionSpendDeps(),
        attach: ({ home }) => attachAirwallexTransport({ home, profiles }),
        timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      rest: argv.slice(VERB_ARG_OFFSET),
    });
  },
});

/** `slopweaver spend read` — headroom, declines and per-merchant totals from the newest snapshot of each card. */
export const spendReadCommand = defineCommand({
  run: (argv) =>
    runSpendRead({
      deps: { ...productionSpendDeps(), readMerchants: readSpendMerchants },
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});

/** `slopweaver spend` with no verb — the noun's own usage. */
export const spendUsageCommand = defineCommand({
  run: () => {
    logger.error({ msg: SPEND_USAGE });
    return EXIT_USAGE;
  },
});
