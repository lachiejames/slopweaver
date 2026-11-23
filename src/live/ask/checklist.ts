/**
 * The capture-time checklist identity — the one thing `../listen/mention.ts`, `../turn/brief.ts`,
 * `./lifecycle.ts`, `./recover.ts` and `../turn/dispatch.ts` all need to refer to the SAME working message a
 * listener already posted, right after the capture reaction, before any turn has run. Living here rather
 * than declared separately in each of those (as it used to be, structurally identical but not the same
 * type) is what makes "the same checklist" a fact the type system can check rather than a convention five
 * modules each hoped the others followed.
 */

/** The capture-time checklist a listener already posted — its `turnId`/`workingTs`, nothing else. */
export interface StartedChecklist {
  readonly turnId: string;
  readonly workingTs: string;
}

/**
 * Whether `value` carries every field a {@link StartedChecklist} declares.
 *
 * @param value the value to check
 * @returns `true` exactly when `value` is a genuine {@link StartedChecklist}
 */
export function isStartedChecklist(value: unknown): value is StartedChecklist {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { turnId?: unknown }).turnId === "string" &&
    typeof (value as { workingTs?: unknown }).workingTs === "string"
  );
}
