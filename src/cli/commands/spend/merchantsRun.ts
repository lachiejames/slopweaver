/**
 * `slopweaver spend merchants show|set` — the install's card-merchant register, read and written in the store.
 *
 * `show` is the same read every spend reader takes (`../../../spend/merchants/read.ts`), printed. `set` replaces the
 * WHOLE register with one offered document through `../../../spend/merchants/write.ts` and prints what the store
 * holds afterwards. A document that does not read is the caller's mistake and exits 2 before any write; a form that
 * cannot be read, or a store that refuses, exits 1. Data goes to stdout and the note to stderr, so `--json` stdout
 * carries exactly one document.
 */
import { readFileSync } from "node:fs";

import { slopweaverHome } from "../../../homeDir.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../../lib/safeJson.js";
import {
  merchantRegisterLines,
  parseSpendMerchantDocument,
  type SpendMerchantDocument,
} from "../../../spend/merchants/core.js";
import type { SpendMerchantError } from "../../../spend/merchants/errors.js";
import { spendMerchantsOf } from "../../../spend/merchants/read.js";
import { writeSpendMerchantRegister } from "../../../spend/merchants/write.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ReadSpendMerchants, readSpendMerchants } from "./merchantSeam.js";
import { parseSpendMerchantsArgs } from "./merchantsCore.js";
import { SPEND_MERCHANTS_USAGE } from "./usage.js";

/** The argv index the `spend merchants` tail starts at. */
const VERB_ARG_OFFSET = 4;

/** Everything the verb touches outside itself; production wires the store and the process streams. */
export interface SpendMerchantsDeps {
  readonly readMerchants: ReadSpendMerchants;
  readonly writeMerchants: (args: {
    home: string;
    document: SpendMerchantDocument;
  }) => Promise<Result<SpendMerchantDocument, SpendMerchantError>>;
  /** Read the form's text — a path, or `-` for stdin — or throw. */
  readonly readForm: (args: { form: string }) => string;
  readonly defaultHome: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Print a register: the exact document as JSON, or one line per merchant.
 *
 * @returns {@link EXIT_OK}
 */
function printRegister({
  deps,
  document,
  json,
}: {
  deps: SpendMerchantsDeps;
  document: SpendMerchantDocument;
  json: boolean;
}): number {
  if (json) {
    deps.writeOut(safeJsonStringify({ label: "spend merchants", space: 2, value: document }));
    return EXIT_OK;
  }
  for (const line of merchantRegisterLines({ document })) {
    deps.writeOut(line);
  }
  return EXIT_OK;
}

/**
 * The offered document, read and validated — every refusal here is the caller's, so it exits 2, bar an unreadable
 * form, which is a failed read and exits 1.
 *
 * @returns the canonical document, or the exit code after printing why
 */
function offeredDocument({
  deps,
  form,
}: {
  deps: SpendMerchantsDeps;
  form: string;
}): { readonly document: SpendMerchantDocument } | { readonly exit: number } {
  let text: string;
  try {
    text = deps.readForm({ form });
  } catch (error: unknown) {
    deps.writeDiagnostic(`spend merchants set: could not read ${form}: ${errorMessage({ error })}`);
    return { exit: EXIT_ERROR };
  }
  let value: unknown;
  try {
    value = safeJsonParse({ label: form, text });
  } catch (error: unknown) {
    deps.writeDiagnostic(`spend merchants set: ${form} is not JSON: ${errorMessage({ error })}`);
    return { exit: EXIT_USAGE };
  }
  const document = parseSpendMerchantDocument({ value });
  if (document.isErr()) {
    deps.writeDiagnostic(`spend merchants set: ${document.error.message}`);
    return { exit: EXIT_USAGE };
  }
  return { document: document.value };
}

/**
 * Run `spend merchants` against injected edges.
 *
 * @param rest the argv tail after `spend merchants`
 * @param deps the injected edges
 * @returns the process exit code
 */
export async function runSpendMerchants({
  deps,
  rest,
}: {
  deps: SpendMerchantsDeps;
  rest: readonly string[];
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(SPEND_MERCHANTS_USAGE);
    return EXIT_OK;
  }
  const options = parseSpendMerchantsArgs({ rest });
  if (options.isErr()) {
    deps.writeDiagnostic(options.error.message);
    deps.writeDiagnostic(SPEND_MERCHANTS_USAGE);
    return EXIT_USAGE;
  }
  let home = deps.defaultHome();
  if (options.value.home !== undefined) {
    home = options.value.home;
  }
  if (options.value.action === "show") {
    const resolved = spendMerchantsOf({ register: await deps.readMerchants({ home }) });
    if (resolved.isErr()) {
      deps.writeDiagnostic(`spend merchants show: ${resolved.error.message}`);
      return EXIT_ERROR;
    }
    if (resolved.value.note !== undefined) {
      deps.writeDiagnostic(`spend merchants show: ${resolved.value.note}`);
    }
    return printRegister({ deps, document: resolved.value.document, json: options.value.json });
  }
  const offered = offeredDocument({ deps, form: options.value.form });
  if ("exit" in offered) {
    return offered.exit;
  }
  const written = await deps.writeMerchants({ document: offered.document, home });
  if (written.isErr()) {
    deps.writeDiagnostic(`spend merchants set: ${written.error.message}`);
    return EXIT_ERROR;
  }
  return printRegister({ deps, document: written.value, json: options.value.json });
}

/** `slopweaver spend merchants show|set` — the install's card-merchant register. */
export const spendMerchantsCommand = defineCommand({
  run: (argv) =>
    runSpendMerchants({
      deps: {
        defaultHome: () => slopweaverHome(),
        readForm: ({ form }) => {
          if (form === "-") {
            return readFileSync(0, "utf8");
          }
          return readFileSync(form, "utf8");
        },
        readMerchants: readSpendMerchants,
        writeDiagnostic: (line) => {
          logger.warn({ msg: line });
        },
        writeMerchants: writeSpendMerchantRegister,
        writeOut: (line) => {
          logger.out({ line });
        },
      },
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
