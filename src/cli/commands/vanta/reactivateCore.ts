/**
 * The PURE core of `slopweaver write vanta reactivate`: flag parsing, batch assembly and the dry-run
 * rendering. The endpoint takes ids and nothing else, so there is no `--form` spelling and no file to read —
 * the whole batch comes off the command line. {@link ./reactivateRun} does every read, write and credential
 * resolution.
 */
import {
  VANTA_VULNERABILITY_BATCH_MAX,
  type VantaReactivateUpdate,
} from "../../../atlas/vanta/vulnerabilityApiSchemas.js";
import type { VantaResolvedWriteRequest } from "../../../atlas/vanta/writePreview.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValue, flagValueOr, parseFlagTail } from "../../optionParsers.js";
import { vantaVerbErrorLines } from "./errors.js";
import { vantaWriteRequestLines } from "./vulnerabilityBatchLines.js";
import { splitVantaIds, type VantaCredentialFlags, vantaCredentialFlags } from "./vulnerabilityCore.js";

/**
 * A validated `vanta reactivate` invocation. The batch is the ids alone — the endpoint takes nothing else.
 *
 * @internal
 */
export interface VantaReactivateOptions extends VantaCredentialFlags {
  readonly home: string;
  readonly json: boolean;
  readonly dryRun: boolean;
  /** The digest passed to `--approve`, or `null` when the caller approved nothing — the door decides. */
  readonly approve: string | null;
  readonly updates: readonly VantaReactivateUpdate[];
}

/**
 * Parse the tail of `vanta reactivate` and assemble its batch: one id-only update per named finding, in the
 * order named. A repeated `--ids` is refused by the shared parser, for the reason `vulnerabilityCore.ts`'s
 * header gives.
 *
 * @param rest the argv tail after the verb
 * @param defaultHome the home to use when `--home` is absent
 * @returns the validated options with their batch, or every rejection
 */
export function parseVantaReactivateOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<VantaReactivateOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: {
      boolean: ["json", "dry-run"],
      value: ["home", "ids", "approve", "client-id-file", "client-secret-file"],
    },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { flags } = parsed.value;
  const ids = flagValue({ name: "ids", parsed: parsed.value });
  if (ids === null) {
    return err(["name the findings: --ids <id[,id...]>"]);
  }
  const parts = splitVantaIds({ ids });
  if (parts.isErr()) {
    return err(vantaVerbErrorLines({ error: parts.error }));
  }
  return ok({
    ...vantaCredentialFlags({ parsed: parsed.value }),
    approve: flagValue({ name: "approve", parsed: parsed.value }),
    dryRun: flags.has("dry-run"),
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
    updates: parts.value.map((id) => ({ id })),
  });
}

/**
 * The human lines for a reactivation dry run — every finding that would go back under monitoring, the exact
 * request, and the digest that approves exactly this batch and no other.
 *
 * @param updates the batch as it would be sent
 * @param request the request `writePreview.ts` resolved for it
 * @param digest what `--approve` must carry for this exact batch
 * @returns the lines, in display order
 */
export function renderVantaReactivateDryRun({
  updates,
  request,
  digest,
}: {
  updates: readonly VantaReactivateUpdate[];
  request: VantaResolvedWriteRequest;
  digest: string;
}): readonly string[] {
  return [
    `vanta reactivate --dry-run: ${String(updates.length)} finding(s) would go back under monitoring, ` +
      `nothing was sent (Vanta's own batch maximum is ${String(VANTA_VULNERABILITY_BATCH_MAX)})`,
    "",
    ...updates.map((update) => `${update.id}`),
    ...vantaWriteRequestLines({ request }),
    "",
    `to send exactly this batch: --approve ${digest}`,
    "  the digest covers the route and every id above, in this order; change any of them and it stops matching",
  ];
}
