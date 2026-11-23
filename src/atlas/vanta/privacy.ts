/**
 * The Vanta-specific admission rule: a value is withheld from the committed atlas unless something
 * positively admits it. Names, emails, policy text, screenshot evidence, and every other
 * control/risk/policy/vendor descriptive field are FINE to store as normal channel detail. Only a
 * genuinely financial record — currently just a vendor's contract amount — is withheld from the committed
 * kind file and routed to a companion file instead. The committed entity keeps only a presence marker
 * ({@link VantaFinancialPointer}) so "does this vendor have contract-amount detail on file" stays
 * answerable without the value itself ever reaching the committed file.
 *
 * Anything else encountered that looks similarly sensitive and is not covered here is withheld by default —
 * fail closed, matching this file's own philosophy.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { err, ok, type Result } from "../../lib/result.js";
import type { VantaVendorContractAmount } from "./apiSchemas.js";
import type { VantaFinancialPointer, VantaKind } from "./model.js";
import type { VantaAtlasPaths } from "./store.js";
import { VantaSyncErrors, vantaSyncErrorLines } from "./syncErrors.js";

/**
 * The companion file's path, relative to the state home — the value stored in the committed pointer.
 * Derived as a fixed template rather than computed from `VantaAtlasPaths`, because the pointer has to stay
 * portable across machines, and this template must always match `store.ts`'s `vantaAtlasPaths` layout.
 *
 * @param kind the entity kind
 * @param entityId the entity's stable id
 * @returns the relative path stored in the committed pointer
 */
export function vantaSensitiveCompanionRelativePath({ kind, entityId }: { kind: VantaKind; entityId: string }): string {
  return `atlas/vanta/_sensitive/${kind}/${entityId}.json`;
}

/** One financial value a projection decided must not reach the committed kind file. */
export interface VantaPendingSensitiveWrite {
  readonly kind: VantaKind;
  readonly entityId: string;
  readonly value: unknown;
}

/**
 * Decide whether a vendor's contract amount may be admitted into the committed entity, or must be withheld
 * and routed to a companion file. Pure — it only classifies; `writeVantaSensitiveCompanion` performs the
 * actual write.
 *
 * @param entityId the vendor's stable entity id
 * @param contractAmount the DTO's contract amount, or `null` when Vanta reported none
 * @returns the pointer to store on the entity, and the write to perform — both `null` when there is
 *   nothing to withhold
 */
export function admitVendorContractAmount({
  entityId,
  contractAmount,
}: {
  entityId: string;
  contractAmount: VantaVendorContractAmount | null;
}): {
  readonly financialDetail: VantaFinancialPointer | null;
  readonly pendingWrite: VantaPendingSensitiveWrite | null;
} {
  if (contractAmount === null) {
    return { financialDetail: null, pendingWrite: null };
  }
  return {
    financialDetail: {
      companionRelativePath: vantaSensitiveCompanionRelativePath({ entityId, kind: "vendor" }),
      hasFinancialDetail: true,
    },
    pendingWrite: { entityId, kind: "vendor", value: contractAmount },
  };
}

/**
 * Write one withheld financial value to its companion file, under `paths.sensitive`.
 *
 * @param paths the resolved atlas paths
 * @param pending the value and where it belongs
 * @returns nothing on success, or the reason the write failed
 */
export function writeVantaSensitiveCompanion({
  paths,
  pending,
}: {
  paths: VantaAtlasPaths;
  pending: VantaPendingSensitiveWrite;
}): Result<null> {
  const absolutePath = join(paths.sensitive, pending.kind, `${pending.entityId}.json`);
  try {
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify(pending.value, null, 2)}\n`, "utf8");
    return ok(null);
  } catch (error: unknown) {
    return err(
      vantaSyncErrorLines({ error: VantaSyncErrors.companionUnwritable({ cause: error, path: absolutePath }) }),
    );
  }
}
