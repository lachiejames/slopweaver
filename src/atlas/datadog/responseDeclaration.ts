/**
 * Which schema in the pinned Datadog specification is one operation's answer: read once per operation, before any
 * of its places is (`responseSpec.ts`), so the generator knows whether it is declaring JSON or skipping a file.
 */
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { type DatadogSpecError, DatadogSpecErrors } from "./responseSpecErrors.js";
import {
  type DatadogSpecNode,
  datadogSpecCyclic,
  datadogSpecDereferenced,
  datadogSpecMember,
} from "./responseSpecNode.js";

/** Where an operation's 2xx answer is declared: its JSON schema, or the media type of a file it answers instead. */
export type DatadogResponseDeclaration =
  { readonly media: "json"; readonly schema: DatadogSpecNode } | { readonly media: "file"; readonly essence: string };

/**
 * Whether two acyclic parsed JSON values carry the same data, object members in any order and array items in
 * theirs. Walked with its own stack rather than the call stack, so a value nested however deep is answered.
 */
function sameJson({ left, right }: { left: unknown; right: unknown }): boolean {
  const pending: (readonly [unknown, unknown])[] = [[left, right]];
  // A YAML alias shares one node between many parents, so each pair of nodes is compared once rather than once per
  // path to it, which would double at every level of shared nodes.
  const compared = new Map<object, WeakSet<object>>();
  while (pending.length > 0) {
    const [a, b] = pending.pop()!;
    if (Object.is(a, b) || comparedBefore({ a, b, compared })) {
      continue;
    }
    const pairs = memberPairs({ a, b });
    if (pairs === null) {
      return false;
    }
    pairs.forEach((pair) => pending.push(pair));
  }
  return true;
}

/** Whether two objects were already compared, recording them as compared when they were not. */
function comparedBefore({
  a,
  b,
  compared,
}: {
  a: unknown;
  b: unknown;
  compared: Map<object, WeakSet<object>>;
}): boolean {
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
    return false;
  }
  const against = compared.get(a);
  if (against?.has(b) === true) {
    return true;
  }
  if (against === undefined) {
    compared.set(a, new WeakSet<object>([b]));
  } else {
    against.add(b);
  }
  return false;
}

/**
 * The member pairs two values' sameness rests on: their items or their members, none for two identical leaves, and
 * `null` when they already differ in kind, length or keys.
 */
function memberPairs({ a, b }: { a: unknown; b: unknown }): readonly (readonly [unknown, unknown])[] | null {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length ? a.map((item, index): readonly [unknown, unknown] => [item, b[index]]) : null;
  }
  if (isRecord(a) && isRecord(b) && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = Object.keys(a);
    const sameKeys = keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key));
    return sameKeys ? keys.map((key): readonly [unknown, unknown] => [a[key], b[key]]) : null;
  }
  return Object.is(a, b) ? [] : null;
}

/** A media type's essence: what precedes any parameter, trimmed and lowercased. */
function essenceOf({ media }: { media: string }): string {
  return media.split(";")[0]!.trim().toLowerCase();
}

/** Every JSON schema and every file media type one operation's 2xx answers declare, in status-code order. */
function answerMedia({
  document,
  responses,
}: {
  document: Readonly<Record<string, unknown>>;
  responses: Readonly<Record<string, unknown>>;
}): Result<{ readonly json: readonly unknown[]; readonly files: readonly string[] }, DatadogSpecError> {
  const json: unknown[] = [];
  const files: string[] = [];
  for (const code of Object.keys(responses)
    .filter((key) => /^2(?:\d\d|XX)$/.test(key))
    .toSorted()) {
    const resolved = datadogSpecDereferenced({ document, located: { node: responses[code], stack: [] } });
    if (resolved.isErr()) {
      return err(resolved.error);
    }
    for (const [media, body] of contentEntries({ response: resolved.value })) {
      const essence = essenceOf({ media });
      if (essence === "application/json") {
        json.push(datadogSpecMember({ key: "schema", value: body }));
      } else {
        files.push(essence);
      }
    }
  }
  return ok({ files, json });
}

/** The media entries one resolved response declares under `content`; none for a recursive one. */
function contentEntries({
  response,
}: {
  response: DatadogSpecNode | "recursive";
}): readonly (readonly [string, unknown])[] {
  if (response === "recursive") {
    return [];
  }
  const content = datadogSpecMember({ key: "content", value: response.node });
  return isRecord(content) ? Object.entries(content) : [];
}

/**
 * How one operation's 2xx answer is declared, from every `2xx` code and the OpenAPI 3.0 `2XX` range; `default` is
 * not read, since nothing in it says it answers a success. A response-level `$ref` is resolved, a parameterised JSON
 * media type (`application/json;datetime-format=rfc3339`) is JSON, and two JSON media entries declaring different
 * schemas anywhere across the 2xx answers is refused, whether under two codes or two JSON media types of one code,
 * since nothing tells a boundary which of them an answer chose. A schema containing itself is returned uncompared,
 * for generation to refuse as unreadable.
 *
 * @param document the pinned specification the operation is declared in
 * @param method the HTTP method, as the registry row carries it
 * @param path the path template, as the registry row carries it
 * @returns the JSON schema, or the file media; or why the declaration could not be read
 */
export function datadogResponseDeclaration({
  document,
  method,
  path,
}: {
  document: Readonly<Record<string, unknown>>;
  method: string;
  path: string;
}): Result<DatadogResponseDeclaration, DatadogSpecError> {
  const item = datadogSpecMember({ key: path, value: document["paths"] });
  const operation = datadogSpecMember({ key: method.toLowerCase(), value: item });
  const responses = isRecord(operation) ? operation["responses"] : undefined;
  if (!isRecord(responses)) {
    return err(DatadogSpecErrors.operationUndeclared({ method, path }));
  }
  const answers = answerMedia({ document, responses });
  if (answers.isErr()) {
    return err(answers.error);
  }
  const { json, files } = answers.value;
  // A schema containing itself has no end to compare; it is handed on as declared, so generation refuses it as
  // unreadable before reading anything, the one place that refusal is made.
  const cyclic = json.find((schema) => datadogSpecCyclic({ value: schema }));
  if (cyclic !== undefined) {
    return ok({ media: "json", schema: { node: cyclic, stack: [] } });
  }
  if (json.some((schema) => !sameJson({ left: json[0], right: schema }))) {
    return err(DatadogSpecErrors.answersDiverge({ method, path }));
  }
  if (json.length > 0) {
    return ok({ media: "json", schema: { node: json[0], stack: [] } });
  }
  if (files.length > 0) {
    return ok({ essence: files[0]!, media: "file" });
  }
  return err(DatadogSpecErrors.noContent({ method, path }));
}
