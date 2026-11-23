/**
 * Why the pinned Datadog specification could not be read where the response generator needed it
 * (`responseDeclaration.ts`, `responseSpecNode.ts`, `responseSpecLeaf.ts`, `responseSpec.ts`). Each carries no place:
 * `responseCodegenPlace.ts` names the operation and census path when it refuses with one, as `SPEC_UNREADABLE`.
 */

/** The operation's answer is not declared, or not declared as one thing. */
export interface DatadogOperationUnreadError {
  readonly code: "OPERATION_UNDECLARED" | "ANSWERS_DIVERGE" | "NO_2XX_CONTENT";
  readonly message: string;
  /** The method and path template, as the registry row carries them. */
  readonly operation: string;
}

/** A `$ref` this generator does not follow. */
export interface DatadogReferenceUnreadError {
  readonly code: "REFERENCE_ANNOTATED" | "REFERENCE_NOT_LOCAL" | "REFERENCE_UNRESOLVED";
  readonly message: string;
  readonly ref: string;
}

/** A structural keyword whose value is not the shape OpenAPI gives it. */
export interface DatadogMalformedKeywordError {
  readonly code: "MALFORMED_KEYWORD";
  readonly message: string;
  readonly keyword: "properties" | "required" | "additionalProperties" | "items";
}

/** A schema construct this generator does not read. */
export interface DatadogConstructUnreadError {
  readonly code: "CONSTRUCT_UNREAD";
  readonly message: string;
}

/** An expansion past one of the bounds that keep every walk finite. */
export interface DatadogExpansionBoundError {
  readonly code: "EXPANSION_BOUND";
  readonly message: string;
  readonly bound: "depth" | "schemas" | "arms";
  readonly limit: number;
}

/** Every reason the specification could not be read at one place. */
export type DatadogSpecError =
  | DatadogOperationUnreadError
  | DatadogReferenceUnreadError
  | DatadogMalformedKeywordError
  | DatadogConstructUnreadError
  | DatadogExpansionBoundError;

/** What each malformed keyword's message says its value should have been. */
const MALFORMED: Readonly<Record<DatadogMalformedKeywordError["keyword"], string>> = {
  additionalProperties: "an additionalProperties that is neither a schema nor a boolean",
  items: "an items that is not a schema object, which this generator does not read",
  properties: "a properties that is not an object of schemas",
  required: "a required that is not a list of names",
};

/** What each bound's message says was expanded past it. */
const BOUND: Readonly<Record<DatadogExpansionBoundError["bound"], (limit: string) => string>> = {
  arms: (limit) => `compositions expanding past ${limit} arms, more than this generator merges`,
  depth: (limit) => `compositions nested past ${limit} levels, deeper than this generator expands`,
  schemas: (limit) => `compositions visiting past ${limit} schemas, more than this generator expands`,
};

/** A construct refusal, its message the construct's own words. */
function construct({ message }: { message: string }): DatadogConstructUnreadError {
  return { code: "CONSTRUCT_UNREAD", message };
}

/** Each refusal's constructor. */
export const DatadogSpecErrors = {
  allOf: (): DatadogConstructUnreadError => construct({ message: "an allOf, which this generator does not read" }),
  answersDiverge: ({ method, path }: { method: string; path: string }): DatadogOperationUnreadError => ({
    code: "ANSWERS_DIVERGE",
    message: `${method} ${path} declares different JSON schemas across its 2xx answers`,
    operation: `${method} ${path}`,
  }),
  besideArms: ({ keyword }: { keyword: string }): DatadogConstructUnreadError =>
    construct({
      message: `a oneOf or anyOf beside its own ${keyword}, which this generator does not merge into its arms`,
    }),
  bound: ({
    bound,
    limit,
  }: {
    bound: DatadogExpansionBoundError["bound"];
    limit: number;
  }): DatadogExpansionBoundError => ({
    bound,
    code: "EXPANSION_BOUND",
    limit,
    message: BOUND[bound](String(limit)),
  }),
  compositionNotList: (): DatadogConstructUnreadError => construct({ message: "a oneOf or anyOf that is not a list" }),
  malformedKeyword: ({
    keyword,
  }: {
    keyword: DatadogMalformedKeywordError["keyword"];
  }): DatadogMalformedKeywordError => ({
    code: "MALFORMED_KEYWORD",
    keyword,
    message: MALFORMED[keyword],
  }),
  noContent: ({ method, path }: { method: string; path: string }): DatadogOperationUnreadError => ({
    code: "NO_2XX_CONTENT",
    message: `${method} ${path} declares no 2xx content`,
    operation: `${method} ${path}`,
  }),
  notObject: (): DatadogConstructUnreadError => construct({ message: "a schema that is not an object" }),
  oneOfBesideAnyOf: (): DatadogConstructUnreadError =>
    construct({ message: "a oneOf beside an anyOf, which this generator does not merge into one set of arms" }),
  operationUndeclared: ({ method, path }: { method: string; path: string }): DatadogOperationUnreadError => ({
    code: "OPERATION_UNDECLARED",
    message: `${method} ${path} is not declared in the pinned specification`,
    operation: `${method} ${path}`,
  }),
  referenceAnnotated: ({ ref, beside }: { ref: string; beside: string }): DatadogReferenceUnreadError => ({
    code: "REFERENCE_ANNOTATED",
    message: `the reference ${ref} carries ${beside} beside it, which OpenAPI 3.0 ignores and this refuses`,
    ref,
  }),
  referenceNotLocal: ({ ref }: { ref: string }): DatadogReferenceUnreadError => ({
    code: "REFERENCE_NOT_LOCAL",
    message: `the reference ${ref} is not a local component`,
    ref,
  }),
  referenceUnresolved: ({ ref }: { ref: string }): DatadogReferenceUnreadError => ({
    code: "REFERENCE_UNRESOLVED",
    message: `the reference ${ref} resolves to nothing in the pinned specification`,
    ref,
  }),
  typeExcludesArm: ({ kind }: { kind: string }): DatadogConstructUnreadError =>
    construct({
      message: `a oneOf or anyOf whose own type excludes an arm's ${kind}, which this generator does not narrow`,
    }),
} as const;
