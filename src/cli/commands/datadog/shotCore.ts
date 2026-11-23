/**
 * Pure parser and usage for `slopweaver datadog shot`.
 *
 * Three sub-verbs: `monitor` and `explorer` say what to capture, `file` grades and files the picture that
 * came back. Splitting them keeps the graded write behind an explicit word rather than behind a bare
 * `shot <id>`, which reads like a local operation.
 *
 * There is no `login` and no `status`, and their absence is the owner's ruling
 * (`docs/browser-route.md`; what it retired, `docs/browser-route/screenshot-reading-and-retirement.md`) rather than a gap: this lane keeps no profile to sign into, because it opens
 * nothing. The console is opened in their own Chrome by the visible session.
 *
 * No fs, no clock, no network, no browser — `shotRun.ts` does every read and every write.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValue, flagValueOr, parseFlagTail } from "../../optionParsers.js";
import { type DatadogArgsError, DatadogArgsErrors } from "./errors.js";

/** The sub-verbs `datadog shot` accepts. */
const SHOT_SUBVERBS = ["monitor", "explorer", "file"] as const;

type ShotSubverb = (typeof SHOT_SUBVERBS)[number];

/** The space aggregation a metric seed opens on when the caller states none. */
export const SHOT_DEFAULT_AGG = "sum";

/** The window start a metric seed uses when the caller states none. Printed in the result, never applied silently. */
export const SHOT_DEFAULT_FROM = "1h";

/**
 * Every flag `shot` accepts, in one place.
 *
 * Exported so the help-truth sweep can compare the flags the parser ACCEPTS against the flags the usage
 * ADVERTISES, and probe a valid invocation for each. Every flag here is only valid under a particular
 * SUB-VERB (`--id` needs `monitor`, `--url` needs `explorer`), which the probe table expresses by carrying
 * the sub-verb in each fragment — a probe is the whole argv tail, not a bare flag.
 *
 * The four older Datadog verbs each inline their spec and are classified "unguarded" for it; this one does
 * not, so a flag added here without a usage line fails a test rather than shipping undocumented.
 * @internal
 */
export const DATADOG_SHOT_FLAG_SPEC = {
  boolean: ["json"],
  value: ["id", "url", "metric", "scope", "group", "agg", "from", "to", "out", "image", "preview-url"],
} as const;

/** `datadog shot`'s advertised flags, derived from the spec the verb parses with. */
export const DATADOG_SHOT_FLAG_NAMES: readonly string[] = [
  ...DATADOG_SHOT_FLAG_SPEC.value.map((name) => `--${name}`),
  ...DATADOG_SHOT_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** The validated invocation for `datadog shot`. */
export interface DatadogShotOptions {
  readonly subverb: ShotSubverb;
  readonly monitorId: string | null;
  readonly url: string | null;
  readonly metric: string | null;
  readonly scope: string | null;
  readonly group: string | null;
  readonly agg: string;
  readonly from: string;
  readonly to: string;
  readonly outDir: string | null;
  /** `file` only: the PNG to grade and file. */
  readonly image: string | null;
  /** `file` only: every evaluation-preview URL the console issued, as the session read them off the network. */
  readonly previewUrls: readonly string[];
  readonly json: boolean;
}

/**
 * Split a comma-separated `--preview-url` value into the URLs it names.
 *
 * @param raw the flag's value, or `null` when it was not passed
 * @returns every non-empty URL it carried
 */
function previewUrlsFrom({ raw }: { raw: string | null }): readonly string[] {
  if (raw === null) {
    return [];
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** True when `value` is one of the sub-verbs. A predicate, so positional per the rules. */
function isShotSubverb(value: string): value is ShotSubverb {
  return SHOT_SUBVERBS.some((verb) => verb === value);
}

/**
 * The fragments a seeded Explorer view must render before it is photographed.
 *
 * The metric name always, and the group tag when one was asked for. The scope is included too, because a
 * seeded view that dropped the scope is showing a strictly wider population than the caption claims — which
 * is the quietest way an image can be wrong.
 *
 * @param metric the metric the view was seeded on
 * @param scope the scope that was asked for, or `null`
 * @param group the group-by tag that was asked for, or `null`
 * @returns the fragments the rendered view must carry, in the order they are checked
 */
export function requiredViewFragments({
  metric,
  scope,
  group,
}: {
  metric: string;
  scope: string | null;
  group: string | null;
}): readonly string[] {
  const required = [metric];
  if (scope !== null && scope !== "") {
    required.push(scope);
  }
  if (group !== null && group !== "") {
    required.push(group);
  }
  return required;
}

/**
 * Parse `datadog shot`'s sub-verb and flags.
 *
 * @param rest the argv tail (after `slopweaver datadog shot`), whose first entry is the sub-verb
 * @returns the validated options, or every rejection
 */
export function parseDatadogShotOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<DatadogShotOptions, DatadogArgsError> {
  const [subverb, ...flagTail] = rest;
  if (subverb === undefined) {
    return err(DatadogArgsErrors.shotSubVerbMissing());
  }
  if (!isShotSubverb(subverb)) {
    return err(DatadogArgsErrors.shotSubVerbUnknown({ expected: SHOT_SUBVERBS, got: subverb }));
  }
  const parsed = parseFlagTail({
    rest: flagTail,
    spec: { boolean: [...DATADOG_SHOT_FLAG_SPEC.boolean], value: [...DATADOG_SHOT_FLAG_SPEC.value] },
  });
  if (parsed.isErr()) {
    return err(DatadogArgsErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const flagTailParsed = parsed.value;
  const monitorId = flagValue({ name: "id", parsed: flagTailParsed });
  const url = flagValue({ name: "url", parsed: flagTailParsed });
  const metric = flagValue({ name: "metric", parsed: flagTailParsed });

  const errors = targetErrors({ metric, monitorId, subverb, url });
  if (errors.length > 0) {
    return err(DatadogArgsErrors.optionsRefused({ reasons: errors }));
  }
  return ok({
    agg: flagValueOr({ fallback: SHOT_DEFAULT_AGG, name: "agg", parsed: flagTailParsed }),
    from: flagValueOr({ fallback: SHOT_DEFAULT_FROM, name: "from", parsed: flagTailParsed }),
    group: flagValue({ name: "group", parsed: flagTailParsed }),
    image: flagValue({ name: "image", parsed: flagTailParsed }),
    json: flagTailParsed.flags.has("json"),
    metric,
    monitorId,
    outDir: flagValue({ name: "out", parsed: flagTailParsed }),
    previewUrls: previewUrlsFrom({ raw: flagValue({ name: "preview-url", parsed: flagTailParsed }) }),
    scope: flagValue({ name: "scope", parsed: flagTailParsed }),
    subverb,
    to: flagValueOr({ fallback: "now", name: "to", parsed: flagTailParsed }),
    url,
  });
}

/**
 * Every way the target flags disagree with the sub-verb that was asked for.
 *
 * Accumulated rather than returned on the first miss, for the reason `resolveDatadogConfig` accumulates its
 * own: a caller who got two flags wrong should learn both in one run rather than one per attempt.
 *
 * @param subverb which sub-verb was named
 * @param monitorId the `--id` value, or `null`
 * @param url the `--url` value, or `null`
 * @param metric the `--metric` value, or `null`
 * @returns every rejection, in the order they are checked
 */
function targetErrors({
  subverb,
  monitorId,
  url,
  metric,
}: {
  subverb: ShotSubverb;
  monitorId: string | null;
  url: string | null;
  metric: string | null;
}): readonly string[] {
  const errors: string[] = [];
  if (subverb === "monitor" && monitorId === null) {
    errors.push("--id is required for `shot monitor`, e.g. --id 600101");
  }
  if (subverb === "monitor" && monitorId !== null && !/^\d+$/.test(monitorId)) {
    errors.push(`--id takes a numeric monitor id, got '${monitorId}'`);
  }
  if (subverb === "explorer" && url === null && metric === null) {
    errors.push("`shot explorer` needs either --url <address> or --metric <name>");
  }
  if (subverb === "explorer" && url !== null && metric !== null) {
    errors.push("--url and --metric are alternatives — --url opens an address, --metric seeds one");
  }
  if (subverb !== "monitor" && monitorId !== null) {
    errors.push("--id applies only to `shot monitor`");
  }
  if (subverb !== "explorer" && (url !== null || metric !== null)) {
    errors.push("--url and --metric apply only to `shot explorer`");
  }
  return errors;
}
