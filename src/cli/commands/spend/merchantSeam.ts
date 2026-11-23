/**
 * The one seam every `spend` reader takes the install's card-merchant register through, so `import`, `read`, `tasks`
 * and `forward` each read it the same way, BEFORE any effect: a register that will not read refuses the verb with
 * its reason on stderr, an empty one prints its note once on stderr and the verb carries on with no merchant
 * registered.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { SpendMerchant, SpendMerchantDocument } from "../../../spend/merchants/core.js";
import type { SpendMerchantError } from "../../../spend/merchants/errors.js";
import { readSpendMerchantRegister, spendMerchantsOf } from "../../../spend/merchants/read.js";

/** The register read, injected so a shell is tested against a plain fake. */
export type ReadSpendMerchants = (args: { home: string }) => Promise<Result<SpendMerchantDocument, SpendMerchantError>>;

/**
 * The production register read, through the store selected under `home`.
 *
 * @returns the stored register, or the typed refusal
 */
export const readSpendMerchants: ReadSpendMerchants = ({ home }) => readSpendMerchantRegister({ home });

/**
 * The merchants one verb runs with. Both the empty register's note and a refusal's reason are written here, so a
 * verb's shell only has to stop on the error.
 *
 * @param home the home the register is read under
 * @param deps the register read, and where the note or refusal goes — stderr, so `--json` stdout stays one document
 * @param verb the verb's name, prefixed to the note and the refusal
 * @returns the registered merchants, empty when none are, or the read's refusal
 */
export async function registeredMerchants({
  deps,
  home,
  verb,
}: {
  deps: { readonly readMerchants: ReadSpendMerchants; readonly writeDiagnostic: (line: string) => void };
  home: string;
  verb: string;
}): Promise<Result<readonly SpendMerchant[], SpendMerchantError>> {
  const { readMerchants, writeDiagnostic } = deps;
  const resolved = spendMerchantsOf({ register: await readMerchants({ home }) });
  if (resolved.isErr()) {
    writeDiagnostic(`${verb}: ${resolved.error.message}`);
    return err(resolved.error);
  }
  if (resolved.value.note !== undefined) {
    writeDiagnostic(`${verb}: ${resolved.value.note}`);
  }
  return ok(resolved.value.document.merchants);
}
