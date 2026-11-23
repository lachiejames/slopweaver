/**
 * The last line: scan what is about to be written, and REFUSE the whole generation if it carries a secret.
 *
 * ## Why a third layer, when two already exist
 *
 * The closed registry decides what may be CALLED and the projection decides what may be STORED. This gate
 * assumes both have failed. It exists because the first two are decisions made in advance — a registry row
 * reviewed last week, a field name nobody anticipated — and this one looks at the actual bytes.
 *
 * The 1Password atlas is the precedent and its lesson is the refusal, not the scan: a forbidden value fails
 * the whole publish rather than being redacted out of it. Redaction leaves a generation that is *mostly*
 * clean and therefore looks publishable, and it silently teaches a reader that the boundary holds when it
 * has just been breached.
 *
 * ## Why this gate does NOT pattern-match a bare hex run, unlike its sibling
 *
 * `jumpcloud/sensitivity.ts` matches a 40-hex run because a JumpCloud API key is one and JumpCloud stores
 * few digests. **That rule is unusable for Datadog and adopting it would have been the worst kind of
 * copy.** A Datadog API key is 32 lowercase hex and an application key is 40 — and so is a git commit SHA,
 * which this atlas legitimately stores on every CI pipeline, deployment, DORA event, static-analysis
 * finding and source map, while an md5 digest is legitimately 32. A hex rule here would refuse most real
 * generations, and a gate that fires on ordinary data is a gate somebody turns off.
 *
 * So the value shapes below are only the ones that are UNAMBIGUOUS — a PEM block, a JWT, an AWS access key
 * id, a prefixed vendor token — and the highest-value leak is caught exactly instead of approximately:
 * {@link admitDatadogGeneration} takes the credential values this process actually holds and refuses a
 * document containing any of them verbatim. That is zero false positives on the one secret whose escape
 * would matter most, and it is stated here rather than discovered because the ABSENCE of a hex rule is the
 * kind of gap a later reader would otherwise read as an oversight and "fix".
 *
 * What covers the residue is the other two layers: the endpoint registry refuses the seven operations whose
 * ordinary response is key material, and the projection drops the named fields that carry it. This gate is
 * the third, not the first.
 *
 * ## The field-name check is KIND-SCOPED, and it has to be
 *
 * The sibling gate checks a field name against one flat set. Doing that here would refuse every generation
 * this atlas can publish, because `key` is a case's own identifier, a feature flag's key and a tag key on
 * forty Datadog models. So the gate consults `sensitiveFields.ts` with the kind it is scanning —
 * which is available because a generation is published one kind file at a time.
 *
 * ## Keys are scanned, not only values
 *
 * A JSON object's KEY is written to disk exactly as a value is, and a provider is free to key a map by
 * something a person typed. A value-only scan admits material carried in the key and nothing in the value.
 *
 * ## What it deliberately does NOT do
 *
 * It is not semantic DLP. A monitor's notification message, a synthetics test's script or a webhook's body
 * template can carry a credential with no recognisable shape, and no scanner catches that.
 */
import { err, ok } from "neverthrow";

import type { Result } from "../../lib/result.js";

import { type DatadogDenialScope, datadogFieldDenial, isDatadogDenialScope } from "./fieldDenial.js";

/**
 * Value shapes that are credential material wherever they appear, whatever the field is called.
 *
 * Every row is unambiguous by construction — a prefix or a delimiter no ordinary Datadog response value
 * carries. See this file's header for why a bare hex run is deliberately absent.
 */
const CREDENTIAL_SHAPES: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  // One row rather than the sibling atlas's two: `[A-Z ]*` already covers `OPENSSH`, `RSA` and `EC`, so a
  // separate OpenSSH row fires alongside this one on the same string and reports the same position twice.
  { name: "PEM private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "PEM certificate request", pattern: /-----BEGIN CERTIFICATE REQUEST-----/ },
  // `\b` is not the boundary these need: `_` is a word character, so `prefix_<token>_suffix` walks past a
  // `\b` anchor. What must not sit either side is a character the token itself could continue with.
  { name: "JSON Web Token", pattern: /(?<![0-9A-Za-z])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/ },
  { name: "AWS access key id", pattern: /(?<![0-9A-Za-z])(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])/ },
  { name: "Datadog RUM client token", pattern: /(?<![0-9A-Za-z])pub[0-9a-f]{32}(?![0-9A-Fa-f])/ },
  { name: "Slack token", pattern: /(?<![0-9A-Za-z])xox[abprs]-[0-9A-Za-z-]{10,}/ },
  { name: "GitHub token", pattern: /(?<![0-9A-Za-z])gh[pousr]_[0-9A-Za-z]{20,}/ },
];

/**
 * One reason a generation was refused, naming where and what without quoting the value.
 * @internal
 */
export interface DatadogSensitivityHit {
  /** JSON pointer to the offending position. */
  readonly pointer: string;
  /** What was recognised — a field name, or the shape of a value. Never the value itself. */
  readonly finding: string;
}

/**
 * Escape one path segment into a JSON pointer token, per RFC 6901.
 *
 * @param segment a property name or array index exactly as it appeared
 * @returns the token, with `~` and `/` escaped
 */
function escapeSegment({ segment }: { segment: string }): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** Whether a value is a plain JSON object rather than an array or a primitive. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every credential shape one string matches, whether it is a value or an object key.
 *
 * @param text the string to test
 * @param known credential values this process holds, matched verbatim
 * @returns the names of what it matched, in table order with the exact matches last
 */
function matchedShapes({ text, known }: { text: string; known: readonly string[] }): readonly string[] {
  const shapes = CREDENTIAL_SHAPES.filter((shape) => shape.pattern.test(text)).map((shape) => shape.name);
  const exact = known.filter((secret) => secret.length > 0 && text.includes(secret));
  return exact.length > 0 ? [...shapes, "a credential this process itself holds"] : shapes;
}

/**
 * Walk a document about to be published, collecting every reason to refuse it.
 *
 * @param node the value at this position
 * @param kind the atlas kind this document belongs to, which scopes the field-name check
 * @param known credential values this process holds
 * @param pointer the JSON pointer to this position
 * @param hits accumulates findings across the walk
 */
function scan({
  node,
  kind,
  known,
  pointer,
  hits,
}: {
  node: unknown;
  kind: DatadogDenialScope;
  known: readonly string[];
  pointer: string;
  hits: DatadogSensitivityHit[];
}): void {
  if (typeof node === "string") {
    for (const name of matchedShapes({ known, text: node })) {
      hits.push({ finding: `value matches ${name}`, pointer });
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      scan({ hits, kind, known, node: item, pointer: `${pointer}/${escapeSegment({ segment: String(index) })}` });
    });
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    const here = `${pointer}/${escapeSegment({ segment: key })}`;
    if (datadogFieldDenial({ field: key, kind }) === "secret-material") {
      hits.push({
        finding: `field "${key}" is secret material in kind "${kind}" and must never be stored`,
        pointer: here,
      });
    }
    for (const name of matchedShapes({ known, text: key })) {
      hits.push({ finding: `property NAME matches ${name}`, pointer: here });
    }
    scan({ hits, kind, known, node: value, pointer: here });
  }
}

/**
 * Judge whether a generation may be written.
 *
 * @param document everything about to be published, already projected
 * @param kind the atlas kind it belongs to — the field-name check is scoped to it, because the same name
 * is credential material in one Datadog kind and an ordinary identifier in another. A kind the field table
 * was never reviewed against is ONE hit at the root and no scan: every scoped row would miss it, so a scan
 * would admit the very credential fields the table exists to refuse.
 * @param knownSecrets credential values this process holds, refused verbatim wherever they appear
 * @returns every reason to refuse, sorted by pointer; empty means the publish may proceed
 */
export function datadogSensitivityHits({
  document,
  kind,
  knownSecrets,
}: {
  document: unknown;
  kind: string;
  knownSecrets: readonly string[];
}): readonly DatadogSensitivityHit[] {
  if (!isDatadogDenialScope(kind)) {
    return [
      {
        finding: `kind "${kind}" is not one this atlas publishes, so no field rule can say which of its fields are credential material`,
        pointer: "",
      },
    ];
  }
  const hits: DatadogSensitivityHit[] = [];
  scan({ hits, kind, known: knownSecrets, node: document, pointer: "" });
  return hits.toSorted((a, b) => a.pointer.localeCompare(b.pointer));
}

/**
 * The exact bytes a writer would store for one document.
 *
 * JSON has no `undefined`: inside an array the serialiser already writes it as `null`, and a root
 * `undefined` is written the same way here, by design, rather than as the bare `undefined` `JSON.stringify`
 * returns for it — which is not JSON, and which the parse that follows could not read back.
 */
function serialisedDocument({ document }: { document: unknown }): string {
  if (document === undefined) {
    return "null";
  }
  return JSON.stringify(document);
}

/**
 * Admit a projected generation for writing, or refuse it outright.
 *
 * This is the enforcing half, and it exists because {@link datadogSensitivityHits} on its own is a
 * DETECTOR: it reports and returns, and a publisher that never consulted it would write the secret anyway.
 * A scan whose result nobody is obliged to read is not a boundary. So the document a writer stores is the
 * one this function hands back, and there is no other way to obtain it.
 *
 * ## It judges the BYTES, not the object graph, and hands back what it judged
 *
 * The scan walks a value; a writer serialises one, and those are not the same thing. A `toJSON` method, a
 * non-enumerable property, an `undefined` that disappears — each makes what is written differ from what was
 * inspected. So the document is serialised first, the scan runs over the PARSED result, and that parsed
 * value is what a caller receives. A document that cannot be serialised at all is refused rather than
 * passed on: nothing can say what would be written.
 *
 * The failure is a plain list of messages rather than a typed union, per `.claude/rules/error-handling.md`:
 * every hit is the same kind of problem and the multiplicity IS the behaviour.
 *
 * @param document everything about to be published, already projected
 * @param kind the atlas kind it belongs to
 * @param knownSecrets credential values this process holds; pass an empty list when none are configured,
 * never a placeholder, because a short or empty needle would match everywhere
 * @returns the document, or one message per reason to refuse the whole generation
 */
export function admitDatadogGeneration({
  document,
  kind,
  knownSecrets,
}: {
  document: unknown;
  kind: string;
  knownSecrets: readonly string[];
}): Result<unknown> {
  let serialised: string;
  try {
    serialised = serialisedDocument({ document });
  } catch (cause) {
    return err([
      `refusing the whole ${kind} generation: it cannot be serialised, so nothing can say what would be written — ${cause instanceof Error ? cause.message : String(cause)}`,
    ]);
  }
  const written: unknown = JSON.parse(serialised);
  const hits = datadogSensitivityHits({ document: written, kind, knownSecrets });
  if (hits.length === 0) {
    return ok(written);
  }
  return err(
    hits.map(
      (hit) =>
        `refusing the whole ${kind} generation: ${hit.finding} at ${hit.pointer === "" ? "the document root" : hit.pointer}`,
    ),
  );
}
