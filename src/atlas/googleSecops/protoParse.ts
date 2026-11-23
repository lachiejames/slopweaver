/**
 * A narrow, hand-written reader for the parts of a googleapis `.proto` file the method inventory needs:
 * the `package`, each `service`, each `rpc` in it, and that rpc's `option (google.api.http)` binding.
 *
 * ## Why hand-written rather than `protobufjs`
 *
 * `protobufjs` is present in `node_modules` only transitively, so importing it would be an undeclared
 * dependency, and declaring one for a build-time reader is a dependency this repository then carries for
 * every install. The inventory needs four constructs out of the whole language, and every one of them is
 * read here or REFUSED: a construct this reader does not place is a typed error, never a silent skip. The
 * census in `generated/protoLock.ts` is what catches a reader that started skipping quietly anyway.
 *
 * ## What it reads, and what it refuses
 *
 * - Lexing, comments included, is `protoLex.ts`; a service block and its rpcs are `protoService.ts`; the http
 *   option's value is `protoBinding.ts`. This module is the file-level scan that finds them.
 * - An rpc with no `option (google.api.http)` is `HTTP_BINDING_MISSING`; one whose binding is not exactly one
 *   verb on one path is `HTTP_BINDING_AMBIGUOUS`. Anything else this reader cannot place, inside a service,
 *   is `PROTO_UNPARSEABLE` naming the service or method it was reading.
 * - Any other option, in a service or an rpc, is skipped as exactly one value and its `;` — never "up to the
 *   next `;`", which would fold a following option into it unseen.
 * - `message`, `enum` and file-level `option` blocks are skipped by brace matching; nothing in them reaches a
 *   row, and a `service` or `rpc` declared inside one, or a `}` closing nothing, is refused.
 *
 * ## Why `(google.api.http)` can be matched by spelling
 *
 * protoc resolves an option name by scope: `google` is looked up from the method outward, so a symbol named
 * `google` in any enclosing scope would make `(google.api.http)` mean some other extension, and this reader
 * would emit a binding Google never serves. Three refusals keep the scope path clean: no pinned file declares
 * a bare `google` name, no package has `google` past its first segment, and every import is either one of
 * the named dependencies in `EXTERNAL_IMPORTS` or itself a pinned file, which `compileGoogleSecopsInventory`
 * checks against every pin it was given. The residue is those named dependencies: Google's own files, never
 * read here, trusted to keep the packages and imports they are published with.
 */
import { err, ok, type Result } from "#lib/result.js";

import {
  type GoogleSecopsInventoryError,
  GoogleSecopsInventoryErrors,
  GoogleSecopsProtoSyntaxErrors,
} from "./errors.js";
import { braceDelta, describeProtoToken, lexProto, ProtoCursor, type ProtoToken } from "./protoLex.js";
import { readServiceDecl, unparseable } from "./protoService.js";
import type { GoogleSecopsHttpMethod } from "./surfaceRow.js";

/** One rpc and the single REST binding it declares. */
export interface ProtoRpc {
  /** The pinned file name it was read from. */
  readonly document: string;
  /** `<package>.<Service>.<Rpc>`, the selector `authentication.rules` matches against. */
  readonly id: string;
  /** `<package>.<Service>`. */
  readonly service: string;
  readonly rpc: string;
  readonly httpMethod: GoogleSecopsHttpMethod;
  readonly pathTemplate: string;
}

/** What the file-level scan carries between tokens. */
interface TopLevelState {
  depth: number;
  /** Whether the next depth-zero token opens a new file-level statement. */
  statementStart: boolean;
  packageName: string | null;
  readonly rpcs: ProtoRpc[];
  /** Every `<package>.<Service>` already read, so a second block of the same name is refused, not merged. */
  readonly services: Set<string>;
  /** Every import path read, in order, each a named dependency or in the pinned directory. */
  readonly imports: string[];
}

/**
 * The files outside the pinned directory a pinned proto may import: exactly the ones the pinned files do
 * import, by name. A whole namespace would admit a file this reader never sees whose `import public` brings
 * a `google` declaration into scope. Each of these is trusted as Google publishes it — its package is off
 * the scope path from `google.cloud.chronicle.v1` — and no refusal here reads its bytes.
 */
const EXTERNAL_IMPORTS = new Set([
  "google/api/annotations.proto",
  "google/api/client.proto",
  "google/api/field_behavior.proto",
  "google/api/field_info.proto",
  "google/api/httpbody.proto",
  "google/api/resource.proto",
  "google/longrunning/operations.proto",
  "google/protobuf/any.proto",
  "google/protobuf/empty.proto",
  "google/protobuf/field_mask.proto",
  "google/protobuf/timestamp.proto",
  "google/rpc/status.proto",
  "google/type/date.proto",
  "google/type/interval.proto",
]);

/**
 * An import inside the pinned directory. Only a pinned file passes, a check the inventory makes because only
 * it holds every pin.
 */
const PINNED_DIRECTORY_IMPORT = /^google\/cloud\/chronicle\/v1\/\w+\.proto$/u;

/**
 * Every keyword a file-level statement may open with. Anything else at a statement start is refused: a
 * scan matching only `package` and `service` would step over `service_ X { ... }` or `.service X { ... }`
 * and every method inside it, without a word.
 */
const TOP_LEVEL_KEYWORDS = new Set([
  "edition",
  "enum",
  "extend",
  "import",
  "message",
  "option",
  "package",
  "service",
  "syntax",
]);

/**
 * Read a `package` statement, the cursor just past the keyword.
 *
 * The `;` is required: the lexer folds a dot into a name, so `google.cloud.chronicle .v1;` would otherwise
 * read as package `google.cloud.chronicle` with `.v1` left over.
 *
 * @param cursor the token cursor
 * @param document the pinned file
 * @param state the scan's state, whose package this sets
 * @returns ok, or why the statement is not one package name and its `;`
 */
function readPackage({
  cursor,
  document,
  state,
}: {
  cursor: ProtoCursor;
  document: string;
  state: TopLevelState;
}): Result<void, GoogleSecopsInventoryError> {
  if (state.packageName !== null) {
    const detail = `a second package statement after package ${state.packageName}`;
    return err(GoogleSecopsInventoryErrors.protoUnparseable({ detail, document }));
  }
  const name = cursor.ident();
  if (name.isErr()) {
    return err(unparseable({ document, error: name.error, where: "package" }));
  }
  const end = cursor.expect({ value: ";" });
  if (end.isErr()) {
    return err(unparseable({ document, error: end.error, where: "package" }));
  }
  if (name.value.split(".").slice(1).includes("google")) {
    const detail = `package ${name.value} holds a second google, which would shadow the package (google.api.http) resolves through`;
    return err(GoogleSecopsInventoryErrors.protoUnparseable({ detail, document }));
  }
  state.packageName = name.value;
  return ok(undefined);
}

/**
 * Read an `import` statement, the cursor just past the keyword, refusing a path that is neither in
 * `EXTERNAL_IMPORTS` nor in the pinned directory.
 *
 * @param cursor the token cursor
 * @param document the pinned file
 * @param state the scan so far, its imports extended in place
 * @returns ok, or the import this reader will not trust
 */
function readImport({
  cursor,
  document,
  state,
}: {
  cursor: ProtoCursor;
  document: string;
  state: TopLevelState;
}): Result<void, GoogleSecopsInventoryError> {
  if (cursor.is({ value: "public" }) || cursor.is({ value: "weak" })) {
    cursor.next();
  }
  const path = cursor.next();
  if (path?.kind !== "string") {
    const error = GoogleSecopsProtoSyntaxErrors.unexpectedToken({
      expected: "an import path",
      found: describeProtoToken({ token: path }),
    });
    return err(unparseable({ document, error, where: "import" }));
  }
  if (!EXTERNAL_IMPORTS.has(path.value) && !PINNED_DIRECTORY_IMPORT.test(path.value)) {
    // An unread file could declare `google`, or `import public` one that does, where no refusal here sees it.
    const detail = `imports ${path.value}, which is neither a known dependency nor in the pinned directory`;
    return err(GoogleSecopsInventoryErrors.protoUnparseable({ detail, document }));
  }
  const end = cursor.expect({ value: ";" });
  if (end.isErr()) {
    return err(unparseable({ document, error: end.error, where: `import ${path.value}` }));
  }
  state.imports.push(path.value);
  return ok(undefined);
}

/**
 * Read one file-level token: a brace moves the depth, a misplaced `service` or `rpc` is refused, and a token
 * opening a depth-zero statement is handed to `readStatement`.
 *
 * @param cursor the token cursor, just past `token`
 * @param token the token just consumed
 * @param document the pinned file
 * @param state the scan's depth, statement boundary, package, services and rpcs so far, updated in place
 * @returns ok, or the first thing this reader could not place
 */
function readTopLevel({
  cursor,
  token,
  document,
  state,
}: {
  cursor: ProtoCursor;
  token: ProtoToken;
  document: string;
  state: TopLevelState;
}): Result<void, GoogleSecopsInventoryError> {
  const emptyStatement = token.kind === "punct" && token.value === ";";
  const opensStatement = state.depth === 0 && state.statementStart && !emptyStatement;
  state.depth += braceDelta({ token });
  if (state.depth < 0) {
    // Checking only the final depth would let a stray `}` and a later `{` hide everything between them.
    return err(GoogleSecopsInventoryErrors.protoUnparseable({ detail: "a } closes no open block", document }));
  }
  // A declaration this scan would step over: a `service` nested in a message, or an `rpc` outside any
  // service. Both are invalid protobuf, and skipping them would drop their methods without a word. Followed
  // by a name only, so a FIELD called `service` (`string service = 1;`) is still an ordinary field.
  const declares = token.kind === "ident" && cursor.peek()?.kind === "ident";
  const misplacedService = declares && token.value === "service" && state.depth !== 0;
  if (misplacedService || (declares && token.value === "rpc")) {
    const detail = `${token.value} ${cursor.peek()!.value} is declared outside the place it can be read`;
    return err(GoogleSecopsInventoryErrors.protoUnparseable({ detail, document }));
  }
  // A statement ends at a depth-zero `;` or at the `}` closing its block; a `;` after such a `}` is empty.
  state.statementStart = state.depth === 0 && token.kind === "punct" && (emptyStatement || token.value === "}");
  if (!opensStatement) {
    return ok(undefined);
  }
  return readStatement({ cursor, document, state, token });
}

/**
 * Read one depth-zero statement, the cursor just past its first token: it must open with a proto keyword,
 * and one opening with `package`, `service` or `import` is read.
 *
 * @param cursor the token cursor, just past `token`
 * @param token the statement's first token
 * @param document the pinned file
 * @param state the scan so far, updated in place
 * @returns ok, or the first thing this reader could not place
 */
function readStatement({
  cursor,
  token,
  document,
  state,
}: {
  cursor: ProtoCursor;
  token: ProtoToken;
  document: string;
  state: TopLevelState;
}): Result<void, GoogleSecopsInventoryError> {
  if (token.kind !== "ident" || !TOP_LEVEL_KEYWORDS.has(token.value)) {
    // Matching only `package` and `service` would step over `service_ X { ... }` or `.service X { ... }`
    // and every method inside it, without a word.
    const detail = `a file-level statement opens with ${describeProtoToken({ token })}, which is no proto keyword`;
    return err(GoogleSecopsInventoryErrors.protoUnparseable({ detail, document }));
  }
  if (token.value === "package") {
    state.statementStart = true;
    return readPackage({ cursor, document, state });
  }
  if (token.value === "service") {
    state.statementStart = true;
    return readTopLevelService({ cursor, document, state });
  }
  if (token.value === "import") {
    state.statementStart = true;
    return readImport({ cursor, document, state });
  }
  return ok(undefined);
}

/**
 * Read a file-level `service` statement into the scan, the cursor just past the keyword.
 *
 * @param cursor the token cursor
 * @param document the pinned file
 * @param state the scan so far, its rpcs and services extended in place
 * @returns ok, or the first thing this reader could not place
 */
function readTopLevelService({
  cursor,
  document,
  state,
}: {
  cursor: ProtoCursor;
  document: string;
  state: TopLevelState;
}): Result<void, GoogleSecopsInventoryError> {
  const rpcs = readServiceDecl({ cursor, document, packageName: state.packageName });
  if (rpcs.isErr()) {
    return err(rpcs.error);
  }
  // `readService` refuses an empty service, so the first rpc always names it.
  const service = rpcs.value[0]!.service;
  if (state.services.has(service)) {
    // protoc refuses a duplicate; reading one would merge its methods into the first block's.
    const detail = `service ${service} is declared twice`;
    return err(GoogleSecopsInventoryErrors.protoUnparseable({ detail, document }));
  }
  state.services.add(service);
  state.rpcs.push(...rpcs.value);
  return ok(undefined);
}

/**
 * Every rpc a googleapis `.proto` file declares, each with its single REST binding.
 *
 * A file declaring no service answers an empty list — `featured_content_metadata.proto` is messages only —
 * while a service declared before any `package` statement is refused, because its methods would have no
 * selector `authentication.rules` could match.
 *
 * @param text the file's whole text
 * @param document the pinned file name, carried onto every rpc and every error
 * @returns every rpc in declaration order, or the first thing this reader could not place
 */
export function parseChronicleProto({
  text,
  document,
}: {
  text: string;
  document: string;
}): Result<readonly ProtoRpc[], GoogleSecopsInventoryError> {
  return parseChronicleProtoFile({ document, text }).map((file) => file.rpcs);
}

/**
 * Every rpc a googleapis `.proto` file declares, and every file it imports.
 *
 * The imports are returned because one in the pinned directory is only safe when it is itself pinned, and
 * only the caller holding every pinned file can check that (`compileGoogleSecopsInventory`).
 *
 * @param text the file's whole text
 * @param document the pinned file name, carried onto every rpc and every error
 * @returns the rpcs in declaration order and the import paths, or the first thing this reader could not place
 */
export function parseChronicleProtoFile({
  text,
  document,
}: {
  text: string;
  document: string;
}): Result<{ readonly rpcs: readonly ProtoRpc[]; readonly imports: readonly string[] }, GoogleSecopsInventoryError> {
  const lexed = lexProto({ text });
  if (lexed.isErr()) {
    return err(GoogleSecopsInventoryErrors.protoUnparseable({ detail: lexed.error.message, document }));
  }
  // The lexer folds a dotted reference into one token, so a bare `google` is only ever a declared name.
  if (lexed.value.some((token) => token.kind === "ident" && token.value === "google")) {
    const detail = "declares the name google, which would shadow the package (google.api.http) resolves through";
    return err(GoogleSecopsInventoryErrors.protoUnparseable({ detail, document }));
  }
  const cursor = new ProtoCursor({ tokens: lexed.value });
  const state: TopLevelState = {
    depth: 0,
    imports: [],
    packageName: null,
    rpcs: [],
    services: new Set(),
    statementStart: true,
  };
  for (let token = cursor.next(); token !== null; token = cursor.next()) {
    const step = readTopLevel({ cursor, document, state, token });
    if (step.isErr()) {
      return err(step.error);
    }
  }
  if (state.depth !== 0) {
    return err(GoogleSecopsInventoryErrors.protoUnparseable({ detail: "unbalanced braces", document }));
  }
  return ok({ imports: state.imports, rpcs: state.rpcs });
}
