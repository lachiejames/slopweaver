/**
 * The Google SecOps method inventory's own failure kinds.
 *
 * A discriminated union rather than `readonly string[]` because each kind names a different thing to go
 * and read: an unparseable proto is a change in googleapis' text, a missing or ambiguous HTTP binding is an
 * rpc this inventory cannot place on the wire, a missing auth rule is a method the service config grants
 * no scope for, and a census mismatch is a change in THIS reader. `.claude/rules/error-handling.md` carries
 * the rule; this union is scoped to the inventory and shared with no other domain.
 */

/** A proto file's text did not have the shape this narrow parser reads. */
export interface GoogleSecopsProtoUnparseableError {
  readonly code: "PROTO_UNPARSEABLE";
  readonly message: string;
  /** The pinned file name the text came from. */
  readonly document: string;
  readonly detail: string;
}

/** An rpc declares no `option (google.api.http)` binding, so it has no REST method or path at all. */
export interface GoogleSecopsHttpBindingMissingError {
  readonly code: "HTTP_BINDING_MISSING";
  readonly message: string;
  readonly document: string;
  /** The fully qualified method, `<package>.<Service>.<Rpc>`. */
  readonly method: string;
}

/** An rpc declares more than one binding, or one this parser does not place (`custom`, `additional_bindings`). */
export interface GoogleSecopsHttpBindingAmbiguousError {
  readonly code: "HTTP_BINDING_AMBIGUOUS";
  readonly message: string;
  readonly document: string;
  readonly method: string;
  readonly detail: string;
}

/** The service config yaml did not have the shape this reader expects. */
export interface GoogleSecopsServiceConfigUnparseableError {
  readonly code: "SERVICE_CONFIG_UNPARSEABLE";
  readonly message: string;
  readonly detail: string;
}

/** The service config and the protos disagree about what exists — a published service nothing declares, say. */
export interface GoogleSecopsServiceConfigInconsistentError {
  readonly code: "SERVICE_CONFIG_INCONSISTENT";
  readonly message: string;
  readonly detail: string;
}

/** No `authentication.rules` selector matches a method, so the config grants it no scope. Never `[]`. */
export interface GoogleSecopsAuthRuleMissingError {
  readonly code: "AUTH_RULE_MISSING";
  readonly message: string;
  /** The fully qualified method nothing matched. */
  readonly selector: string;
}

/**
 * The rule that decides a method matches it but its `canonical_scopes` splits to nothing (`','`, blank).
 * A rule granting no scope is not "no scope needed", so it is refused exactly as no rule at all is.
 */
export interface GoogleSecopsAuthRuleGrantsNoScopeError {
  readonly code: "AUTH_RULE_GRANTS_NO_SCOPE";
  readonly message: string;
  /** The fully qualified method being looked up. */
  readonly selector: string;
  /** The deciding rule's own selector, as the config writes it. */
  readonly ruleSelector: string;
}

/** A GET whose verb is neither `List` nor `Get` and that no reviewed row names — somebody has to judge it. */
export interface GoogleSecopsDispositionUndecidedError {
  readonly code: "DISPOSITION_UNDECIDED";
  readonly message: string;
  readonly method: string;
}

/** A measured census disagrees with the pinned one. */
export interface GoogleSecopsCensusMismatchError {
  readonly code: "CENSUS_MISMATCH";
  readonly message: string;
  /** Every disagreement, one per line. */
  readonly problems: readonly string[];
}

/** The committed table is not in id order, so it is not what the generator wrote. */
export interface GoogleSecopsTableUnsortedError {
  readonly code: "TABLE_UNSORTED";
  readonly message: string;
  /** The id sitting above one it should follow. */
  readonly before: string;
  readonly after: string;
}

/** The committed table and the lock's per-file counts do not hash to the digest the generator wrote. */
export interface GoogleSecopsTableDigestMismatchError {
  readonly code: "TABLE_DIGEST_MISMATCH";
  readonly message: string;
  /** What the table hashes to now. */
  readonly read: string;
  readonly pinned: string;
}

/** Anything compiling the Google SecOps method inventory can fail with. */
export type GoogleSecopsInventoryError =
  | GoogleSecopsProtoUnparseableError
  | GoogleSecopsHttpBindingMissingError
  | GoogleSecopsHttpBindingAmbiguousError
  | GoogleSecopsServiceConfigUnparseableError
  | GoogleSecopsServiceConfigInconsistentError
  | GoogleSecopsAuthRuleMissingError
  | GoogleSecopsAuthRuleGrantsNoScopeError
  | GoogleSecopsDispositionUndecidedError
  | GoogleSecopsCensusMismatchError
  | GoogleSecopsTableUnsortedError
  | GoogleSecopsTableDigestMismatchError;

/** The one command that rewrites both the table and its digest, named in every table refusal. */
export const GOOGLE_SECOPS_REGENERATE_COMMAND = "yarn tsx tools/generateGoogleSecopsSurfaces.ts --fetch <dir>";

/** How every Google SecOps inventory failure is constructed. */
export const GoogleSecopsInventoryErrors = {
  authRuleGrantsNoScope: ({
    selector,
    ruleSelector,
  }: {
    selector: string;
    ruleSelector: string;
  }): GoogleSecopsAuthRuleGrantsNoScopeError => ({
    code: "AUTH_RULE_GRANTS_NO_SCOPE",
    message: `the authentication rule ${ruleSelector} decides ${selector} but its canonical_scopes lists no scope`,
    ruleSelector,
    selector,
  }),
  authRuleMissing: ({ selector }: { selector: string }): GoogleSecopsAuthRuleMissingError => ({
    code: "AUTH_RULE_MISSING",
    message: `no authentication rule in chronicle_v1.yaml matches ${selector}, so the config grants it no scope`,
    selector,
  }),
  censusMismatch: ({ problems }: { problems: readonly string[] }): GoogleSecopsCensusMismatchError => ({
    code: "CENSUS_MISMATCH",
    message: `the Google SecOps method census does not match protoLock.ts: ${problems.join("; ")}`,
    problems,
  }),
  dispositionUndecided: ({ method }: { method: string }): GoogleSecopsDispositionUndecidedError => ({
    code: "DISPOSITION_UNDECIDED",
    message: `${method} is a GET whose verb is neither List nor Get, and dispositions.ts names no verdict for it`,
    method,
  }),
  httpBindingAmbiguous: ({
    document,
    method,
    detail,
  }: {
    document: string;
    method: string;
    detail: string;
  }): GoogleSecopsHttpBindingAmbiguousError => ({
    code: "HTTP_BINDING_AMBIGUOUS",
    detail,
    document,
    message: `${document}: ${method} does not carry exactly one placeable HTTP binding — ${detail}`,
    method,
  }),
  httpBindingMissing: ({
    document,
    method,
  }: {
    document: string;
    method: string;
  }): GoogleSecopsHttpBindingMissingError => ({
    code: "HTTP_BINDING_MISSING",
    document,
    message: `${document}: ${method} declares no option (google.api.http) binding`,
    method,
  }),
  protoUnparseable: ({
    document,
    detail,
  }: {
    document: string;
    detail: string;
  }): GoogleSecopsProtoUnparseableError => ({
    code: "PROTO_UNPARSEABLE",
    detail,
    document,
    message: `${document} could not be parsed: ${detail}`,
  }),
  serviceConfigInconsistent: ({ detail }: { detail: string }): GoogleSecopsServiceConfigInconsistentError => ({
    code: "SERVICE_CONFIG_INCONSISTENT",
    detail,
    message: `chronicle_v1.yaml and the pinned protos disagree: ${detail}`,
  }),
  serviceConfigUnparseable: ({ detail }: { detail: string }): GoogleSecopsServiceConfigUnparseableError => ({
    code: "SERVICE_CONFIG_UNPARSEABLE",
    detail,
    message: `chronicle_v1.yaml could not be read: ${detail}`,
  }),
  tableDigestMismatch: ({ read, pinned }: { read: string; pinned: string }): GoogleSecopsTableDigestMismatchError => ({
    code: "TABLE_DIGEST_MISMATCH",
    message: `generated/surfaces.ts with protoLock.ts's declared and unpublished counts hashes to ${read} but protoLock.ts pins ${pinned} — both are generated, never edited; regenerate them and the digest with ${GOOGLE_SECOPS_REGENERATE_COMMAND}`,
    pinned,
    read,
  }),
  tableUnsorted: ({ before, after }: { before: string; after: string }): GoogleSecopsTableUnsortedError => ({
    after,
    before,
    code: "TABLE_UNSORTED",
    message: `generated/surfaces.ts is not sorted by id: ${before} sits above ${after} — the table is generated, never edited; regenerate it with ${GOOGLE_SECOPS_REGENERATE_COMMAND}`,
  }),
} as const;

/* The proto lexer's and grammar's own refusals. `parseChronicleProto` folds every one of them into
 * PROTO_UNPARSEABLE, naming the service or method it was reading; they never leave the reader on their own. */

/** A quoted string or a block comment opened and the file ended before it closed. */
export interface GoogleSecopsProtoUnterminatedError {
  readonly code: "PROTO_UNTERMINATED";
  readonly message: string;
  readonly construct: "string" | "block comment";
  /** The character offset the construct opened at. */
  readonly offset: number;
}

/** The next token is not one the grammar allows at this point — the end of the file included. */
export interface GoogleSecopsProtoUnexpectedTokenError {
  readonly code: "PROTO_UNEXPECTED_TOKEN";
  readonly message: string;
  readonly expected: string;
  readonly found: string;
}

/** An `option (google.api.http)` value this reader cannot read: a key with no value, or the option given twice. */
export interface GoogleSecopsProtoBindingMalformedError {
  readonly code: "PROTO_BINDING_MALFORMED";
  readonly message: string;
  readonly detail: string;
}

/** Anything the proto lexer or grammar refuses, before it is placed on a service or method. */
export type GoogleSecopsProtoSyntaxError =
  GoogleSecopsProtoUnterminatedError | GoogleSecopsProtoUnexpectedTokenError | GoogleSecopsProtoBindingMalformedError;

/** How every proto syntax refusal is constructed. */
export const GoogleSecopsProtoSyntaxErrors = {
  bindingMalformed: ({ detail }: { detail: string }): GoogleSecopsProtoBindingMalformedError => ({
    code: "PROTO_BINDING_MALFORMED",
    detail,
    message: detail,
  }),
  unexpectedToken: ({
    expected,
    found,
  }: {
    expected: string;
    found: string;
  }): GoogleSecopsProtoUnexpectedTokenError => ({
    code: "PROTO_UNEXPECTED_TOKEN",
    expected,
    found,
    message: `expected ${expected}, found ${found}`,
  }),
  unterminated: ({
    construct,
    offset,
  }: {
    construct: "string" | "block comment";
    offset: number;
  }): GoogleSecopsProtoUnterminatedError => ({
    code: "PROTO_UNTERMINATED",
    construct,
    message: `unterminated ${construct} starting at offset ${String(offset)}`,
    offset,
  }),
} as const;
