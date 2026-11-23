/**
 * Reduce a captured browser response to SHAPE: field-name paths, and nothing that was ever a value.
 *
 * ## Why this is kit-owned, and what a platform still supplies
 *
 * The three reductions generalise perfectly and the constants do not. Values are never read, only object
 * KEYS and array positions become paths; a key that is itself a value is redacted; and a path is capped by
 * depth rather than filtered afterwards. Those are properties of "record what the client asks for, never
 * what this account has", which is true of every console.
 *
 * What is NOT shared is which segments look like values. `atlas/slackApi/harObservations.ts` matches
 * `^[A-Z][A-Z0-9]{8,}$` for a Slack object id — a pattern that matches no CrowdStrike identifier at all, so
 * a Falcon capture reduced with it would keep every real agent id it saw. That is not hypothetical: the
 * first Slack version of this shipped 103 real object ids into a committed file because its redaction only
 * looked for timestamps. So the CLASSIFIER is injected, each platform declares its own, and a platform that
 * declares none redacts nothing — visibly, in its own module, rather than by inheriting a stranger's regex.
 *
 * ## Adjacent collapse, and why it is a property of the segment rather than of the walker
 *
 * A Slack message timestamp keys a map as `<seconds>.<micros>`, which the dotted path splits into two
 * adjacent digit segments that were one value. Collapsing them is right THERE and wrong for an identifier
 * that genuinely repeats, so {@link SegmentVerdict} carries the decision per segment instead of the walker
 * guessing from the placeholder alone.
 */

/** What one path segment is, when it is not a field name. */
export interface SegmentVerdict {
  /** What to write instead — `<ts>`, `<id>`, `<aid>`. */
  readonly placeholder: string;
  /** Whether an immediately preceding segment with the same placeholder was part of the SAME value. */
  readonly collapsesWithPrevious: boolean;
}

/** How a platform recognises a path segment that is a value rather than a field name. */
export type SegmentClassifier = (input: { segment: string }) => SegmentVerdict | null;

/**
 * Redact every path segment that is a VALUE rather than a field name.
 *
 * @param path the dotted path, straight from the capture
 * @param classify the platform's own value-segment recogniser
 * @returns the path with every value-shaped segment replaced
 */
export function redactValueSegments({ path, classify }: { path: string; classify: SegmentClassifier }): string {
  const out: string[] = [];
  let previous: SegmentVerdict | null = null;
  for (const segment of path.split(".")) {
    const verdict = classify({ segment });
    if (verdict === null) {
      out.push(segment);
      previous = null;
      continue;
    }
    const merges = verdict.collapsesWithPrevious && previous !== null && previous.placeholder === verdict.placeholder;
    if (!merges) {
      out.push(verdict.placeholder);
    }
    previous = verdict;
  }
  return out.join(".");
}

/**
 * Every field-name path in a response body, values discarded.
 *
 * An array contributes one `[]` segment however many elements it has, so a 200-record page yields one
 * `resources[].status` rather than two hundred. Every element is still walked, because a provider's arrays
 * are heterogeneous — reading only the first would report a field that appears on the second as absent.
 *
 * @param body the parsed response body
 * @param depthCap how many levels down to keep
 * @returns the distinct paths, unsorted
 */
export function collectResponsePaths({
  body,
  depthCap,
  classify,
}: {
  body: unknown;
  depthCap: number;
  classify?: SegmentClassifier;
}): ReadonlySet<string> {
  const out = new Set<string>();
  walk({ depth: 0, depthCap, out, prefix: "", value: body, ...(classify === undefined ? {} : { classify }) });
  return out;
}

/**
 * One key as its path segment: the classifier's placeholder when it judges the key a value, the key itself when
 * no classifier was supplied or the classifier judges it a field name.
 */
function keySegment({ key, classify }: { key: string; classify: SegmentClassifier | undefined }): string {
  if (classify === undefined) {
    return key;
  }
  const verdict = classify({ segment: key });
  if (verdict === null) {
    return key;
  }
  return verdict.placeholder;
}

/**
 * One node of the response walk.
 *
 * The classifier is applied to each KEY here, before the key is joined into a dotted path, and that timing
 * is the whole reason it is passed down rather than left to the redaction pass. A key that is itself a
 * value can contain a dot — `{"membersByEmail": {"alice@corp.example": …}}` is the measured case — and once
 * it has been joined, splitting on `.` fragments one value into two segments, of which only the first looks
 * like a value. The second half of a real email address then survives redaction as though it were a field
 * name. Classifying the key while it is still one string is the only place that cannot happen.
 */
function walk({
  value,
  prefix,
  out,
  depth,
  depthCap,
  classify,
}: {
  value: unknown;
  prefix: string;
  out: Set<string>;
  depth: number;
  depthCap: number;
  classify?: SegmentClassifier;
}): void {
  if (depth > depthCap || value === null || typeof value !== "object") {
    return;
  }
  const descend = classify === undefined ? {} : { classify };
  if (Array.isArray(value)) {
    for (const entry of value) {
      walk({ depth, depthCap, out, prefix: `${prefix}[]`, value: entry, ...descend });
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const segment = keySegment({ classify, key });
    const path = prefix === "" ? segment : `${prefix}.${segment}`;
    out.add(path);
    walk({ depth: depth + 1, depthCap, out, prefix: path, value: child, ...descend });
  }
}

/**
 * Collect and redact one response body in one call — the shape a caller almost always wants.
 *
 * @param body the parsed response body
 * @param depthCap how many levels down to keep
 * @param classify the platform's own value-segment recogniser
 * @returns the redacted paths, sorted, deduplicated after redaction
 */
export function responseFieldPaths({
  body,
  depthCap,
  classify,
}: {
  body: unknown;
  depthCap: number;
  classify: SegmentClassifier;
}): readonly string[] {
  const redacted = new Set<string>();
  for (const path of collectResponsePaths({ body, classify, depthCap })) {
    redacted.add(redactValueSegments({ classify, path }));
  }
  return [...redacted].toSorted();
}
