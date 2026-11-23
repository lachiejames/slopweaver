/**
 * The storage boundary every atlas projects through: drop the fields a platform denies, and REPORT every
 * drop.
 *
 * ## Why this is in the kit rather than copied a third time
 *
 * It was copied a second time, and the clone ratchet caught it: `atlas/datadog/projection.ts` and
 * `atlas/jumpcloud/projection.ts` were near-identical, differing only in which function decides whether a
 * field name is denied. That is the same family as the hand-rolled `Result` the repository already gates —
 * a shape that regenerates through ordinary, careful work, because the next atlas's author opens whichever
 * sibling they find first. So the walk lives here once and each platform contributes only its judgement.
 *
 * ## Why the projection REPORTS rather than just filtering
 *
 * A silent filter is indistinguishable from a provider that stopped sending the field, and the difference
 * matters twice: coverage has to say the atlas deliberately does not hold a private key rather than imply
 * the provider stopped returning one, and a pre-publish sensitivity gate needs something to check against.
 * So {@link projectAtlasValue} returns the projected value AND the pointers it removed.
 *
 * ## Why a drop is a RECORD rather than a string
 *
 * Three removals happen here and only two of them are the design working. Withholding secret material is a
 * disclosure decision a reader of coverage must be told about; dropping a pagination cursor is
 * housekeeping; hitting the depth bound is a DEFECT SIGNAL — data was truncated, so the family cannot claim
 * complete coverage of that record. Encoding the third as a `" (depth limit)"` suffix on a pointer string
 * made it indistinguishable from the first two at every call site, which is exactly how it went unnoticed.
 *
 * ## The walk sees exactly what could be stored
 *
 * A provider payload arrives as parsed JSON, so in practice it holds only data. The projection does not
 * rely on that: a value carrying a `toJSON` method serialises to something the walk never inspected, and a
 * denied field reintroduced that way would survive a projection that had visibly dropped it. So the input
 * is normalised through the same serialise-and-reparse a writer performs before the walk begins, and what
 * is walked is what would be written. A value that cannot be serialised at all falls back to the raw walk,
 * where the depth bound is what stops a cyclic document — and that fallback is why the walk itself also
 * refuses to copy a function or symbol, so the normalisation cannot be defeated by making it throw.
 *
 * ## Pointers are ESCAPED, and drops are deduplicated by pointer AND reason
 *
 * Both halves close the same hole. A provider is free to name a field `a/b`, and an unescaped pointer for
 * it collides exactly with the pointer for field `b` inside field `a` — so two genuinely different
 * positions produce one string. Deduplicating on that string then erases whichever drop came second, and
 * the one that gets erased can be the `depth-limit` entry, which is the only drop that denies a family
 * `synced`. A truncated document would publish as fully covered. So segments are escaped per RFC 6901
 * (`~` becomes `~0`, `/` becomes `~1`) and the deduplication key carries the reason as well.
 *
 * ## Depth, and why there is a bound at all
 *
 * Provider payloads nest, and a denied field can sit at any level, so the walk is recursive rather than
 * top-level. The bound exists because a provider payload is untrusted input: a cyclic or pathologically
 * deep document would otherwise turn a sync into a stack overflow. Reaching it is reported rather than
 * silently truncated, for the same reason as everything else here.
 */

/**
 * Why one field name is refused at a storage boundary.
 *
 * Kit-owned and CLOSED, for the reason {@link ATLAS_COVERAGE_STATES} is: two atlases independently arrived
 * at exactly these two, and they mean different things to a reader of coverage — withholding a private key
 * is a disclosure decision, dropping a pagination cursor is housekeeping. A platform free to invent a third
 * name is a platform whose withholding sentence stops meaning one thing across the hundred atlases this is
 * built for. A genuinely new reason is a pull request against this line.
 */
type AtlasDenialReason = "secret-material" | "ephemeral-token";

/**
 * Why one position was removed from a stored document.
 *
 * `depth-limit` is the one member that is not a policy decision: it says the walk gave up, so whatever sat
 * below that pointer is neither stored nor known.
 */
type AtlasDropReason = AtlasDenialReason | "depth-limit";

/** One removal, with where it happened and why. */
export interface AtlasDroppedField {
  /** JSON pointer to the position that was removed. Never the value. */
  readonly pointer: string;
  readonly reason: AtlasDropReason;
}

/**
 * What one projection removed, so coverage can state it and a gate can check it.
 *
 * Structural rather than nominally branded, and deliberately so: a brand would need a narrowing type
 * assertion, which `no-unsafe-type-assertion` refuses. The consequence is stated rather than hidden — a
 * caller that hand-builds `{ value: <a truncated document>, dropped: [] }` can still tell coverage a lie
 * about evidence it did not gather. The freezes below stop that happening by accident to a REAL projection;
 * nothing in this process can stop a caller forging one on purpose, and a platform's own sync is the only
 * caller.
 */
export interface AtlasProjection {
  /** The document with every denied field removed, safe to store. */
  readonly value: unknown;
  /** What was removed, sorted by pointer, each pointer-and-reason pair appearing once. */
  readonly dropped: readonly AtlasDroppedField[];
}

/**
 * A platform's own judgement about one field — the ONE thing that differs between atlases here.
 *
 * A platform that decides a denial from more than the field name alone (Datadog's `key` is credential
 * material in six kinds and a case identifier in forty-three) closes over the rest and passes a function of
 * what this walk can see.
 *
 * `record` is the object the field sits DIRECTLY in, and it is here because one real denial cannot be
 * decided without a sibling. JumpCloud's `systeminsights/managed_policies` returns every macOS
 * managed-preference row under the same two column names, so `value` is a screen-lock timeout on one row and
 * the agent's own enrolment secret on the next, and only the sibling `name` separates them. Denying the
 * column outright costs every real posture value in it to withhold the credential rows among them, which is the kind of trade
 * this whole boundary exists to avoid making.
 *
 * It is the CONTAINING object rather than the whole document on purpose. A denial that could read the root
 * would be a rule nobody can check by looking at one record, and the walk would have to carry a growing
 * context down every branch. A sibling is what a reader can see.
 * @internal
 */
export type AtlasFieldDenial = (input: {
  field: string;
  record: Readonly<Record<string, unknown>>;
}) => AtlasDenialReason | null;

/** How deep a provider document is walked before the walk refuses to go further. */
const MAX_DEPTH = 24;

/**
 * Escape one path segment into a JSON pointer token, per RFC 6901.
 *
 * @param segment a property name or array index exactly as it appeared
 * @returns the token, with `~` and `/` escaped so two different positions cannot share one pointer
 */
function escapeSegment({ segment }: { segment: string }): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** Whether a value is a plain JSON object rather than an array or a primitive. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Walk every element of an untrusted array by index, so a caller's own `map` cannot decide the result. */
function walkArray({
  node,
  denyField,
  pointer,
  depth,
  dropped,
}: {
  node: readonly unknown[];
  denyField: AtlasFieldDenial;
  pointer: string;
  depth: number;
  dropped: AtlasDroppedField[];
}): readonly unknown[] {
  const items: unknown[] = [];
  for (let index = 0; index < node.length; index += 1) {
    items.push(
      walk({
        denyField,
        depth: depth + 1,
        dropped,
        node: node[index],
        pointer: `${pointer}/${escapeSegment({ segment: String(index) })}`,
      }),
    );
  }
  return items;
}

/**
 * Walk one record's own properties, dropping every denied field name.
 *
 * A function or symbol is skipped rather than copied, and that is not tidiness: `JSON.stringify` omits both
 * at an object key, so skipping them keeps the projected value identical to what a writer would produce —
 * and it closes the one route by which the serialise-and-reparse normalisation can be defeated, which is a
 * `toJSON` that throws once, survives the raw-walk fallback, and then reintroduces a denied field on the
 * writer's own serialisation.
 */
function walkRecord({
  node,
  denyField,
  pointer,
  depth,
  dropped,
}: {
  node: Record<string, unknown>;
  denyField: AtlasFieldDenial;
  pointer: string;
  depth: number;
  dropped: AtlasDroppedField[];
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "function" || typeof value === "symbol") {
      continue;
    }
    const here = `${pointer}/${escapeSegment({ segment: key })}`;
    const denial = denyField({ field: key, record: node });
    if (denial !== null) {
      dropped.push({ pointer: here, reason: denial });
      continue;
    }
    out[key] = walk({ denyField, depth: depth + 1, dropped, node: value, pointer: here });
  }
  return out;
}

/**
 * Walk one node, dropping denied fields and collecting the removals.
 *
 * @param node the provider value at this position
 * @param denyField the platform's own judgement about a field name
 * @param pointer the JSON pointer to this position, used only for reporting
 * @param depth how far down this call already is
 * @param dropped accumulates removals across the whole walk
 * @returns the projected value at this position
 */
function walk({
  node,
  denyField,
  pointer,
  depth,
  dropped,
}: {
  node: unknown;
  denyField: AtlasFieldDenial;
  pointer: string;
  depth: number;
  dropped: AtlasDroppedField[];
}): unknown {
  if (depth > MAX_DEPTH) {
    dropped.push({ pointer, reason: "depth-limit" });
    return null;
  }
  // A function or symbol is not data. `JSON.stringify` writes `null` for one inside an array, and matching
  // that exactly is what keeps the projected value identical to what a writer would produce.
  if (typeof node === "function" || typeof node === "symbol") {
    return null;
  }
  if (Array.isArray(node)) {
    return walkArray({ denyField, depth, dropped, node, pointer });
  }
  return isRecord(node) ? walkRecord({ denyField, depth, dropped, node, pointer }) : node;
}

/**
 * The value as a writer would serialise it, so the walk cannot miss what serialisation would add.
 *
 * @param value the provider's own JSON, or anything a caller handed in
 * @returns the reparsed value, or the original when it cannot be serialised at all — a cyclic document is
 *   then stopped by the depth bound rather than by an exception here
 */
function serialisableForm({ value }: { value: unknown }): unknown {
  // An absent document is stored as JSON's own absence, `null`: `JSON.stringify` has no text for `undefined`.
  if (value === undefined) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

/**
 * Project one provider document, removing every denied field at any depth.
 *
 * @param denyField the platform's own judgement about a field name, closing over anything else it needs
 * @param value the provider's own JSON, exactly as the response carried it
 * @returns the storable value and every removal, sorted by pointer
 */
export function projectAtlasValue({
  denyField,
  value,
}: {
  denyField: AtlasFieldDenial;
  value: unknown;
}): AtlasProjection {
  const dropped: AtlasDroppedField[] = [];
  const projected = walk({ denyField, depth: 0, dropped, node: serialisableForm({ value }), pointer: "" });
  const seen = new Set<string>();
  const unique = dropped.filter((drop) => {
    // Keyed on reason as well as pointer: a designed removal must never mask a truncation, which is the
    // one drop that denies a family `synced`.
    const key = `${drop.reason} ${drop.pointer}`;
    const already = seen.has(key);
    seen.add(key);
    return !already;
  });
  // Frozen because the drop report is EVIDENCE about the value beside it. `readonly` is a compile-time
  // claim a runtime caller can defeat, and the one entry worth defeating is the depth-limit drop, which is
  // the only thing standing between a truncated document and a `synced` coverage cell.
  return Object.freeze({
    dropped: Object.freeze(
      unique.toSorted((a, b) => a.pointer.localeCompare(b.pointer)).map((drop) => Object.freeze(drop)),
    ),
    value: projected,
  });
}
