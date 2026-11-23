/**
 * What identifies one shape — the key, the message template, and the site each family is keyed on. Pure.
 *
 * ## The key is this seat's call, and this is the call
 *
 * The owner leaves the shape key to whatever works best in practice for the detectives, who are its main
 * consumers.
 *
 * So the key is chosen for the detective rather than for the store, and the detective's use of it is
 * singular: it reads a row, and it then has to write a Datadog query that finds today's instances of that
 * row. **A key a detective cannot paste into a query is a key that makes it guess.**
 *
 * The key is `family|env|service|site`, and for a log the site is the `[bracketed]` prefix the line's own
 * message carries. That is what makes the choice work in practice on this organisation: `"[sessionTypeForBooking]"`
 * is a literal a detective can quote into the Explorer and get exactly this shape's events back, whereas a
 * message TEMPLATE is a derived string that matches nothing when pasted — its digits and UUIDs have been
 * replaced with placeholders precisely so it can be a key, which is the property that stops it being a query.
 *
 * The template is stored BESIDE the key rather than instead of it, because it is what makes a row readable
 * by a person; it is just not what makes it findable by a detective. Both, not one.
 *
 * **A line with no bracket still gets a key**, from its own normalised template, because the alternative is
 * an `(unkeyed)` bucket that grows to hold every service that does not use the convention — and this
 * organisation's browser and third-party sources do not use it at all.
 *
 * ## `env` is part of the key, because the scope is all logs
 *
 * The scope is every environment. Production is a fine place to start, but the owner sometimes needs staging or
 * other kinds of logs, and pre-existing bugs mean some logs carry the wrong env key or none.
 *
 * Three consequences, all of them in this file. `env` is a key FIELD, so staging's shape of a site and
 * production's shape of the same site are two rows and a detective can see them diverge. A missing env key
 * resolves to {@link ENV_ABSENT} rather than being dropped or defaulted to production — a defaulted one is
 * the confident wrong answer, since the whole reason the scope is wide is that the key is sometimes wrong. And a
 * WRONG env key is simply its own env value, which needs no special handling at all: it shows up as a row
 * under an env nobody deploys, which is itself the finding.
 */

import { SHAPE_FAMILIES, type ShapeFamily, shapeFamilySpec } from "./family.js";

/**
 * The env a shape carries when the event declared none.
 *
 * Parenthesised so it cannot collide with a real environment name — Datadog's own tag values cannot contain
 * a parenthesis — and so a reader never mistakes it for a deployment called "none".
 */
export const ENV_ABSENT = "(none)";

/** The service a shape carries when the event declared none. Same construction as {@link ENV_ABSENT}. */
export const SERVICE_ABSENT = "(none)";

/** The site a shape falls back to when nothing in its family's priority list, and no template, is present. */
export const SITE_ABSENT = "(none)";

/** How many characters of a normalised template may stand in for a missing site. *
 * @internal
 */
export const TEMPLATE_SITE_CHARS = 60;

/**
 * The leading `[bracketed]` token a log message may carry, and nothing else.
 *
 * Anchored at the start: a bracket anywhere else in a line is data — an array literal, a quoted path, a
 * `[object Object]` — and keying on it produces one shape per distinct payload, which is the exact opposite
 * of what a catalogue is for.
 *
 * The token must also LOOK like a name an engineer wrote: it starts with a letter and holds only the
 * characters an identifier, a path or a hyphenated slug uses. A first cut only excluded brackets and
 * newlines, on the reasoning that a leading array would not match — and `["a","b"] parsed` matched it
 * perfectly, because the inside of that array contains neither. One shape per JSON payload is the failure
 * the whole anchoring rule exists to prevent, reached through the gap in its own implementation.
 */
const LEADING_BRACKET = /^\s*\[([A-Za-z][A-Za-z0-9_.:/ -]{0,79})\]/;

/**
 * Replace the parts of a message that vary per event, so two instances of one site fold to one template.
 *
 * The order is load-bearing. A UUID contains digit runs, so replacing digits first carves it into
 * `[n]a8c3-[n]c3e-…` and two UUIDs then normalise to two DIFFERENT templates — the mangling
 * `src/corpus/redact.ts` documents on its own `\d{9,}` pass, reached here for a different reason and with
 * the same fix: the wider shape runs first.
 *
 * Emails go before the bare-number pass for the same reason and before nothing else: an address's local part
 * routinely carries digits.
 *
 * @param message the event's own message, exactly as Datadog returned it
 * @returns the message with every per-event value replaced by a placeholder
 */
export function templateOf({ message }: { message: string }): string {
  return message
    .replaceAll(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "<uuid>")
    .replaceAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "<email>")
    .replaceAll(/\b[0-9a-fA-F]{24,}\b/g, "<hex>")
    .replaceAll(/\b\d[\d.:-]*\d\b|\b\d\b/g, "<n>")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/**
 * The `[bracketed]` emitting site a log message names, or nothing when it carries none.
 *
 * @param message the event's own message
 * @returns the site INCLUDING its brackets, so it is already the literal a query quotes
 */
export function bracketedSite({ message }: { message: string }): string | null {
  const found = LEADING_BRACKET.exec(message);
  return found === null ? null : `[${found[1]!}]`;
}

/**
 * Where a site came from — which is what decides the query that reproduces it.
 *
 * Carried rather than re-derived because the site is the FIRST PRESENT of a priority list, so two rows of
 * one family can be keyed on two different attributes. A query built from the family's first declared path
 * would then be wrong for every row that fell through to the second, and wrong in the way that reads as a
 * shape which has stopped emitting: it returns zero.
 */
export type SiteOrigin =
  | { readonly kind: "attribute"; readonly path: string }
  | { readonly kind: "message-bracket" }
  | { readonly kind: "message-template" }
  | { readonly kind: "absent" };

/** A site, and where it was read from. */
export interface SiteReading {
  readonly site: string;
  readonly origin: SiteOrigin;
}

/**
 * The first present value of a family's own priority list, tried under every envelope.
 *
 * Every envelope, because the three surfaces nest the same attribute differently and the SDK adds a fourth
 * spelling of its own. MEASURED: a span's `operation_name` arrives at
 * `additionalProperties.operation_name`, because the typed `Span` model does not declare it and the SDK's
 * deserialiser parks every undeclared field there. A build that tried only the first two spellings keyed
 * every span in the catalogue as `(none)`.
 *
 * @param family which telemetry surface the event came from
 * @param attributes the event's own flattened attributes, by path
 * @returns the reading, or nothing when no declared path is present
 */
function firstPresentAttribute({
  family,
  attributes,
}: {
  family: ShapeFamily;
  attributes: Readonly<Record<string, unknown>>;
}): SiteReading | null {
  for (const declared of shapeFamilySpec({ family }).siteFrom) {
    for (const path of [declared, `attributes.${declared}`, `additionalProperties.${declared}`]) {
      const value = attributes[path];
      if (typeof value === "string" && value.length > 0) {
        return { origin: { kind: "attribute", path }, site: value };
      }
    }
  }
  return null;
}

/**
 * The site one event is keyed on, for its family.
 *
 * A log takes its bracketed prefix; every other family takes the first present value of its own priority
 * list ({@link ./family.SHAPE_FAMILY_SPECS}). All five fall back to a truncated template, and only then to
 * {@link SITE_ABSENT} — an event with neither a keyable attribute nor a message, which is a real shape on
 * this organisation and is worth one row saying so rather than being dropped.
 *
 * @param family which telemetry surface the event came from
 * @param attributes the event's own flattened attributes, by path
 * @param message the event's own message, or nothing when its family carries none
 * @returns the site and where it was read from
 */
export function siteOf({
  family,
  attributes,
  message,
}: {
  family: ShapeFamily;
  attributes: Readonly<Record<string, unknown>>;
  message: string | null;
}): SiteReading {
  if (family === "log") {
    const bracket = message === null ? null : bracketedSite({ message });
    if (bracket !== null) {
      return { origin: { kind: "message-bracket" }, site: bracket };
    }
  }
  const fromAttribute = firstPresentAttribute({ attributes, family });
  if (fromAttribute !== null) {
    return fromAttribute;
  }
  if (message !== null && message.trim().length > 0) {
    return {
      origin: { kind: "message-template" },
      site: templateOf({ message }).slice(0, TEMPLATE_SITE_CHARS),
    };
  }
  return { origin: { kind: "absent" }, site: SITE_ABSENT };
}

/** The four fields that identify one shape, before they are joined. */
export interface ShapeIdentity {
  readonly family: ShapeFamily;
  readonly env: string;
  readonly service: string;
  readonly site: string;
}

/**
 * The key one shape is stored and addressed under.
 *
 * Joined with `|` rather than `:` because a service name, a RUM route group and a span resource all contain
 * colons on this organisation, and a key a reader cannot split back into its four fields is a key that has
 * to be carried alongside the fields it was built from.
 *
 * @returns the key
 */
export function shapeKey({ identity }: { identity: ShapeIdentity }): string {
  return [identity.family, identity.env, identity.service, identity.site].join("|");
}

/**
 * Split a key back into the four fields it was built from.
 *
 * The site may itself contain a `|` — nothing stops a span resource from carrying one — so the split is
 * bounded to three and the remainder is the site, rather than a plain `split("|")` that would truncate it.
 *
 * @param key a key {@link shapeKey} produced
 * @returns the four fields, or nothing when the string is not a key
 */
export function parseShapeKey({ key }: { key: string }): ShapeIdentity | null {
  const parts = key.split("|");
  if (parts.length < 4) {
    return null;
  }
  const [rawFamily, env, service, ...rest] = parts;
  const family = SHAPE_FAMILIES.find((known) => known === rawFamily);
  if (family === undefined) {
    return null;
  }
  return { env: env!, family, service: service!, site: rest.join("|") };
}
