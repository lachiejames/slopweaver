/**
 * The torn-tail-append gate's criterion — which calls in one parsed source file append to a file, and as which of
 * the four shapes. The gate itself, its debt list and its runner are `./tornTailAppend.ts`, whose header states the
 * criterion in prose; this module is that sentence as code.
 *
 * Every shape is read through a binding imported from `node:fs`, `fs`, `node:fs/promises` or `fs/promises`, or a
 * `const`/`let` alias of one (`./tornTailAppendBindings.ts`), except `append-method`, the one syntax-level heuristic:
 * a promises `FileHandle` has no import to bind to. A member is read by dot or by literal key, and a call through
 * `.call`/`.apply` is resolved to the function it invokes (`fs["appendFileSync"](…)` passed the
 * first cut).
 */

import { forEachChild, type NodeVisitor, ts } from "#lib/tsSyntax.js";

import { type FsBindings, fsBindingsOf, isModuleReference } from "./tornTailAppendBindings.js";
import { isShadowed } from "./tornTailAppendScope.js";
import {
  type ConstBindings,
  constInitializersOf,
  hasAppendFlagOption,
  isAppendFlags,
  MAX_CONST_HOPS,
  memberOf,
  unwrapped,
} from "./tornTailAppendValue.js";

/** Which of the four append shapes a call is. */
export type TornTailAppendShape = "append-call" | "append-open" | "append-flag-write" | "append-method";

/** The fs functions that append on every call. */
const APPEND_FUNCTIONS: ReadonlySet<string> = new Set(["appendFileSync", "appendFile"]);

/** The fs functions that open a descriptor from a flags argument. */
const OPEN_FUNCTIONS: ReadonlySet<string> = new Set(["openSync", "open"]);

/** The fs writers that take a `flag`/`flags` option. */
const FLAG_WRITERS: ReadonlySet<string> = new Set(["writeFileSync", "writeFile", "createWriteStream"]);

/** The method names `append-method` flags on any receiver. */
const APPEND_METHODS: ReadonlySet<string> = new Set(["appendFile", "appendFileSync"]);

/**
 * The fs export a call reaches, with the arguments that export actually receives, or `undefined` when the callee is
 * not the filesystem: a bound name, a member of a module binding by dot or by literal key, or either one invoked
 * through `.call(thisArg, …)` or `.apply(thisArg, [ … ])`, whose arguments are shifted or unpacked accordingly.
 */
function fsCallOf({
  callee,
  args,
  fs,
}: {
  callee: ts.Expression;
  args: readonly ts.Expression[];
  fs: FsBindings;
}): { readonly names: readonly string[]; readonly args: readonly ts.Expression[] } | undefined {
  const target = unwrapped({ node: callee });
  if (ts.isIdentifier(target)) {
    const names = fs.named.get(target.text);
    if (names === undefined || isShadowed({ aliases: fs.aliases, identifier: target })) {
      return undefined;
    }
    return { args, names: [...names] };
  }
  const member = memberOf({ node: target });
  if (member === undefined) {
    return undefined;
  }
  if (isModuleReference({ fs, node: member.receiver })) {
    return { args, names: [member.name] };
  }
  if (member.name === "call") {
    return fsCallOf({ args: args.slice(1), callee: member.receiver, fs });
  }
  const list = args[1];
  if (member.name === "apply" && list !== undefined && ts.isArrayLiteralExpression(list)) {
    return fsCallOf({ args: [...list.elements], callee: member.receiver, fs });
  }
  if (member.name === "apply") {
    return fsCallOf({ args: [], callee: member.receiver, fs });
  }
  return undefined;
}

/** Which append shape one fs export called with `args` is, or `undefined` when it does not append. */
function exportShapeOf({
  name,
  args,
  consts,
}: {
  name: string;
  args: readonly ts.Expression[];
  consts: ConstBindings;
}): TornTailAppendShape | undefined {
  if (APPEND_FUNCTIONS.has(name)) {
    return "append-call";
  }
  const flags = args[1];
  const scope = { consts, hops: MAX_CONST_HOPS };
  if (OPEN_FUNCTIONS.has(name) && flags !== undefined && isAppendFlags({ node: flags, scope })) {
    return "append-open";
  }
  if (FLAG_WRITERS.has(name) && hasAppendFlagOption({ args, scope })) {
    return "append-flag-write";
  }
  return undefined;
}

/** Which append shape one call is, or `undefined` when it is not an append. */
function appendShapeOf({
  call,
  fs,
  consts,
}: {
  call: ts.CallExpression;
  fs: FsBindings;
  consts: ConstBindings;
}): TornTailAppendShape | undefined {
  const resolved = fsCallOf({ args: call.arguments, callee: call.expression, fs });
  if (resolved === undefined) {
    const member = memberOf({ node: unwrapped({ node: call.expression }) });
    return member !== undefined && APPEND_METHODS.has(member.name) ? "append-method" : undefined;
  }
  const { args, names } = resolved;
  return names.map((name) => exportShapeOf({ args, consts, name })).find((shape) => shape !== undefined);
}

/**
 * Every call in a parsed source file that appends to a file, with its shape, in source order. Pure.
 *
 * @param sf the parsed file, created with parent pointers so a node's text and position can be read
 * @returns each appending call and which shape it is
 */
export function appendCallsIn({
  sf,
}: {
  sf: ts.SourceFile;
}): readonly { readonly call: ts.CallExpression; readonly shape: TornTailAppendShape }[] {
  const fs = fsBindingsOf({ sf });
  const consts = constInitializersOf({ sf });
  const found: { call: ts.CallExpression; shape: TornTailAppendShape }[] = [];
  const visit: NodeVisitor = (node) => {
    if (ts.isCallExpression(node)) {
      const shape = appendShapeOf({ call: node, consts, fs });
      if (shape !== undefined) {
        found.push({ call: node, shape });
      }
    }
    forEachChild({ node, visit });
  };
  visit(sf);
  return found;
}
