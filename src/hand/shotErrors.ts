/**
 * The picture store's own typed failure (`./shotStore.ts`): a step's picture that could not be read from where
 * it was named, or could not be stored under the home.
 *
 * Its own domain rather than a member of `./errors.ts`'s register union, because it is a fact about a FILE the
 * poster named and the store it is copied into, never about the register: when it fires nothing was appended,
 * and the step waits on the picture.
 */

/** The picture could not be read, was too large, or could not be stored, at the path it names. */
export interface ShotStoreError {
  readonly code: "SHOT_STORE";
  readonly message: string;
  readonly path: string;
  readonly cause?: unknown;
}

/** Every way the picture store fails. */
export type HandShotError = ShotStoreError;

/** Constructors for {@link HandShotError}. */
export const HandShotErrors = {
  shotStore: ({ path, why, cause }: { path: string; why: string; cause?: unknown }): ShotStoreError => ({
    cause,
    code: "SHOT_STORE",
    message: `the step's picture at ${path} ${why} — nothing was posted`,
    path,
  }),
} as const;
