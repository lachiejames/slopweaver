/**
 * The `--probes` value of `datadog alert-digest`, read into a runnable probe set: a literal JSON document, a path to
 * one, or `-` for stdin, decoded and validated before any Datadog client exists. Split from `./alertDigestRun.ts`
 * along the seam between reading the operator's declaration and measuring it.
 */
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { type AlertProbeSet, parseAlertProbeSet } from "../../../datadog/alertProbe.js";
import { AlertProbeErrors } from "../../../datadog/alertProbeErrors.js";

/** A thrown cause's message, for a typed error's `detail` field. */
function errorDetail({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** How a `--probes` value is read: a literal document, a file, or stdin. */
async function readProbeDocument({ value }: { value: string }): Promise<Result<string>> {
  if (value === "-") {
    const { readStdin } = await import("#lib/readStdin.js");
    return ok(await readStdin());
  }
  if (value.trimStart().startsWith("{")) {
    return ok(value);
  }
  const { readFileSync } = await import("node:fs");
  try {
    return ok(readFileSync(value, "utf8"));
  } catch (cause) {
    return err([
      AlertProbeErrors.documentUnreadable({
        detail: `--probes '${value}' is not a readable file: ${errorDetail({ cause })}`,
      }).message,
    ]);
  }
}

/**
 * Read, decode and validate the `--probes` value into a runnable set.
 *
 * All three steps are caller mistakes rather than faults, which is why they are one function and one exit
 * code: whether the path was wrong, the JSON was broken or the shape was, the operator has to edit the same
 * document. Every one of them decides before a Datadog client exists, so a misconfigured scheduled row
 * fails on its own configuration rather than after spending a rate-limit budget.
 *
 * @param value the `--probes` value: a JSON document, a path to one, or `-` for stdin
 * @returns the parsed probe set, or every reason it could not become one
 */
export async function resolveProbeSet({ value }: { value: string }): Promise<Result<AlertProbeSet>> {
  const document = await readProbeDocument({ value });
  if (document.isErr()) {
    return err(document.error);
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: "--probes document", text: document.value });
  } catch (cause) {
    return err([AlertProbeErrors.documentUnreadable({ detail: errorDetail({ cause }) }).message]);
  }
  const set = parseAlertProbeSet({ value: decoded });
  if (set.isErr()) {
    return err([set.error.message]);
  }
  return ok(set.value);
}
