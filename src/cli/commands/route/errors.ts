/**
 * The typed failures the `route` verbs author themselves while reading the file a flag named: it could not be
 * read, it is not JSON, it is JSON of the wrong shape, or its entries are refused one by one.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this directory. `label` is the verb's own
 * name for the file ("cases file", "capability profile"), or `null` where the message names the path alone. A
 * per-entry refusal carries every problem as `reasons`, and {@link routeCommandErrorLines} prints them one line
 * each, as the `readonly string[]` it replaced did.
 */

/** The named file could not be read; `detail` is the reader's own account. */
export interface RouteCommandFileUnreadableError {
  readonly code: "FILE_UNREADABLE";
  readonly message: string;
  readonly label: string | null;
  readonly path: string;
  readonly detail: string;
}

/** The named file was read and is not JSON. */
export interface RouteCommandFileNotJsonError {
  readonly code: "FILE_NOT_JSON";
  readonly message: string;
  readonly label: string | null;
  readonly path: string;
}

/** The named file is JSON of a shape the verb does not read. */
export interface RouteCommandFileShapeInvalidError {
  readonly code: "FILE_SHAPE_INVALID";
  readonly message: string;
  readonly label: string;
  readonly path: string;
}

/** The named file's entries are refused for every reason in `reasons`, each its own line. */
export interface RouteCommandFileContentInvalidError {
  readonly code: "FILE_CONTENT_INVALID";
  readonly message: string;
  readonly label: string | null;
  readonly path: string;
  readonly reasons: readonly string[];
}

/** Every failure this directory authors. */
export type RouteCommandError =
  | RouteCommandFileUnreadableError
  | RouteCommandFileNotJsonError
  | RouteCommandFileShapeInvalidError
  | RouteCommandFileContentInvalidError;

/** How a message names the file: its label and path, or the path alone. */
function subjectOf({ label, path }: { label: string | null; path: string }): string {
  if (label === null) {
    return path;
  }
  return `${label} ${path}`;
}

/** A shape refusal, named. */
function shapeInvalid({
  label,
  path,
  message,
}: {
  label: string;
  path: string;
  message: string;
}): RouteCommandFileShapeInvalidError {
  return { code: "FILE_SHAPE_INVALID", label, message, path };
}

/** An entry-by-entry refusal, joined for a one-line display. */
function contentInvalid({
  label,
  path,
  reasons,
}: {
  label: string | null;
  path: string;
  reasons: readonly string[];
}): RouteCommandFileContentInvalidError {
  return { code: "FILE_CONTENT_INVALID", label, message: reasons.join("; "), path, reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const RouteCommandErrors = {
  casesMalformed: ({ path, count }: { path: string; count: number }): RouteCommandFileShapeInvalidError =>
    shapeInvalid({
      label: "cases file",
      message: `cases file ${path} has ${String(count)} malformed case(s) missing a required field`,
      path,
    }),
  casesNotWrapped: ({ path }: { path: string }): RouteCommandFileShapeInvalidError =>
    shapeInvalid({ label: "cases file", message: `cases file ${path} must be {"cases": [...]}`, path }),
  decisionsInvalid: ({
    path,
    reasons,
  }: {
    path: string;
    reasons: readonly string[];
  }): RouteCommandFileContentInvalidError => contentInvalid({ label: "decisions file", path, reasons }),
  decisionsNotObject: ({ path }: { path: string }): RouteCommandFileShapeInvalidError =>
    shapeInvalid({
      label: "decisions file",
      message: `decisions file ${path} must be a JSON object mapping case id to a decision`,
      path,
    }),
  fileNotJson: ({ label, path }: { label: string | null; path: string }): RouteCommandFileNotJsonError => ({
    code: "FILE_NOT_JSON",
    label,
    message: `${subjectOf({ label, path })} is not valid JSON`,
    path,
  }),
  fileUnreadable: ({
    label,
    path,
    detail,
  }: {
    label: string | null;
    path: string;
    detail: string;
  }): RouteCommandFileUnreadableError => ({
    code: "FILE_UNREADABLE",
    detail,
    label,
    message: `could not read ${subjectOf({ label, path })}: ${detail}`,
    path,
  }),
  heldOutNotStrings: ({ path }: { path: string }): RouteCommandFileShapeInvalidError =>
    shapeInvalid({ label: "held-out cases", message: `held-out cases ${path} must be a JSON array of strings`, path }),
  /** A capability profile refused by its parser, each problem prefixed with how the verb names the file. */
  profileInvalid: ({
    label,
    path,
    problems,
  }: {
    label: string | null;
    path: string;
    problems: readonly string[];
  }): RouteCommandFileContentInvalidError =>
    contentInvalid({
      label,
      path,
      reasons: problems.map((problem) => `${subjectOf({ label, path })}: ${problem}`),
    }),
  sourceRowInvalid: ({ path, index }: { path: string; index: number }): RouteCommandFileShapeInvalidError =>
    shapeInvalid({
      label: "sources manifest",
      message: `sources manifest ${path}[${String(index)}] must be {"label": string, "path": string}`,
      path,
    }),
  sourcesNotArray: ({ path }: { path: string }): RouteCommandFileShapeInvalidError =>
    shapeInvalid({ label: "sources manifest", message: `sources manifest ${path} must be a JSON array`, path }),
} as const;

/**
 * The lines a {@link RouteCommandError} prints, one per problem. An entry-by-entry refusal gives each reason its
 * own line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display
 * reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function routeCommandErrorLines({ error }: { error: RouteCommandError }): readonly string[] {
  if (error.code === "FILE_CONTENT_INVALID") {
    return error.reasons;
  }
  return [error.message];
}
