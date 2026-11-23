/**
 * `slopweaver atlas xero families [--disposition <d>] [--json] [--home <dir>]` — the enumeration the owner's
 * one bound requires, read back.
 *
 * `docs/atlas-intent/06-holdings.md`: a highly voluminous surface is **enumerated and declared rather than stored
 * whole**. `atlas xero read --kind family` will hand back the same rows through the generic reader, and this
 * verb exists because the disposition is the thing a reader actually comes for — "which parts of these books
 * will this atlas never hold, and why" is one question, and answering it should not require filtering a
 * generic entity dump by a field name.
 *
 * A pure read of local state: no network call and no browser.
 */
import {
  XERO_FAMILY_DISPOSITIONS,
  type XeroAtlasEntity,
  type XeroFamilyDetail,
  type XeroFamilyDisposition,
  xeroFamilyDetailSchema,
} from "../../../atlas/xero/model.js";
import { readXeroKindFile, xeroAtlasPaths } from "../../../atlas/xero/store.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { flagValue, parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a Xero atlas verb sits: past the runtime, the script, the `atlas` noun and the `xero` platform. */
const XERO_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const XERO_FAMILIES_USAGE =
  "usage: slopweaver atlas xero families [--disposition configuration|voluminous|mixed|unjudged] [--json] [--home <dir>]";

/**
 * Parse the flag tail this verb accepts, refusing a disposition outside the stored vocabulary.
 *
 * The lookup is a `find` over the declared tuple rather than a type predicate: a predicate cannot take a
 * destructured parameter (TS1230), and a cast would let a typo through as a filter that silently matches
 * nothing. What comes back is already the narrow type, decided by the vocabulary rather than by an assertion.
 */
function parseFamiliesOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<{ home: string; json: boolean; disposition: XeroFamilyDisposition | null }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["disposition", "home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const asked = flagValue({ name: "disposition", parsed: parsed.value });
  // An unpassed `--disposition` asks for every family (`null`); a passed one must name a declared disposition.
  const requested: XeroFamilyDisposition | null | undefined =
    asked === null ? null : XERO_FAMILY_DISPOSITIONS.find((declared) => declared === asked);
  if (requested === undefined) {
    return err([`--disposition must be one of ${XERO_FAMILY_DISPOSITIONS.join(", ")}, not "${asked}"`]);
  }
  return ok({
    disposition: requested,
    home: resolveHome({ named: parsed.value.values["home"] }),
    json: parsed.value.flags.has("json"),
  });
}

/**
 * The stored family detail on one entity, or `null` when the entity carries none.
 *
 * The stored `detail` is `unknown` by construction — one channel entity schema serves four different kinds —
 * so this DECODES it through the schema that wrote it rather than asserting a shape. A row whose detail is
 * any other kind's is skipped instead of crashing the verb, and a cast could not tell those apart at all.
 *
 * @param entity the stored family entity
 * @returns the detail, or `null`
 */
function familyDetail({ entity }: { entity: XeroAtlasEntity }): XeroFamilyDetail | null {
  const parsed = xeroFamilyDetailSchema.safeParse(entity.channels.api?.detail);
  return parsed.success ? parsed.data : null;
}

/** One family's row: what it is, what its records are, and where a human goes to see it. */
function familyLine({ providerId, detail }: { providerId: string; detail: XeroFamilyDetail }): string {
  const pages = detail.pages.length === 0 ? "no declared page" : detail.pages.join(", ");
  return (
    `  ${providerId.padEnd(38)} ${detail.disposition.padEnd(14)} ` +
    `${String(detail.operations.length)} op(s), ${String(detail.voluminousOperations.length)} observation-shaped, ${pages}`
  );
}

/**
 * Print the family enumeration.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function xeroAtlasFamiliesCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: XERO_VERB_INDEX, verbs: ["families"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: XERO_FAMILIES_USAGE });
    return EXIT_OK;
  }
  const options = parseFamiliesOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: XERO_FAMILIES_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson, disposition } = options.value;
  const file = readXeroKindFile({ kind: "family", paths: xeroAtlasPaths({ home }) });
  if (file.isErr()) {
    file.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  if (file.value === null) {
    logger.error({ msg: "the xero atlas holds no family generation yet — run `slopweaver atlas xero sync`" });
    return EXIT_ERROR;
  }
  const rows = file.value.entities.flatMap((entity) => {
    const detail = familyDetail({ entity });
    if (detail === null || (disposition !== null && detail.disposition !== disposition)) {
      return [];
    }
    return [{ detail, providerId: entity.providerId }];
  });
  if (asJson) {
    logger.out({ line: JSON.stringify(rows, null, 1) });
    return EXIT_OK;
  }
  logger.out({ line: `xero families — ${String(rows.length)} row(s)` });
  for (const row of rows) {
    logger.out({ line: familyLine({ detail: row.detail, providerId: row.providerId }) });
    logger.out({ line: `      ${row.detail.dispositionReason}` });
  }
  return EXIT_OK;
}
