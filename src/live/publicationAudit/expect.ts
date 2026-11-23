/**
 * `audit publications --expect <door>:<class>:<link>` — a finding a run must produce, named by class and address only.
 *
 * The audit's first run has to find hits already known to be published, as proof it works, while its output stays
 * counts. An expectation is how that proof is taken without printing anything found: the caller names the class and
 * the link, the run checks its own sanitised findings for that exact pair, and it answers met or missed by position.
 * The term itself is never an input, so the proof cannot leak it either.
 *
 * Pure: no I/O.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { PUBLICATION_DOORS, type PublicationDoor, type PublicationFinding } from "./types.js";

/** One finding a run must produce. */
export interface PublicationExpectation {
  readonly door: PublicationDoor;
  readonly className: string;
  readonly link: string;
}

/** The class part's shape: a category, a slash, a slug. */
const CLASS_SHAPE = /^(?:installation-state|hygiene|private-term)\/[a-z0-9-]+$/u;

/**
 * Parse one `--expect` value. The link is everything after the second colon, so its own `https:` survives.
 *
 * @param value the flag's value
 * @returns the expectation, or why the value is not one
 */
export function parsePublicationExpectation({ value }: { value: string }): Result<PublicationExpectation, string> {
  const first = value.indexOf(":");
  const second = first < 0 ? -1 : value.indexOf(":", first + 1);
  if (first < 0 || second < 0) {
    return err("--expect takes <door>:<class>:<link>, e.g. github:private-term/money:<pull request address>");
  }
  const doorPart = value.slice(0, first);
  const className = value.slice(first + 1, second);
  const link = value.slice(second + 1);
  const door = PUBLICATION_DOORS.find((candidate) => candidate === doorPart);
  if (door === undefined) {
    return err(`--expect door must be one of ${PUBLICATION_DOORS.join(", ")}`);
  }
  if (!CLASS_SHAPE.test(className)) {
    return err("--expect class must be installation-state/<kind>, hygiene/<label> or private-term/<class>");
  }
  if (!link.startsWith("https://")) {
    return err("--expect link must be an https address");
  }
  return ok({ className, door, link });
}

/**
 * Which expectations a run's findings meet, by position — never echoing the expectation itself. An expectation naming
 * a thread's address is met by a finding on the thread itself or anchored inside it (the address, then `#` and a
 * comment anchor): a hit known to be on one pull request may sit in its body, a comment or a review.
 *
 * @param expectations what the caller named
 * @param findings the run's sanitised findings
 * @returns one boolean per expectation, in order
 */
export function publicationExpectationsMet({
  expectations,
  findings,
}: {
  expectations: readonly PublicationExpectation[];
  findings: readonly PublicationFinding[];
}): readonly boolean[] {
  return expectations.map((expected) =>
    findings.some(
      (finding) =>
        finding.door === expected.door &&
        finding.className === expected.className &&
        finding.link !== null &&
        (finding.link === expected.link || finding.link.startsWith(`${expected.link}#`)),
    ),
  );
}
