/**
 * The shape of a resolved `--person`, apart from the resolver, so a pure SQL builder can read one without
 * importing the module that reaches the database for it.
 */

/** One person as the matcher sees them: their id, their name, their key and every platform id they carry. */
export interface PersonCandidate {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly slackUserId: string | null;
  readonly linearUserId: string | null;
  readonly githubId: string | null;
  readonly githubLogin: string | null;
  readonly notionUserId: string | null;
}

/**
 * Which of the three ways a name matched a person, so a report can say why it believes them the same.
 *
 * @internal
 */
export type PersonMatchWay = "display-name" | "handle" | "email";

/** One matched person, and the way the name reached them. */
export interface PersonMatch {
  readonly person: PersonCandidate;
  readonly way: PersonMatchWay;
  /** Which sources that person carries an id on, sorted — what "across these platforms" resolves to. */
  readonly sources: readonly string[];
}
