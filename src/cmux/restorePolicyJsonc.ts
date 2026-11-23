/**
 * The hand-written JSONC scanner and parser `./restorePolicy.ts` reads cmux's `cmux.json` through — structural
 * tokens with their offsets, and a parse into token indices, so an edit is a splice that keeps every comment.
 *
 * Why hand-written rather than a library, and the leniency it carries as residue, is `./restorePolicy.ts`'s header.
 * Every refusal here is a `CONFIG_SHAPE_REFUSED` naming the line it met, because a file this cannot scan or parse is
 * one the verb will not edit.
 *
 * Pure: text in, tokens or a parsed tree out.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type RestorePolicyError, RestorePolicyErrors } from "./restorePolicyErrors.js";

/**
 * Characters that separate tokens and carry nothing. The BOM is one so a file carrying it still READS; `--apply`
 * refuses to EDIT one (`../cli/commands/fleet/restorePolicyRun.ts`), because a splice can move it mid-file.
 */
const WHITESPACE: ReadonlySet<string> = new Set([" ", "\t", "\n", "\r", "﻿"]);

/** The single-character structural tokens. */
const PUNCTUATION: ReadonlySet<string> = new Set(["{", "}", "[", "]", ":", ","]);

/** One character of a bare word: `true`, `false`, `null` or a number. */
const WORD_CHAR = /[A-Za-z0-9_.+-]/;

/** One structural token, with the half-open span of the input it came from. */
export interface JsoncToken {
  readonly kind: "punct" | "string" | "word";
  /** The token's exact source text — a string keeps its quotes and escapes. */
  readonly raw: string;
  readonly start: number;
  readonly end: number;
}

/** A parsed value: token indices into the scanned stream, never copies of the text. */
type JsoncNode =
  | { readonly kind: "object"; readonly open: number; readonly close: number; readonly members: readonly JsoncMember[] }
  | { readonly kind: "array"; readonly open: number; readonly close: number }
  | { readonly kind: "scalar"; readonly index: number };

/** The object node, named for the walker's own signatures. */
export type JsoncObject = Extract<JsoncNode, { kind: "object" }>;

/** One `"key": value` member of an object. */
export interface JsoncMember {
  readonly key: string;
  readonly keyIndex: number;
  readonly value: JsoncNode;
}

/** A parse step's node and the index of the first token after it. */
interface Parsed {
  readonly node: JsoncNode;
  readonly next: number;
}

/** The 1-based line an offset sits on, for a refusal a reader can find in an editor. */
function lineAt({ text, offset }: { text: string; offset: number }): number {
  let line = 1;
  for (let at = text.indexOf("\n"); at !== -1 && at < offset; at = text.indexOf("\n", at + 1)) {
    line += 1;
  }
  return line;
}

/** The end of the string token opening at `start`, or the line it never closed on. */
function stringEnd({ text, start }: { text: string; start: number }): Result<number, RestorePolicyError> {
  let at = start + 1;
  while (at < text.length) {
    const char = text.charAt(at);
    if (char === "\\") {
      at += 2;
      continue;
    }
    if (char === '"') {
      return ok(at + 1);
    }
    if (char === "\n") {
      break;
    }
    at += 1;
  }
  return err(
    RestorePolicyErrors.shapeRefused({
      reason: `unterminated string at line ${String(lineAt({ offset: start, text }))}`,
    }),
  );
}

/** The end of the `/* *\/` block comment opening at `at`, or the line it never closed on. */
function blockCommentEnd({ text, at }: { text: string; at: number }): Result<number, RestorePolicyError> {
  const close = text.indexOf("*/", at + 2);
  if (close === -1) {
    const line = String(lineAt({ offset: at, text }));
    return err(RestorePolicyErrors.shapeRefused({ reason: `unterminated /* comment at line ${line}` }));
  }
  return ok(close + 2);
}

/**
 * The offset past the whitespace character or comment at `at`, `undefined` when what sits there is not one, or the
 * refusal for a block comment that never closes.
 */
function skippedEnd({ text, at }: { text: string; at: number }): Result<number | undefined, RestorePolicyError> {
  const char = text.charAt(at);
  const next = text.charAt(at + 1);
  if (WHITESPACE.has(char)) {
    return ok(at + 1);
  }
  const opensLineComment = char === "/" && next === "/";
  if (opensLineComment) {
    const eol = text.indexOf("\n", at);
    return ok(eol === -1 ? text.length : eol);
  }
  const opensBlockComment = char === "/" && next === "*";
  if (opensBlockComment) {
    return blockCommentEnd({ at, text });
  }
  return ok(undefined);
}

/** The end of the bare word starting at `at`. */
function wordEnd({ text, at }: { text: string; at: number }): number {
  let end = at;
  while (end < text.length && WORD_CHAR.test(text.charAt(end))) {
    end += 1;
  }
  return end;
}

/** The structural token starting at `at`, or the refusal for a character no token starts with. */
function tokenAt({ text, at }: { text: string; at: number }): Result<JsoncToken, RestorePolicyError> {
  const char = text.charAt(at);
  if (PUNCTUATION.has(char)) {
    return ok({ end: at + 1, kind: "punct", raw: char, start: at });
  }
  if (char === '"') {
    return stringEnd({ start: at, text }).map((end): JsoncToken => ({
      end,
      kind: "string",
      raw: text.slice(at, end),
      start: at,
    }));
  }
  if (WORD_CHAR.test(char)) {
    const end = wordEnd({ at, text });
    return ok({ end, kind: "word", raw: text.slice(at, end), start: at });
  }
  const line = String(lineAt({ offset: at, text }));
  return err(RestorePolicyErrors.shapeRefused({ reason: `unexpected ${JSON.stringify(char)} at line ${line}` }));
}

/**
 * Scan JSONC into its structural tokens, skipping whitespace, a BOM, `//` line comments and `/* *\/` block
 * comments. A `//` or a brace inside a string is part of the string.
 *
 * @param text the whole file
 * @returns every token in order, or the refusal naming the line an unterminated string or comment opened on
 */
export function scanJsonc({ text }: { text: string }): Result<readonly JsoncToken[], RestorePolicyError> {
  const tokens: JsoncToken[] = [];
  let at = 0;
  while (at < text.length) {
    const skipped = skippedEnd({ at, text });
    if (skipped.isErr()) {
      return err(skipped.error);
    }
    if (skipped.value !== undefined) {
      at = skipped.value;
      continue;
    }
    const token = tokenAt({ at, text });
    if (token.isErr()) {
      return err(token.error);
    }
    tokens.push(token.value);
    at = token.value.end;
  }
  return ok(tokens);
}

/**
 * A refusal at one token's line.
 *
 * @param text the whole file, so the token's offset can be turned into a line
 * @param token the token the walker met, `undefined` when it ran off the end of the file
 * @param what what was wrong there, in the refusal's words
 * @returns the shape refusal naming the line, or the end of the file
 */
export function refusedAt({
  text,
  token,
  what,
}: {
  text: string;
  token: JsoncToken | undefined;
  what: string;
}): RestorePolicyError {
  if (token === undefined) {
    return RestorePolicyErrors.shapeRefused({ reason: `${what} at the end of the file` });
  }
  return RestorePolicyErrors.shapeRefused({
    reason: `${what} at line ${String(lineAt({ offset: token.start, text }))}`,
  });
}

/** One string token's decoded text, or the refusal for an escape JSON does not allow. */
function decodeKey({ text, token }: { text: string; token: JsoncToken }): Result<string, RestorePolicyError> {
  try {
    const decoded: unknown = JSON.parse(token.raw);
    if (typeof decoded === "string") {
      return ok(decoded);
    }
  } catch {
    // Falls through to the refusal below: a key JSON cannot decode is not one this verb edits around.
  }
  return err(refusedAt({ text, token, what: "a key with an invalid escape" }));
}

/** Parse an object whose `{` is the token at `open`. Trailing commas are allowed, as JSONC allows them. */
function parseObject({
  text,
  tokens,
  open,
}: {
  text: string;
  tokens: readonly JsoncToken[];
  open: number;
}): Result<Parsed, RestorePolicyError> {
  const members: JsoncMember[] = [];
  let at = open + 1;
  for (;;) {
    const token = tokens[at];
    if (isPunct({ raw: "}", token })) {
      return ok({ next: at + 1, node: { close: at, kind: "object", members, open } });
    }
    const member = parseMember({ at, text, tokens });
    if (member.isErr()) {
      return err(member.error);
    }
    members.push(member.value.member);
    at = member.value.next;
    const separator = tokens[at];
    if (isPunct({ raw: ",", token: separator })) {
      at += 1;
      continue;
    }
    if (!isPunct({ raw: "}", token: separator })) {
      return err(refusedAt({ text, token: separator, what: "expected , or }" }));
    }
  }
}

/** Whether a token is the punctuation `raw` — `false` past the end of the stream. */
function isPunct({ token, raw }: { token: JsoncToken | undefined; raw: string }): boolean {
  return token?.kind === "punct" && token.raw === raw;
}

/** Parse the `"key": value` member whose key is the token at `at`, and the index of the first token after it. */
function parseMember({
  text,
  tokens,
  at,
}: {
  text: string;
  tokens: readonly JsoncToken[];
  at: number;
}): Result<{ readonly member: JsoncMember; readonly next: number }, RestorePolicyError> {
  const token = tokens[at];
  if (token?.kind !== "string") {
    return err(refusedAt({ text, token, what: "expected a key or }" }));
  }
  const key = decodeKey({ text, token });
  if (key.isErr()) {
    return err(key.error);
  }
  const colon = tokens[at + 1];
  if (!isPunct({ raw: ":", token: colon })) {
    return err(refusedAt({ text, token: colon, what: "expected :" }));
  }
  const value = parseValue({ at: at + 2, text, tokens });
  if (value.isErr()) {
    return err(value.error);
  }
  return ok({ member: { key: key.value, keyIndex: at, value: value.value.node }, next: value.value.next });
}

/** Parse an array whose `[` is the token at `open`. */
function parseArray({
  text,
  tokens,
  open,
}: {
  text: string;
  tokens: readonly JsoncToken[];
  open: number;
}): Result<Parsed, RestorePolicyError> {
  let at = open + 1;
  for (;;) {
    const token = tokens[at];
    if (token?.raw === "]" && token.kind === "punct") {
      return ok({ next: at + 1, node: { close: at, kind: "array", open } });
    }
    const value = parseValue({ at, text, tokens });
    if (value.isErr()) {
      return err(value.error);
    }
    at = value.value.next;
    const separator = tokens[at];
    if (separator?.raw === "," && separator.kind === "punct") {
      at += 1;
      continue;
    }
    if (separator?.raw !== "]" || separator.kind !== "punct") {
      return err(refusedAt({ text, token: separator, what: "expected , or ]" }));
    }
  }
}

/**
 * Parse the value starting at token `at`.
 *
 * @param text the whole file, for a refusal's line
 * @param tokens the scanned stream
 * @param at the index of the value's first token
 * @returns the parsed node and the index of the first token after it, or the shape refusal
 */
export function parseValue({
  text,
  tokens,
  at,
}: {
  text: string;
  tokens: readonly JsoncToken[];
  at: number;
}): Result<Parsed, RestorePolicyError> {
  const token = tokens[at];
  if (token === undefined) {
    return err(refusedAt({ text, token, what: "expected a value" }));
  }
  if (token.kind === "punct" && token.raw === "{") {
    return parseObject({ open: at, text, tokens });
  }
  if (token.kind === "punct" && token.raw === "[") {
    return parseArray({ open: at, text, tokens });
  }
  if (token.kind === "punct") {
    return err(refusedAt({ text, token, what: `unexpected ${token.raw}` }));
  }
  return ok({ next: at + 1, node: { index: at, kind: "scalar" } });
}
