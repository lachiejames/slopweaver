/**
 * What a row's SUBJECT may be — the checkable id of the thing that was acted on. Pure: a string in, a
 * classified subject or the refusal out, no filesystem and no network.
 *
 * ## Why this is three forms rather than one URL
 *
 * The field is a checkable id such as a PR URL or Slack permalink, and reading that as URL-ONLY is too
 * narrow against what the fleet actually records: of 53 acts in a live register, **eleven carried a subject
 * that is not a URL** — ten handover board slugs such as `acquireoperationlock-s-stale-lock-takeover-is-not-mutually`,
 * and one naming a file under the state home. Reproduce the shape of that measurement with
 * `slopweaver autonomy list --json | grep -c '"subject": "https'` against the same file's object count.
 *
 * This is `./types.ts`'s argument about `kind` being an OPEN vocabulary, applied to the other identity
 * field, and for the same reason: a register whose whole value is completeness must not REFUSE to record a
 * real act because the thing acted on has no web page. A board row IS checkable — `slopweaver handover
 * resume <slug>` resolves it — and a file under the state home is checkable by opening it.
 *
 * ## What it still refuses, and why that is the whole point
 *
 * Free prose, a bare `#<number>`, a `repo#<number>`, a relative web path, `mailto:`, `file:` and `javascript:`. The
 * field is an IDENTIFIER, never a description: a subject a reader cannot resolve to one object leaves the owner
 * steering a row whose target they have to guess at, which is the failure the field exists to prevent. Widening
 * to "any non-empty string" would have adopted the eleven rows too, and would have cost the property.
 *
 * Nothing here asks the filesystem or the network whether the target EXISTS. A URL has never been checked
 * that way either, and a pure predicate that did I/O could not be the same rule in a schema, a parser and a
 * renderer. What the syntax buys is that a writer named something resolvable; what it does not buy is proof
 * that the thing is there.
 */
import { AUTONOMY_BOARD_SLUG_PATTERN, AUTONOMY_RUN_MAX, AUTONOMY_SUBJECT_MAX } from "./types.js";

/** The prefix a state-home reference carries, so it cannot be confused with a bare slug. */
export const STATE_SUBJECT_PREFIX = "state:";

/**
 * One path segment of a state reference: it OPENS and CLOSES on a letter or digit, with dots, hyphens and
 * underscores allowed between. `.` and `..` cannot match, so traversal is refused by the shape rather than by
 * a later check — and neither can `notes...`, whose derived label would end in an ellipsis and be refused by
 * the page's own no-truncation rule.
 */
const STATE_SEGMENT_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * A subject, once it is known which of the three forms it takes.
 *
 * A real exported contract rather than an inline type: `./label.ts` and `../outbound/briefing/render.ts`
 * both branch on the arm — the renderer emits an anchor for a `url` and escaped text for the other two — so
 * the discriminant is a shape two modules share rather than a single use.
 */
export type AutonomySubject =
  | { readonly kind: "url"; readonly value: string }
  | { readonly kind: "board"; readonly value: string }
  | { readonly kind: "state"; readonly value: string; readonly relativePath: string };

/**
 * Whether a string is an absolute http or https URL — the form the owner can open in a browser.
 *
 * Whitespace is refused BEFORE the parse, and that check is load-bearing rather than tidiness: `new URL`
 * percent-encodes a space instead of rejecting it, so four URLs separated by spaces parse as one URL and
 * render as a link to `…/16365%20https:…`, which opens nothing. Two real rows in the live register were
 * exactly that — `rerun-cancelled-ci` and `rerun-outcome-verified`, each naming four acme-admin pull requests
 * in one field — and both rendered a dead link on the page the owner reads. A subject names ONE object; a row about
 * four is four rows, or one row whose `why` lists the rest.
 */
function asUrl({ subject }: { subject: string }): AutonomySubject | undefined {
  if (/\s/u.test(subject)) {
    return undefined;
  }
  // The `//` is required in the RAW string, not merely in what `new URL` normalises it to. `https:/host/x`
  // parses, reports `https:` as its protocol and normalises its own `href` to `https://host/x` — but the
  // value STORED and put in the `href` attribute keeps the single slash, which a browser resolves against
  // the briefing's own host. The row then names a pull request and links to
  // `https://<briefing-host>/github.com/…`.
  if (!subject.startsWith("http://") && !subject.startsWith("https://")) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(subject);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return undefined;
  }
  return { kind: "url", value: subject };
}

/** Whether a string is a board row slug — the id `slopweaver handover resume` takes. */
function asBoard({ subject }: { subject: string }): AutonomySubject | undefined {
  if (subject.length > AUTONOMY_RUN_MAX || !AUTONOMY_BOARD_SLUG_PATTERN.test(subject)) {
    return undefined;
  }
  return { kind: "board", value: subject };
}

/** Whether a string is a `state:`-prefixed reference to a file under the resolved state home. */
function asState({ subject }: { subject: string }): AutonomySubject | undefined {
  if (!subject.startsWith(STATE_SUBJECT_PREFIX)) {
    return undefined;
  }
  const relativePath = subject.slice(STATE_SUBJECT_PREFIX.length);
  const segments = relativePath.split("/");
  if (segments.length === 0 || !segments.every((segment) => STATE_SEGMENT_PATTERN.test(segment))) {
    return undefined;
  }
  return { kind: "state", relativePath, value: subject };
}

/**
 * Classify a subject into the form it takes, or answer undefined when it is none of them.
 *
 * The order is URL, then `state:`, then board slug, and only the middle one could ever be ambiguous: a
 * `state:` value is refused as a URL because its protocol is neither http nor https, and it can never match
 * the slug pattern because that pattern has no colon.
 *
 * @param subject the row's subject exactly as it was written
 * @returns the classified subject, or undefined when it is not a checkable id at all
 */
export function classifyAutonomySubject({ subject }: { subject: string }): AutonomySubject | undefined {
  if (subject.length === 0 || subject.length > AUTONOMY_SUBJECT_MAX) {
    return undefined;
  }
  const url = asUrl({ subject });
  if (url !== undefined) {
    return url;
  }
  const state = asState({ subject });
  if (state !== undefined) {
    return state;
  }
  return asBoard({ subject });
}
