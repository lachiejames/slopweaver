/**
 * Joining a reason another module wrote to the clause that follows it. Some producers end a reason on a full stop
 * (`spawnVerb`'s missing-checkout reason does) and most do not, so a fixed `; `, `, ` or `: ` reads `.;`, `.,` or
 * `.:` for the first kind. Pure.
 */

/** A reason that already closes its own sentence. */
const SENTENCE_END = /[.!?]$/u;

/**
 * The reason, then the clause after it.
 *
 * @param reason text another module wrote, ending with or without its own full stop
 * @param joint the punctuation that joins an open reason to the clause, a semicolon, comma or colon
 * @param clause what follows the reason, written lower-case as it reads after the joint
 * @returns `<reason><joint> <clause>`, or `<reason> <Clause>` when the reason already ends its sentence
 */
export function clauseAfter({
  clause,
  joint,
  reason,
}: {
  clause: string;
  joint: ";" | "," | ":";
  reason: string;
}): string {
  const trimmed = reason.trimEnd();
  if (SENTENCE_END.test(trimmed)) {
    return `${trimmed} ${clause.charAt(0).toUpperCase()}${clause.slice(1)}`;
  }
  return `${trimmed}${joint} ${clause}`;
}
