/**
 * The service config's TEXT, decoded only when every YAML reader would decode it the same way.
 *
 * `serviceConfig.ts` reads rules out of a decoded document; this module decides whether there is a document
 * to read at all. Google's own toolchain reads `chronicle_v1.yaml` with a different YAML reader than this one,
 * so any shape where two readers split — a line break one of them does not see, an anchor, a tag, an escape,
 * a quote folded across lines, a flow collection, a block-scalar header, a merge key, a line outside the forms
 * the pinned file uses — is refused rather than read one way when Google reads another.
 */
import { type Document, parseDocument, visit } from "yaml";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import { type GoogleSecopsInventoryError, GoogleSecopsInventoryErrors } from "./errors.js";

/**
 * Find the first YAML merge key anywhere in a decoded document.
 *
 * `yaml` parses as YAML 1.2, where `<<` is an ordinary key, while a 1.1 reader merges the mapping it names.
 * The two readers would then see different rules, so the key is refused wherever it sits.
 *
 * @param node the decoded value to search
 * @param path the keys leading to it, for the refusal
 * @returns the dotted path of the first `<<` key, or null when there is none
 */
function mergeKeyPath({ node, path }: { node: unknown; path: readonly string[] }): string | null {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      const found = mergeKeyPath({ node: item, path: [...path, String(index)] });
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  if (typeof node !== "object" || node === null) {
    return null;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "<<") {
      return [...path, key].join(".");
    }
    const found = mergeKeyPath({ node: value, path: [...path, key] });
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * Find the first flow collection (`{…}` or `[…]`) holding anything.
 *
 * Inside one, libyaml reads `{?rules: x}` as the key `rules` where this reader keeps `?rules`, which a
 * non-strict schema object then drops, so the two readers see different rule lists. The pinned file is
 * written entirely in block style, so a non-empty flow collection is refused wherever it sits; an empty
 * `[]` or `{}` holds no key to split.
 *
 * @param yamlDocument the parsed document, already free of errors and warnings
 * @returns the offset the first non-empty flow collection starts at, or null when there is none
 */
function firstFlowCollectionOffset({ yamlDocument }: { yamlDocument: Document }): number | null {
  let found: number | null = null;
  visit(yamlDocument, {
    Collection(_key, node) {
      if (node.flow === true && node.items.length > 0) {
        found = node.range![0];
        return visit.BREAK;
      }
      return undefined;
    },
  });
  return found;
}

/**
 * Find the first block scalar whose header is anything but the bare `|-` the pinned file uses.
 *
 * Readers split on a block scalar's trailing lines: given an explicit indentation indicator, this reader drops a
 * whitespace-only last line no longer than the first content line where libyaml keeps it as content, and keep
 * (`+`) or clip chomping is where the end-of-file newline differs. A bare `|-` with its indent detected
 * is read the same by both, so every other header is refused.
 *
 * @param text the whole service config, which the node ranges index into
 * @returns the offset and header text of the first other block scalar, or null when there is none
 */
function blockScalarOutsideBareStrip({
  text,
  yamlDocument,
}: {
  text: string;
  yamlDocument: Document;
}): { header: string; offset: number } | null {
  let found: { header: string; offset: number } | null = null;
  visit(yamlDocument, {
    Scalar(_key, node) {
      if (node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED") {
        const offset = node.range![0];
        const header = text.slice(offset, text.indexOf("\n", offset));
        if (header !== "|-") {
          found = { header, offset };
          return visit.BREAK;
        }
      }
      return undefined;
    },
  });
  return found;
}

/**
 * Find the first quote outside the one form the pinned file uses: a single-quoted value that opens and closes
 * on the same line, with no `''` inside it.
 *
 * A quoted value left open across a line break is where readers split: this reader ends a single-quoted value
 * at a line indented less than it requires, while libyaml folds the following lines into it until the next
 * quote — so a rule hidden in those lines is real config here and part of a scope string there. A `''` is
 * what lets the cut value still end in a quote; a double quote opens the same folding. Refused by line, on
 * the raw text, so no reader's view of where a value ends is trusted.
 *
 * @param text the whole service config
 * @returns the refusal's detail, or null when every quote is in the one-line form
 */
function quoteOutsideOneLineForm({ text }: { text: string }): string | null {
  const double = text.indexOf('"');
  if (double !== -1) {
    return `holds '"' at offset ${double}, which opens a double-quoted value that YAML readers fold across lines differently`;
  }
  let lineStart = 0;
  for (const line of text.split("\n")) {
    const count = line.split("'").length - 1;
    if (count !== 0 && (count !== 2 || line.includes("''"))) {
      return `holds ${count} single quotes on the line at offset ${lineStart}, where only one value quoted and closed on that line is read — an open quote folds the next lines into one value for libyaml and not for this reader`;
    }
    lineStart += line.length + 1;
  }
  return null;
}

/** A key line: optional indent, an optional sequence dash, a bare key, then nothing or one space and a value. */
const KEY_LINE = /^( *)(- )?[A-Za-z_][A-Za-z0-9_]*:(?: (.*))?$/u;
/** A plain list item: optional indent, a dash, one space, then a value. */
const ITEM_LINE = /^ *- (.*)$/u;
/** A plain value: no comment, no quote, no `: `, no leading indicator, and single spaces only between words. */
const PLAIN_VALUE = /^[A-Za-z0-9/](?:[^#': ]|:(?=[^ ])| (?=[^ ]))*$/u;
/** A single-quoted value closed on its own line; the quote gate has already refused a `''` inside one. */
const QUOTED_VALUE = /^'[^']*'$/u;

/** One line's verdict: the `|-` block column it opens (`null` for none), or why it is refused. */
type LineVerdict = { readonly blockColumn: number | null } | { readonly refusal: string };

/**
 * Judge one key line: a `|-` header opens a block, and any other value must be one every reader reads alike.
 *
 * @param key the line's `KEY_LINE` match
 * @param lineStart the line's offset, for the refusal
 * @returns the block column a `|-` header opens, or why the value is refused
 */
function judgeKeyLine({ key, lineStart }: { key: RegExpExecArray; lineStart: number }): LineVerdict {
  const value = key[3];
  if (value === "|-") {
    return { blockColumn: key[1]!.length + (key[2] === undefined ? 0 : 2) };
  }
  const readAlike = value === undefined || value === "[]" || PLAIN_VALUE.test(value) || QUOTED_VALUE.test(value);
  if (!readAlike) {
    return {
      refusal: `holds a value on the line at offset ${lineStart} that is not plain, single-quoted or a bare |- — YAML readers split on the rest`,
    };
  }
  return { blockColumn: null };
}

/**
 * Judge one line outside any `|-` block against the pinned file's own forms.
 *
 * @param line the line, without its newline
 * @param lineStart the line's offset, for the refusal
 * @returns the block column the line opens, or why it is refused
 */
function judgeLine({ line, lineStart }: { line: string; lineStart: number }): LineVerdict {
  const key = KEY_LINE.exec(line);
  if (key !== null) {
    return judgeKeyLine({ key, lineStart });
  }
  const item = ITEM_LINE.exec(line);
  if (line === "" || (item !== null && PLAIN_VALUE.test(item[1]!))) {
    return { blockColumn: null };
  }
  return {
    refusal: `holds the line at offset ${lineStart}, which is none of the forms the pinned file uses — a key, a plain list item, a blank line or a line inside a |- block — and YAML readers split on the rest`,
  };
}

/**
 * Find the first line outside the grammar the pinned file is written in.
 *
 * Every split between this reader and libyaml so far has been a shape the pinned file never uses — an explicit
 * `?` key, a comment line between a key and its plain value, a plain value continued on the next line, a
 * document marker. So the raw text is held to the pinned file's own forms rather than to YAML: a key whose
 * value is absent, plain, single-quoted, an empty `[]` (read alike by every reader, so the schema still names
 * an empty list) or a `|-` header; a plain list item; a blank line; or a line inside a `|-` block, which is
 * any line indented past the column of the key that opened it, or empty.
 *
 * @param text the whole service config
 * @returns the refusal's detail, or null when every line is one of those forms
 */
function lineOutsidePinnedGrammar({ text }: { text: string }): string | null {
  let blockColumn: number | null = null;
  let lineStart = 0;
  for (const line of text.split("\n")) {
    const indent = line.length - line.trimStart().length;
    const insideBlock = blockColumn !== null && (line === "" || indent > blockColumn);
    if (!insideBlock) {
      const verdict = judgeLine({ line, lineStart });
      if ("refusal" in verdict) {
        return verdict.refusal;
      }
      blockColumn = verdict.blockColumn;
    }
    lineStart += line.length + 1;
  }
  return null;
}

/**
 * Find the first reader split visible in the raw text, before any YAML reader has decoded it.
 *
 * @param text the whole service config
 * @returns the refusal's detail, or null when the raw text holds none
 */
function rawTextSplit({ text }: { text: string }): string | null {
  // YAML readers disagree on what ends a line: this 1.2 reader runs a `#` comment through U+2028, U+2029 and
  // U+0085, where libyaml breaks the line and reads what follows as config. The pinned file is printable
  // ASCII and newlines only, so anything else is refused rather than read one way when Google reads another.
  const foreign = /[^\n\x20-\x7E]/u.exec(text);
  if (foreign !== null) {
    const codePoint = foreign[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
    return `holds U+${codePoint} at offset ${foreign.index}, outside the printable ASCII and newlines this reads`;
  }
  // The same disagreement in plain ASCII: libyaml ends an anchor name at `:` where this reader does not, and a
  // `%YAML 1.1` directive or a `!!merge` tag makes this reader merge where the `<<` refusal below never looks.
  // The pinned file holds no anchor, tag or directive, so their three marker characters are refused outright;
  // with no anchor, an alias is an error to every reader.
  const marker = /[!%&]/u.exec(text);
  if (marker !== null) {
    return `holds '${marker[0]}' at offset ${marker.index}, which opens a YAML anchor, tag or directive that readers disagree on`;
  }
  // An escape is the one way ASCII text decodes to a character outside it: `"﻿"` passes the byte check
  // above yet yields U+FEFF, which JavaScript's trim strips and other readers keep. The pinned file holds no
  // backslash at all, so one is refused wherever it sits.
  const escape = text.indexOf("\\");
  if (escape !== -1) {
    return `holds '\\' at offset ${escape}, which opens an escape that can decode outside the printable ASCII this reads`;
  }
  const quote = quoteOutsideOneLineForm({ text });
  if (quote !== null) {
    return quote;
  }
  // A `|` or `>` block scalar that closes the file is read with a trailing newline here and with none by
  // libyaml when the file stops short of one, so a path written that way gains a byte only this reader sees.
  // The pinned file ends in a newline, so one that does not is refused.
  if (!text.endsWith("\n")) {
    return `ends at offset ${text.length} without a newline, where a block scalar closing the file reads a trailing newline here and none in libyaml`;
  }
  return null;
}

/**
 * Find the first reader split in the parsed document: an error or warning, a flow collection, or a block
 * scalar headed by anything but `|-`.
 *
 * @param text the whole service config, which the node ranges index into
 * @returns the refusal's detail, or null when the document holds none
 */
function yamlDocumentSplit({ text, yamlDocument }: { text: string; yamlDocument: Document }): string | null {
  // A warning is a value this reader decoded differently from what the author meant. Its known causes (an
  // unknown `!tag`, a `%` directive) are refused above; any other refuses exactly as an error does.
  const problems = [...yamlDocument.errors, ...yamlDocument.warnings];
  if (problems.length > 0) {
    return problems.map((problem) => problem.message).join("; ");
  }
  const flow = firstFlowCollectionOffset({ yamlDocument });
  if (flow !== null) {
    return `holds a flow collection at offset ${flow}, whose keys YAML readers split differently — write it as a block`;
  }
  const block = blockScalarOutsideBareStrip({ text, yamlDocument });
  if (block !== null) {
    return `holds a block scalar headed '${block.header}' at offset ${block.offset}, where only a bare |- is read — any other header splits readers on its trailing lines`;
  }
  return null;
}

/**
 * Decode text whose raw form holds no reader split, refusing a split in the parsed document.
 *
 * @param text the whole service config
 * @returns the decoded value, or the first reason a reader could split on it
 */
function decodeYamlText({ text }: { text: string }): Result<unknown, GoogleSecopsInventoryError> {
  try {
    const yamlDocument = parseDocument(text);
    const split = yamlDocumentSplit({ text, yamlDocument });
    if (split !== null) {
      return err(GoogleSecopsInventoryErrors.serviceConfigUnparseable({ detail: split }));
    }
    return ok(yamlDocument.toJS());
  } catch (error: unknown) {
    return err(GoogleSecopsInventoryErrors.serviceConfigUnparseable({ detail: errorMessage({ error }) }));
  }
}

/**
 * Decode the service config's text, refusing every shape two YAML readers would decode differently.
 *
 * @param text the whole `chronicle_v1.yaml`
 * @returns the decoded document, or the first reason a reader could split on it
 */
export function decodePinnedServiceConfigText({ text }: { text: string }): Result<unknown, GoogleSecopsInventoryError> {
  const raw = rawTextSplit({ text });
  if (raw !== null) {
    return err(GoogleSecopsInventoryErrors.serviceConfigUnparseable({ detail: raw }));
  }
  const decodedText = decodeYamlText({ text });
  if (decodedText.isErr()) {
    return decodedText;
  }
  const decoded = decodedText.value;
  const merge = mergeKeyPath({ node: decoded, path: [] });
  if (merge !== null) {
    return err(
      GoogleSecopsInventoryErrors.serviceConfigUnparseable({
        detail: `a YAML merge key << at ${merge} — a 1.1 reader would merge it and this 1.2 reader would not`,
      }),
    );
  }
  // Last of the reader-split checks, so each earlier one still names its own cause: whatever passed them must
  // also be written in the pinned file's own line forms.
  const grammar = lineOutsidePinnedGrammar({ text });
  if (grammar !== null) {
    return err(GoogleSecopsInventoryErrors.serviceConfigUnparseable({ detail: grammar }));
  }
  return ok(decoded);
}
