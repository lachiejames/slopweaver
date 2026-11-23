/**
 * One `service` block of a googleapis `.proto` file: each `rpc` in it, and that rpc's `option (google.api.http)`
 * binding. The file-level scan that finds the block is `protoParse.ts`; the http option's value is
 * `protoBinding.ts`.
 *
 * An rpc with no `option (google.api.http)` is `HTTP_BINDING_MISSING`; one whose binding is not exactly one verb
 * on one path is `HTTP_BINDING_AMBIGUOUS`. Anything else this reader cannot place is `PROTO_UNPARSEABLE` naming
 * the service or method it was reading. Any other option, in a service or an rpc, is skipped as exactly one
 * value and its `;` — never "up to the next `;`", which would fold a following option into it unseen.
 */
import { err, ok, type Result } from "#lib/result.js";

import {
  type GoogleSecopsInventoryError,
  GoogleSecopsInventoryErrors,
  type GoogleSecopsProtoSyntaxError,
  GoogleSecopsProtoSyntaxErrors,
} from "./errors.js";
import { type BindingEntry, httpBindingOf, readHttpAggregate, readHttpSubField } from "./protoBinding.js";
import { describeProtoToken, type ProtoCursor } from "./protoLex.js";
import type { ProtoRpc } from "./protoParse.js";

/** What reading one rpc's body found: its http binding entries, or `null` when it declares none. */
type RpcBody = readonly BindingEntry[] | null;

/** The option name of the REST binding annotation, as its tokens join. */
const HTTP_OPTION = "(google.api.http)";

/** What one http option statement contributes to the rpc's rule. */
interface HttpOption {
  /** True for the aggregate `= { ... }` spelling, which may appear once; false for a sub-field. */
  readonly whole: boolean;
  readonly entries: readonly BindingEntry[];
}

/**
 * A syntax refusal placed on the service or method it was found in.
 *
 * @param document the pinned file
 * @param where the service or method being read, or the statement for a file-level refusal
 * @param error the lexer's or grammar's refusal
 * @returns the PROTO_UNPARSEABLE error carrying it
 */
export function unparseable({
  document,
  where,
  error,
}: {
  document: string;
  where: string;
  error: GoogleSecopsProtoSyntaxError;
}): GoogleSecopsInventoryError {
  return GoogleSecopsInventoryErrors.protoUnparseable({ detail: `${where}: ${error.message}`, document });
}

/**
 * Read one parenthesised request or response type, `( [stream] Type )`.
 *
 * @param cursor the token cursor, sitting on the `(`
 * @returns ok, or what was found instead
 */
function readMessageType({ cursor }: { cursor: ProtoCursor }): Result<void, GoogleSecopsProtoSyntaxError> {
  const opened = cursor.expect({ value: "(" });
  if (opened.isErr()) {
    return opened;
  }
  if (cursor.is({ value: "stream" })) {
    cursor.next();
  }
  return cursor.ident().andThen(() => cursor.expect({ value: ")" }));
}

/**
 * Whether any bracketed extension in an option name has an `http` segment, the name not being spelled
 * `(google.api.http)`.
 *
 * @param optionName the option's tokens joined, e.g. `(.google.api.http).get`
 * @returns true for a spelling that may resolve to the http rule this parser does not read
 */
function isOtherHttpSpelling({ optionName }: { optionName: string }): boolean {
  // Every bracketed group, not only the first: `deprecated.(google.api.http).additional_bindings` hides the
  // extension behind a plain name. Any `http` segment, not only the last: `(google.api.http.additional_bindings)`
  // misplaces the paren around a binding. Skipping either as an unrelated option would lose the binding.
  return [...optionName.matchAll(/\(([.\w]+)\)/gu)].some((group) => group[1]!.split(".").includes("http"));
}

/**
 * Read one `option <name> = <value>;` statement in an rpc body, the cursor sitting on `option`.
 *
 * Both spellings of the http option are read: the aggregate `(google.api.http) = { ... }`, and the
 * sub-field `(google.api.http).<field> = ...`, which protobuf merges into the same rule.
 *
 * @param cursor the token cursor
 * @returns what the http option contributes, `null` for any other option
 */
function readRpcOption({ cursor }: { cursor: ProtoCursor }): Result<HttpOption | null, GoogleSecopsProtoSyntaxError> {
  const keyword = cursor.expect({ value: "option" });
  if (keyword.isErr()) {
    return err(keyword.error);
  }
  const name = cursor.optionName();
  if (name.isErr()) {
    return err(name.error);
  }
  const optionName = name.value;
  const whole = optionName === HTTP_OPTION;
  if (!whole && !optionName.startsWith(`${HTTP_OPTION}.`)) {
    // protobuf resolves `(.google.api.http)` and a package-relative `(api.http)` to the same extension, so a
    // binding spelled that way would otherwise be skipped as an unrelated option and its entries lost.
    if (isOtherHttpSpelling({ optionName })) {
      return err(
        GoogleSecopsProtoSyntaxErrors.bindingMalformed({
          detail: `spells the http option as ${optionName}; only ${HTTP_OPTION} is read`,
        }),
      );
    }
    return cursor.skipOptionValue().map(() => null);
  }
  const option = whole
    ? readHttpAggregate({ cursor }).map((entries) => ({ entries, whole }))
    : readHttpSubField({ cursor, path: optionName.slice(HTTP_OPTION.length + 1) }).map((entry) => ({
        entries: [entry],
        whole,
      }));
  if (option.isErr()) {
    return option;
  }
  return cursor.expect({ value: ";" }).map(() => option.value);
}

/**
 * Merge every http option an rpc body declared into the one rule protobuf would build from them.
 *
 * @param options each http option, in body order
 * @returns the rule's entries, `null` when the body declares no http option at all
 */
function mergeHttpOptions({
  options,
}: {
  options: readonly HttpOption[];
}): Result<RpcBody, GoogleSecopsProtoSyntaxError> {
  if (options.length === 0) {
    return ok(null);
  }
  if (options.filter((option) => option.whole).length > 1) {
    return err(GoogleSecopsProtoSyntaxErrors.bindingMalformed({ detail: "declares option (google.api.http) twice" }));
  }
  return ok(options.flatMap((option) => option.entries));
}

/**
 * Read the body of an rpc, the cursor just past its `{`, up to and including its closing `}`.
 *
 * @param cursor the token cursor
 * @returns the http binding's entries, `null` when the rpc declares none
 */
function readRpcBody({ cursor }: { cursor: ProtoCursor }): Result<RpcBody, GoogleSecopsProtoSyntaxError> {
  const options: HttpOption[] = [];
  while (!cursor.is({ value: "}" })) {
    if (cursor.is({ value: ";" })) {
      cursor.next();
      continue;
    }
    const option = readRpcOption({ cursor });
    if (option.isErr()) {
      return err(option.error);
    }
    if (option.value !== null) {
      options.push(option.value);
    }
  }
  cursor.next();
  return mergeHttpOptions({ options });
}

/**
 * Read an rpc's signature and body, the cursor just past its name.
 *
 * @param cursor the token cursor
 * @returns the http binding's entries, `null` for an rpc with no body or no http option in it
 */
function readRpcShape({ cursor }: { cursor: ProtoCursor }): Result<RpcBody, GoogleSecopsProtoSyntaxError> {
  const signature = readMessageType({ cursor })
    .andThen(() => cursor.expect({ value: "returns" }))
    .andThen(() => readMessageType({ cursor }));
  if (signature.isErr()) {
    return err(signature.error);
  }
  if (cursor.is({ value: ";" })) {
    cursor.next();
    return ok(null);
  }
  return cursor.expect({ value: "{" }).andThen(() => readRpcBody({ cursor }));
}

/**
 * Read one rpc declaration, the cursor just past the `rpc` keyword.
 *
 * @param cursor the token cursor
 * @param document the pinned file
 * @param service the fully qualified service declaring it
 * @returns the rpc and its binding
 */
function readRpc({
  cursor,
  document,
  service,
}: {
  cursor: ProtoCursor;
  document: string;
  service: string;
}): Result<ProtoRpc, GoogleSecopsInventoryError> {
  const name = cursor.simpleName();
  if (name.isErr()) {
    return err(unparseable({ document, error: name.error, where: service }));
  }
  const method = `${service}.${name.value}`;
  const body = readRpcShape({ cursor });
  if (body.isErr()) {
    return err(unparseable({ document, error: body.error, where: method }));
  }
  if (body.value === null) {
    return err(GoogleSecopsInventoryErrors.httpBindingMissing({ document, method }));
  }
  return httpBindingOf({ document, entries: body.value, method }).map((binding) => ({
    document,
    id: method,
    rpc: name.value,
    service,
    ...binding,
  }));
}

/**
 * Read one member of a service block: an rpc, an option, or a stray `;`.
 *
 * @param cursor the token cursor, sitting on the member
 * @param document the pinned file
 * @param service the fully qualified service name
 * @returns the rpc, `null` for a member that declares none
 */
function readServiceMember({
  cursor,
  document,
  service,
}: {
  cursor: ProtoCursor;
  document: string;
  service: string;
}): Result<ProtoRpc | null, GoogleSecopsInventoryError> {
  const token = cursor.next();
  if (token?.kind === "punct" && token.value === ";") {
    return ok(null);
  }
  if (token?.kind === "ident" && token.value === "option") {
    return cursor
      .optionName()
      .andThen(() => cursor.skipOptionValue())
      .map(() => null)
      .mapErr((error) => unparseable({ document, error, where: service }));
  }
  if (token?.kind !== "ident" || token.value !== "rpc") {
    const found = describeProtoToken({ token });
    const error = GoogleSecopsProtoSyntaxErrors.unexpectedToken({ expected: "'rpc' or 'option'", found });
    return err(unparseable({ document, error, where: service }));
  }
  return readRpc({ cursor, document, service });
}

/**
 * Read one service block, the cursor just past its `{`, up to and including its closing `}`.
 *
 * @param cursor the token cursor
 * @param document the pinned file
 * @param service the fully qualified service name
 * @returns every rpc it declares
 */
function readService({
  cursor,
  document,
  service,
}: {
  cursor: ProtoCursor;
  document: string;
  service: string;
}): Result<readonly ProtoRpc[], GoogleSecopsInventoryError> {
  const rpcs: ProtoRpc[] = [];
  while (!cursor.is({ value: "}" })) {
    const member = readServiceMember({ cursor, document, service });
    if (member.isErr()) {
      return err(member.error);
    }
    if (member.value !== null) {
      rpcs.push(member.value);
    }
  }
  cursor.next();
  // A service with no rpc leaves no trace in the rows, so the config could bind a phantom method under its
  // name without `inventory.ts` ever seeing that a proto declares it. No pinned service is empty.
  if (rpcs.length === 0) {
    return err(
      GoogleSecopsInventoryErrors.protoUnparseable({ detail: `service ${service} declares no rpc`, document }),
    );
  }
  return ok(rpcs);
}

/**
 * Read a `service Name {` declaration and its block, the cursor just past the `service` keyword.
 *
 * @param cursor the token cursor
 * @param document the pinned file
 * @param packageName the file's package, `null` when no `package` statement has been read yet
 * @returns every rpc the service declares
 */
export function readServiceDecl({
  cursor,
  document,
  packageName,
}: {
  cursor: ProtoCursor;
  document: string;
  packageName: string | null;
}): Result<readonly ProtoRpc[], GoogleSecopsInventoryError> {
  const name = cursor.simpleName();
  if (name.isErr()) {
    return err(unparseable({ document, error: name.error, where: "service" }));
  }
  if (packageName === null) {
    const detail = `service ${name.value} is declared before any package statement`;
    return err(GoogleSecopsInventoryErrors.protoUnparseable({ detail, document }));
  }
  const opened = cursor.expect({ value: "{" });
  if (opened.isErr()) {
    return err(unparseable({ document, error: opened.error, where: `service ${name.value}` }));
  }
  return readService({ cursor, document, service: `${packageName}.${name.value}` });
}
