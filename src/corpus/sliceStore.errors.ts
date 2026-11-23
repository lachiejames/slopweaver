/**
 * Typed failures for the slice manifest store ({@link ./sliceStore}) — deliberately fail-loud, so "absent",
 * "unreadable", "malformed" and "already pinned" each carry their own code rather than collapsing into one
 * string a caller can only display. Collapsing "unreadable" into "absent" was the exact defect this store
 * exists to prevent: a caller that cannot tell a missing pin from a corrupt one would happily capture a
 * fresh pin over the top of a file it simply failed to parse.
 */

/** No slice has ever been captured under this name. */
export interface SliceNotFoundError {
  readonly code: "SLICE_NOT_FOUND";
  readonly message: string;
  readonly name: string;
}

/** A slice pin exists on disk but could not be read — NOT the same as absent. */
export interface SliceUnreadableError {
  readonly code: "SLICE_UNREADABLE";
  readonly message: string;
  readonly name: string;
}

/** A slice pin was read but is not valid JSON. */
export interface SliceInvalidJsonError {
  readonly code: "SLICE_INVALID_JSON";
  readonly message: string;
  readonly name: string;
}

/** A slice pin parsed as JSON but is missing fields the manifest requires. */
export interface SliceMissingFieldsError {
  readonly code: "SLICE_MISSING_FIELDS";
  readonly message: string;
  readonly name: string;
}

/** A slice name is not a usable filename fragment. */
export interface SliceInvalidNameError {
  readonly code: "SLICE_INVALID_NAME";
  readonly message: string;
  readonly name: string;
}

/** A slice pin already exists on disk and `--overwrite` was not passed. */
export interface SliceAlreadyExistsError {
  readonly code: "SLICE_ALREADY_EXISTS";
  readonly message: string;
  readonly name: string;
}

/** A slice pin could not be written to disk. */
export interface SliceWriteFailedError {
  readonly code: "SLICE_WRITE_FAILED";
  readonly message: string;
  readonly name: string;
}

/** Every way {@link ./sliceStore} can fail to read or write a slice manifest. */
export type SliceStoreError =
  | SliceNotFoundError
  | SliceUnreadableError
  | SliceInvalidJsonError
  | SliceMissingFieldsError
  | SliceInvalidNameError
  | SliceAlreadyExistsError
  | SliceWriteFailedError;

/** Factories for {@link SliceStoreError} — the one place its message text is composed. */
export const SliceStoreErrors = {
  /**
   * Build a {@link SliceAlreadyExistsError}.
   *
   * @param name the slice name that already has a pin on disk
   * @returns the typed error
   */
  alreadyExists: ({ name }: { name: string }): SliceAlreadyExistsError => ({
    code: "SLICE_ALREADY_EXISTS",
    message: `slice \`${name}\` already has a pin on disk — re-capturing would discard the baseline every later run compares against. Pass --overwrite if that is what you want.`,
    name,
  }),

  /**
   * Build a {@link SliceInvalidJsonError}.
   *
   * @param name the slice name whose pin is not valid JSON
   * @returns the typed error
   */
  invalidJson: ({ name }: { name: string }): SliceInvalidJsonError => ({
    code: "SLICE_INVALID_JSON",
    message: `slice \`${name}\` is not valid JSON — refusing to treat a corrupt pin as a missing one`,
    name,
  }),

  /**
   * Build a {@link SliceInvalidNameError}.
   *
   * @param name the rejected slice name
   * @returns the typed error
   */
  invalidName: ({ name }: { name: string }): SliceInvalidNameError => ({
    code: "SLICE_INVALID_NAME",
    message: `\`${name}\` is not a usable slice name — lower-case letters, digits and hyphens only`,
    name,
  }),

  /**
   * Build a {@link SliceMissingFieldsError}.
   *
   * @param name the slice name whose pin is missing required fields
   * @returns the typed error
   */
  missingFields: ({ name }: { name: string }): SliceMissingFieldsError => ({
    code: "SLICE_MISSING_FIELDS",
    message: `slice \`${name}\` is missing required fields — refusing to compare against a partial pin`,
    name,
  }),
  /**
   * Build a {@link SliceNotFoundError}.
   *
   * @param name the slice name that has no pin on disk
   * @returns the typed error
   */
  notFound: ({ name }: { name: string }): SliceNotFoundError => ({
    code: "SLICE_NOT_FOUND",
    message: `no slice named \`${name}\` — capture one first: slopweaver slice capture --name ${name} --root <dir>`,
    name,
  }),

  /**
   * Build a {@link SliceUnreadableError}.
   *
   * @param name the slice name whose pin could not be read
   * @param cause the underlying read error
   * @returns the typed error
   */
  unreadable: ({ name, cause }: { name: string; cause: unknown }): SliceUnreadableError => ({
    code: "SLICE_UNREADABLE",
    message: `slice \`${name}\` could not be read (${String(cause)}) — this is NOT the same as it being absent, and it must not be treated as one`,
    name,
  }),

  /**
   * Build a {@link SliceWriteFailedError}.
   *
   * @param name the slice name that could not be written
   * @param cause the underlying write error
   * @returns the typed error
   */
  writeFailed: ({ name, cause }: { name: string; cause: unknown }): SliceWriteFailedError => ({
    code: "SLICE_WRITE_FAILED",
    message: `could not write slice \`${name}\`: ${String(cause)}`,
    name,
  }),
} as const;
