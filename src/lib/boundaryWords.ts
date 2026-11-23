/**
 * A boundary refusal in words safe to print from a door whose responses carry a person's details.
 *
 * `BoundaryErrors.shapeChanged`'s own message quotes every drifted path, and a path is built from the provider's
 * KEYS, so an undeclared key that is a phone number or an email address prints verbatim. Measured:
 * a Knock recipient carrying `"+61400000123": true` reached stderr as `new field "items[0].recipient.+61400000123"`.
 * Here each path segment that is not identifier-shaped is withheld, every digit left in the path prints as `#`, and
 * zod's own issue text is never quoted. So the words hold no `+`, no `@` and no digit the provider chose: a phone
 * number cannot survive even split across keys (`recipient0400000123`, or `a040.b000.c123`), and neither can an
 * email address. The cost is a list index, which prints as `[#]`; the field name is what a reader acts on.
 */
import type { BoundaryDrift, BoundaryError } from "./boundary.js";

/** A key a reader can name: an identifier, then any list indices. */
const SAFE_SEGMENT = /^(?:[A-Za-z_][A-Za-z0-9_]*)?(?:\[\d+\])*$/;

/** What a withheld segment prints as. */
const WITHHELD_SEGMENT = "‹withheld key›";

/**
 * A drift path with every segment that could carry a value withheld, and every digit masked.
 *
 * @param path the drift's path text, `a.b[0].c` or `(body)`
 * @returns the path, each unsafe segment replaced and each digit `#`
 */
function safePath({ path }: { path: string }): string {
  if (path === "(body)") {
    return path;
  }
  return path
    .split(".")
    .map((segment) => (SAFE_SEGMENT.test(segment) ? segment.replace(/[0-9]/g, "#") : WITHHELD_SEGMENT))
    .join(".");
}

/**
 * One drift entry, worded from its kind and its safe path alone.
 *
 * @param drift one entry of a shape-changed refusal
 * @returns the sentence fragment for it
 */
function driftWords({ drift }: { drift: BoundaryDrift }): string {
  const path = safePath({ path: drift.path });
  switch (drift.kind) {
    case "new": {
      return `new field "${path}"`;
    }
    case "renamed": {
      return `new field "${path}", likely a rename`;
    }
    case "missing": {
      return `field "${path}" is missing`;
    }
    case "changed": {
      return `field "${path}" changed type or value set`;
    }
    default: {
      const unhandled: never = drift.kind;
      return unhandled;
    }
  }
}

/**
 * Why a boundary refused a response, without one value, digit or non-identifier key the provider chose.
 *
 * @param refusal the boundary's own refusal
 * @returns the words, for a door's response-refused error
 */
export function boundaryRefusalWords({ refusal }: { refusal: BoundaryError }): string {
  if (refusal.code === "BOUNDARY_NOT_JSON") {
    return "the body is not JSON";
  }
  return `the shape changed: ${refusal.drift.map((drift) => driftWords({ drift })).join("; ")}`;
}
