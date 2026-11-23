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
 * ## Why this matters more here than the design assumed
 *
 * MEASURED: `~/.slopweaver/atlas` is `drwxr-xr-x` with every file world-readable, while
 * `secrets` and `live` are `drwx------`. So a secret reaching a kind file is readable by anything running
 * on the machine, not merely stored. A separate run is fixing the directory mode; this gate does not depend
 * on that fix landing.
 *
 * ## Keys are scanned, not only values
 *
 * A JSON object's KEY is written to disk exactly as a value is, and a provider is free to key a map by
 * something a person typed. `{"-----BEGIN PRIVATE KEY-----": "metadata"}` carries the material in the key
 * and nothing in the value, so a value-only scan admits it. The pre-mortem for this atlas named that class
 * before it existed here; the fix is one line at the object branch and the reason it is worth stating is
 * that a scanner which reads half of what it writes is a scanner that reports clean on the half it missed.
 *
 * ## Two legs, because a shape rule alone is wrong in both directions
 *
 * The shape table below is a HEURISTIC and its weakest row says so: a bare forty-hex run is a JumpCloud API
 * key, and it is equally a git commit, a SHA-1 digest and a certificate thumbprint. A misclassification of something
 * not sensitive as sensitive is a defect in credential detection, so the gate has two legs pulling opposite
 * ways:
 *
 * - **Fewer false positives**: `shapeExemptions.ts` forgives one shape at one named field, where a walk has
 *   MEASURED that the provider puts a hash there. Nothing else is forgiven.
 * - **Fewer false negatives**: {@link admitJumpcloudGeneration} takes the credential values this process
 *   actually holds and refuses a document containing any of them verbatim. That leg has zero false
 *   positives by construction, and it is what keeps the highest-value leak — this install's own
 *   administrator key — caught EXACTLY at the very fields the exemption stops catching it approximately.
 *
 * Adding the second leg is what made the first safe to widen. The sibling Datadog gate carries the same
 * exact-match leg and deliberately carries no hex rule at all, for the reason its own header gives.
 *
 * ## What it deliberately does NOT do
 *
 * It is not semantic DLP and does not pretend to be. A command script reading `echo hunter2` carries a
 * credential with no recognisable shape, and no scanner catches that — which is exactly why the command
 * family's script text is projected out at the boundary and why that decision is the owner's rather than
 * this file's. The same limit is why a device-management policy VALUE is not exempted: it can legitimately
 * BE a credential, so nothing here can tell a benign one from a real one.
 */
import { err, ok } from "neverthrow";

import type { Result } from "../../lib/result.js";

import { JumpcloudAtlasErrors, jumpcloudAtlasErrorLines } from "./atlasErrors.js";
import { JUMPCLOUD_SECRET_MATERIAL_FIELDS } from "./sensitiveFields.js";
import { isJumpcloudShapeExempt, type JumpcloudCredentialShapeName } from "./shapeExemptions.js";

/**
 * Value shapes that are credential material wherever they appear, whatever the field is called.
 *
 * The names are drawn from `shapeExemptions.ts`'s closed union rather than being free strings, so an
 * exemption naming a shape this table does not carry is a compile error instead of an exemption that never
 * fires.
 */
const CREDENTIAL_SHAPES: readonly { readonly name: JumpcloudCredentialShapeName; readonly pattern: RegExp }[] = [
  { name: "PEM private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "OpenSSH private key", pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/ },
  // Same boundary reasoning as the two below: `\b` before `eyJ` is defeated by a leading `_`.
  { name: "JSON Web Token", pattern: /(?<![0-9A-Za-z])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/ },
  // `\b` is not the boundary this needs: `_` is a word character, so `prefix_<40 hex>_suffix` slipped a
  // whole JumpCloud API key past a `\b`-anchored pattern. What must NOT sit either side is a character the
  // token itself could continue with — a hex digit here — so an underscore, a quote or a slash is a
  // delimiter rather than camouflage, while a longer hex run such as a sha256 digest still does not match.
  // The atlas stores many digests and none of them is a credential.
  { name: "JumpCloud API key", pattern: /(?<![0-9A-Fa-f])[0-9a-f]{40}(?![0-9A-Fa-f])/ },
  { name: "AWS access key id", pattern: /(?<![0-9A-Za-z])(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])/ },
];

/**
 * One reason a generation was refused, naming where and what without quoting the value.
 * @internal
 */
export interface JumpcloudSensitivityHit {
  /** JSON pointer to the offending position. */
  readonly pointer: string;
  /** What was recognised — a field name, or the shape of a value. Never the value itself. */
  readonly finding: string;
}

/**
 * Escape one path segment into a JSON pointer token, per RFC 6901.
 *
 * Same reason as the projection's: an unescaped `a/b` field name and a `b` inside `a` produce the same
 * string, and a refusal that names the wrong position is a refusal nobody can act on.
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
 * Every credential shape one string matches that is not exempt where it matched.
 *
 * The exemption is consulted here rather than at the call sites so that a value, an array element and a
 * nested value are all judged by the same rule — see `shapeExemptions.ts` for which field forgives which
 * shape, and why an object KEY is never exempt.
 *
 * A credential this process itself holds is matched verbatim and is NEVER exempt, whatever field it sits
 * under. An exemption says "the provider puts hashes here"; it cannot say "this install's own
 * administrator key belongs here", and a key that has reached a stored document has escaped whether or not
 * the field it escaped through is one a hash also uses.
 *
 * @param text the string to test — a value, or a property name
 * @param field the property name this VALUE sits under, when it is a value; omitted for a key
 * @param known credential values this process holds, matched verbatim
 * @returns the names of what it matched, in table order with the exact match last
 */
function matchedShapes({
  text,
  field,
  known,
}: {
  text: string;
  field?: string;
  known: readonly string[];
}): readonly string[] {
  const shapes = CREDENTIAL_SHAPES.filter(
    (shape) => shape.pattern.test(text) && !isJumpcloudShapeExempt({ field, shape: shape.name }),
  ).map((shape): string => shape.name);
  const held = known.some((secret) => secret.length > 0 && text.includes(secret));
  return held ? [...shapes, "a credential this process itself holds"] : shapes;
}

/**
 * Walk a document about to be published, collecting every reason to refuse it.
 *
 * @param node the value at this position
 * @param pointer the JSON pointer to this position
 * @param known credential values this process holds
 * @param hits accumulates findings across the walk
 */
function scan({
  node,
  pointer,
  known,
  hits,
  field,
}: {
  node: unknown;
  pointer: string;
  known: readonly string[];
  hits: JumpcloudSensitivityHit[];
  field?: string;
}): void {
  if (typeof node === "string") {
    for (const name of matchedShapes({ known, text: node, ...(field === undefined ? {} : { field }) })) {
      hits.push({ finding: `value matches ${name}`, pointer });
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      // The field carries INTO an array, so `sha1: ["<40 hex>"]` is judged the same way `sha1: "<40 hex>"`
      // is. Losing it at the array boundary would make the exception depend on a shape the provider chose.
      scan({
        hits,
        known,
        node: item,
        pointer: `${pointer}/${escapeSegment({ segment: String(index) })}`,
        ...(field === undefined ? {} : { field }),
      });
    });
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    const here = `${pointer}/${escapeSegment({ segment: key })}`;
    if (JUMPCLOUD_SECRET_MATERIAL_FIELDS.includes(key)) {
      hits.push({ finding: `field "${key}" is secret material and must never be stored`, pointer: here });
    }
    for (const name of matchedShapes({ known, text: key })) {
      hits.push({ finding: `property NAME matches ${name}`, pointer: here });
    }
    scan({ field: key, hits, known, node: value, pointer: here });
  }
}

/**
 * Judge whether a generation may be written.
 *
 * @param document everything about to be published, already projected
 * @param knownSecrets credential values this process holds, refused verbatim wherever they appear and
 * whatever field they sit under; defaults to none so a caller with nothing to declare declares nothing
 * rather than a placeholder, because a short or empty needle would match everywhere
 * @returns every reason to refuse, sorted by pointer; empty means the publish may proceed
 */
export function jumpcloudSensitivityHits({
  document,
  knownSecrets = [],
}: {
  document: unknown;
  knownSecrets?: readonly string[];
}): readonly JumpcloudSensitivityHit[] {
  const hits: JumpcloudSensitivityHit[] = [];
  scan({ hits, known: knownSecrets, node: document, pointer: "" });
  return hits.toSorted((a, b) => a.pointer.localeCompare(b.pointer));
}

/**
 * What one value looks like once a writer has serialised it.
 *
 * `omitted` is the third answer `JSON.stringify` can give and the one a naive round trip loses: a function,
 * an `undefined`, a symbol. Its caller decides what that means, because the language does — dropped from an
 * object, `null` inside an array.
 */
interface WrittenValue {
  /** The parsed serialisation, or `undefined` when the value would be written at all. */
  readonly written: unknown;
  readonly omitted: boolean;
}

/**
 * `JSON.stringify`, typed the way it actually behaves.
 *
 * The lib declaration says this returns `string`, and it returns `undefined` for a value that has no JSON
 * representation at all — a function, an `undefined`, a symbol, or an object whose `toJSON` produces one of
 * those. That third answer is precisely what {@link writtenValue} has to distinguish, and widening the
 * return type here is what lets it — a caller of `JSON.stringify` directly cannot compare against
 * `undefined` at all without the compiler calling the comparison impossible.
 *
 * @param value the value to serialise
 * @returns the JSON text, or `undefined` when the value would not be written at all
 */
function stringifyHonestly({ value }: { value: unknown }): string | undefined {
  return JSON.stringify(value);
}

/**
 * The value a writer would write, taken through a REAL `JSON.stringify` round trip without ever holding
 * the whole document as one string.
 *
 * Whole subtree first, children only on failure. That order is what keeps this a round trip rather than a
 * reimplementation of one: almost every call serialises in a single step, and the recursive path re-enters
 * the same real serialisation on smaller pieces.
 *
 * @param value the value about to be written
 * @returns the written form, the fact that it would be omitted entirely, or why it cannot be serialised
 * @internal — {@link admitJumpcloudGeneration} and this module's own tests are the only readers.
 */
export function writtenValue({ value }: { value: unknown }): Result<WrittenValue> {
  let serialised: string | undefined;
  try {
    serialised = stringifyHonestly({ value });
  } catch (cause) {
    return descend({ cause, value });
  }
  if (serialised === undefined) {
    return ok({ omitted: true, written: undefined });
  }
  return ok({ omitted: false, written: JSON.parse(serialised) });
}

/**
 * Whether a serialisation failure is the SIZE one, and therefore the only one worth descending for.
 *
 * Everything else — a circular structure, a `BigInt`, a `toJSON` that throws — is a fact about the value
 * rather than about how much of it there is, so descending changes nothing and RISKS something. Measured
 * while building this: a first version descended on any failure, and on a circular structure it recursed
 * until the stack overflowed, caught that overflow as one more serialisation failure, and rebuilt a partial
 * object that it then reported as ADMITTED. A gate that answers "fine" because it ran out of stack is worse
 * than the size refusal it was replacing, so the descent is scoped to the one condition it is for.
 *
 * @param cause the value `JSON.stringify` threw
 * @returns whether the document merely did not fit in one string
 */
function isSizeFailure({ cause }: { cause: unknown }): boolean {
  return cause instanceof RangeError && cause.message.includes("Invalid string length");
}

/**
 * Rebuild an ARRAY from its own children's round trips.
 *
 * @param value the array whose whole serialisation did not fit
 * @returns the written array, or the first child that could not be serialised
 */
function descendArray({ value }: { value: readonly unknown[] }): Result<WrittenValue> {
  const written: unknown[] = [];
  for (const element of value) {
    const child = writtenValue({ value: element });
    if (child.isErr()) {
      return err(child.error);
    }
    // `JSON.stringify` writes `null` for an array element it cannot represent, never a hole.
    written.push(child.value.omitted ? null : child.value.written);
  }
  return ok({ omitted: false, written });
}

/**
 * Rebuild an OBJECT from its own children's round trips.
 *
 * @param value the object whose whole serialisation did not fit
 * @returns the written object, or the first property that could not be serialised
 */
function descendObject({ value }: { value: object }): Result<WrittenValue> {
  const written: Record<string, unknown> = {};
  for (const [key, element] of Object.entries(value)) {
    const child = writtenValue({ value: element });
    if (child.isErr()) {
      return err(child.error);
    }
    // A property that serialises to nothing is absent from the written object rather than null.
    if (!child.value.omitted) {
      written[key] = child.value.written;
    }
  }
  return ok({ omitted: false, written });
}

/**
 * Take the same round trip child by child, for a value too large to serialise whole.
 *
 * @param value the value whose own serialisation failed
 * @param cause why it failed, which is reported unchanged when nothing smaller may be tried
 * @returns the written form rebuilt from its children, or the original failure
 */
function descend({ value, cause }: { value: unknown; cause: unknown }): Result<WrittenValue> {
  const reason = cause instanceof Error ? cause.message : String(cause);
  if (!isSizeFailure({ cause })) {
    return err([reason]);
  }
  if (Array.isArray(value)) {
    return descendArray({ value });
  }
  if (typeof value === "object" && value !== null) {
    return descendObject({ value });
  }
  return err([reason]);
}

/**
 * Admit a projected generation for writing, or refuse it outright.
 *
 * This is the enforcing half, and it exists because {@link jumpcloudSensitivityHits} on its own is a
 * DETECTOR: it reports and returns, and a publisher that never consulted it would write the secret anyway.
 * A scan whose result nobody is obliged to read is not a boundary. So the document a writer stores is the
 * one this function hands back, and there is no other way to obtain it — the refusal is in the control
 * flow rather than in a convention.
 *
 * ## It judges the BYTES, not the object graph, and hands back what it judged
 *
 * The scan walks a value; a writer serialises one, and those are not the same thing. A `toJSON` method, a
 * non-enumerable property, an `undefined` that disappears — each makes what is written differ from what was
 * inspected, and a gate that inspects one and admits the other has checked nothing. So the document is
 * serialised first, the scan runs over the PARSED result, and that parsed value is what a caller receives.
 * A document that cannot be serialised at all is refused rather than passed on: nothing can say what would
 * be written.
 *
 * ## The round trip is taken in PIECES, because the whole one stopped fitting in a string
 *
 * MEASURED, and it is the same defect class as the resume journal this atlas was already being
 * fixed for. One `JSON.stringify` of the whole generation is a payload sized by the ORGANISATION, and once
 * the walk started reading the organisation's systems, users and the software catalogue's fan-out it crossed V8's
 * 536,870,888-character ceiling. The gate then refused with `Invalid string length`, which reads as a
 * corrupt document and is in fact a healthy one that got too big to inspect the way this code inspected it.
 * Reproduce by publishing a generation carrying System Insights plus the device families.
 *
 * {@link writtenValue} keeps the property and drops the single string. It asks `JSON.stringify` for a whole
 * subtree first, which is the exact round trip this gate has always taken, and only when that fails does it
 * descend and take the same round trip on each child. Every leaf is therefore still judged by real
 * `JSON.stringify` output rather than by a hand-rolled imitation of it, and the two rules that make a
 * serialised document differ from its object graph are preserved where they are decided: a value that
 * serialises to nothing is DROPPED from an object and becomes `null` in an array, exactly as
 * `JSON.stringify` does. A subtree that cannot be serialised for any reason other than size still refuses.
 *
 * The failure is a plain list of messages rather than a typed union, per `.claude/rules/error-handling.md`:
 * every hit is the same kind of problem and the multiplicity IS the behaviour, so a discriminated error
 * would lose exactly what a reader needs, which is all of them at once.
 *
 * @param document everything about to be published, already projected
 * @param knownSecrets credential values this process holds; pass an empty list when none are configured,
 * never a placeholder, because a short or empty needle would match everywhere
 * @returns the document, or one message per reason to refuse the whole generation
 */
export function admitJumpcloudGeneration({
  document,
  knownSecrets = [],
}: {
  document: unknown;
  knownSecrets?: readonly string[];
}): Result<unknown> {
  // An `undefined` document is not a special case: it round-trips as OMITTED, which is written as `null` below.
  const round = writtenValue({ value: document });
  if (round.isErr()) {
    return err(jumpcloudAtlasErrorLines({ error: JumpcloudAtlasErrors.unserialisable({ problems: round.error }) }));
  }
  const written: unknown = round.value.omitted ? null : round.value.written;
  const hits = jumpcloudSensitivityHits({ document: written, knownSecrets });
  if (hits.length === 0) {
    return ok(written);
  }
  const reasons: string[] = [];
  for (const hit of hits) {
    reasons.push(
      `refusing the whole generation: ${hit.finding} at ${hit.pointer === "" ? "the document root" : hit.pointer}`,
    );
  }
  return err(reasons);
}
