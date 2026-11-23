/**
 * The DOOR half of "an outbound text run never carries a raw link or a raw mention".
 *
 * `../artifact/typedRuns.ts` converts what a composer wrote; this refuses what any composer still leaves
 * behind. The two halves are not redundant, and the reason is the whole point of doing both:
 *
 * - Conversion runs inside the artifact FORMS, so it covers every path that fills one — the card, the
 *   answer, the as-me drip. A payload built by hand, or by a renderer that never touched a form, is not
 *   covered by it at all, and the sightings that motivated this were both composers nobody had thought to
 *   check.
 * - This refusal runs on the RENDERED payload — the literal blocks about to go on the wire — so it cannot
 *   be routed around by adding a new composer. That is the property being bought: no FUTURE path can
 *   reintroduce the class without failing here.
 *
 * It walks the payload structurally rather than knowing which block types exist, because the thing being
 * protected is a `rich_text` `text` element wherever one occurs — inside a section, a list item, a table
 * cell, or an `attachments` wrapper's blocks. Two node kinds are skipped deliberately:
 *
 *  1. **`rich_text_preformatted`** — a code block is literal by request, exactly like a `code` span.
 *  2. **`mrkdwn`** — Slack PARSES mrkdwn, so a link or a mention written there already works. This class is
 *     specific to `rich_text`, where markup is inert; see `./render.ts`'s header for the measurement.
 */
import { rawMarkupRefusal, scanRawMarkup } from "../artifact/typedRuns.js";

/** Raised when a payload would post raw markup at a reader. Carries every violation, so one fix pass sees them all. */
export class TypedRunsOnlyError extends Error {
  /** Every refusal sentence, in document order. */
  readonly violations: readonly string[];

  constructor({ surface, violations }: { surface: string; violations: readonly string[] }) {
    super(
      `${surface}: ${String(violations.length)} outbound text run(s) carry raw markup that renders ` +
        `literally — ${violations.join(" | ")}`,
    );
    this.name = "TypedRunsOnlyError";
    this.violations = violations;
  }
}

/** A plain object, as the only thing worth descending into. Narrower than `object` so an array takes the array branch. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `type` discriminator of a payload node, when it has one. */
function nodeType({ node }: { node: Record<string, unknown> }): string | undefined {
  return typeof node["type"] === "string" ? node["type"] : undefined;
}

/**
 * Whether a `rich_text` text element is styled `code`.
 *
 * Read off the RENDERED element rather than inferred, because that is what the reader will see — and it has
 * to agree with `convertibleRun`'s answer about the same span before conversion, or a code URL would be
 * converted by one half and refused by the other.
 */
function isCodeElement({ node }: { node: Record<string, unknown> }): boolean {
  const style = node["style"];
  return isRecord(style) && style["code"] === true;
}

/** Collect the violations under one node, descending into anything that can hold a `rich_text` element. */
function walk({ node, into }: { node: unknown; into: string[] }): void {
  if (Array.isArray(node)) {
    node.forEach((child) => {
      walk({ into, node: child });
    });
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  const type = nodeType({ node });
  if (type === "rich_text_preformatted" || type === "mrkdwn") {
    return;
  }
  if (type === "text" && !isCodeElement({ node })) {
    const text = node["text"];
    if (typeof text === "string") {
      for (const span of scanRawMarkup({ text })) {
        into.push(rawMarkupRefusal({ span }));
      }
    }
    return;
  }
  Object.values(node).forEach((child) => {
    walk({ into, node: child });
  });
}

/**
 * Every raw-markup violation in a rendered payload, in document order.
 *
 * Takes `unknown` on purpose. The payload types this guards ({@link SlackCardPayload}, the answer, the
 * drip, the recipe response, a progress frame) share no supertype, and a union of them would have to be
 * widened every time a surface is added — which is precisely the "a new path escapes the check" failure
 * this exists to prevent. The walk needs no type information beyond `type` and `text`.
 *
 * @param payload the rendered payload, or any part of one
 * @returns one refusal sentence per violation; empty when the payload is clean
 */
export function typedRunsOnlyViolations({ payload }: { payload: unknown }): readonly string[] {
  const violations: string[] = [];
  walk({ into: violations, node: payload });
  return violations;
}

/**
 * REFUSE a payload whose text runs carry raw markup. The last thing between a composer and the wire.
 *
 * @param payload the rendered payload about to be sent
 * @param surface which send this is, so the error names the path rather than only the symptom
 */
export function assertTypedRunsOnly({ payload, surface }: { payload: unknown; surface: string }): void {
  const violations = typedRunsOnlyViolations({ payload });
  if (violations.length > 0) {
    throw new TypedRunsOnlyError({ surface, violations });
  }
}
