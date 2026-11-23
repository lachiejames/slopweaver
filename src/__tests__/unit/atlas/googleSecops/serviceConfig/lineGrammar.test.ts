/**
 * How `parseChronicleServiceConfig` refuses a line outside the forms the pinned file uses: one case per part of
 * the line grammar, and the same refusal wherever such a line sits.
 */
import { describe, expect, it } from "vitest";

import { GoogleSecopsInventoryErrors } from "../../../../../atlas/googleSecops/errors.js";
import { parseChronicleServiceConfig } from "../../../../../atlas/googleSecops/serviceConfig.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { CONFIG } from "./harness.js";

describe("parseChronicleServiceConfig", () => {
  it("refuses what each part of the line grammar holds back, each a document every reader parses", () => {
    // One case per anchor, lookahead and character class: a deeper line after a |- block has closed, a `: ` or a
    // `?` or a quote inside a list item, a key line or list item matched only as a prefix, a quoted value with a
    // plain prefix, and a doubled space.
    const lineDetail = ({ offset }: { offset: number }): string =>
      `holds the line at offset ${offset}, which is none of the forms the pinned file uses — a key, a plain list item, a blank line or a line inside a |- block — and YAML readers split on the rest`;
    const valueDetail = ({ offset }: { offset: number }): string =>
      `holds a value on the line at offset ${offset} that is not plain, single-quoted or a bare |- — YAML readers split on the rest`;
    const cases = [
      { detailOf: valueDetail, line: "        d: x #c", suffix: "  a:\n    b:\n      c:\n        d: x #c\n" },
      { detailOf: lineDetail, line: "  - a:b c: d", suffix: "  tags:\n  - a:b c: d\n" },
      { detailOf: lineDetail, line: "  - ? x", suffix: "  tags:\n  - ? x\n" },
      { detailOf: lineDetail, line: "  - a:b #c", suffix: "  tags:\n  - a:b #c\n" },
      { detailOf: lineDetail, line: "  #c - x", suffix: "  #c - x\n" },
      { detailOf: lineDetail, line: "  - a'b'", suffix: "  tags:\n  - a'b'\n" },
      { detailOf: valueDetail, line: "  k: a'b'", suffix: "  k: a'b'\n" },
      { detailOf: valueDetail, line: "  k: a  b", suffix: "  k: a  b\n" },
      { detailOf: lineDetail, line: "    -x", suffix: "  k: a\n    -x\n" },
      { detailOf: valueDetail, line: "  k: '*' #c", suffix: "  k: '*' #c\n" },
      { detailOf: lineDetail, line: "  - a/b:", suffix: "  tags:\n  - a/b:\n" },
      { detailOf: lineDetail, line: "  - - a: x", suffix: "  tags:\n  - - a: x\n" },
      { detailOf: lineDetail, line: "  -  a: x", suffix: "  tags:\n  -  a: x\n" },
      { detailOf: valueDetail, line: "  k:  x", suffix: "  k:  x\n" },
      { detailOf: lineDetail, line: "  1a: x", suffix: "  1a: x\n" },
      { detailOf: lineDetail, line: "  a/b: x", suffix: "  a/b: x\n" },
      { detailOf: lineDetail, line: "  a-b: x", suffix: "  a-b: x\n" },
      { detailOf: lineDetail, line: "  a.b: x", suffix: "  a.b: x\n" },
      { detailOf: lineDetail, line: "  ? a: b", suffix: "  ? a: b\n" },
      { detailOf: lineDetail, line: "? a: b", suffix: "? a: b\n" },
    ].map((entry) => ({ ...entry, offset: CONFIG.length + entry.suffix.indexOf(`${entry.line}\n`) }));
    // Every fragment was planted: an absent one would put its offset before the appended suffix.
    expect(cases.filter(({ offset }) => offset < CONFIG.length)).toStrictEqual([]);
    expect(
      cases.map(({ suffix }) => unwrapErr(parseChronicleServiceConfig({ text: `${CONFIG}${suffix}` }))),
    ).toStrictEqual(
      cases.map(({ detailOf, offset }) =>
        GoogleSecopsInventoryErrors.serviceConfigUnparseable({ detail: detailOf({ offset }) }),
      ),
    );
  });

  it("refuses a line outside the pinned file's own forms, wherever it sits", () => {
    // The attack: a comment line between `get:` and its plain value lets this reader fold the later `? title`
    // line into the path, where libyaml ends the value and reads `? title` as a key of its own.
    const scopes = "        https://www.googleapis.com/auth/chronicle,";
    const name = "- name: google.cloud.chronicle.v1.RuleService";
    const lineAt = ({ text, line }: { text: string; line: string }): number => text.indexOf(`\n${line}\n`) + 1;
    const lineDetail = ({ offset }: { offset: number }): string =>
      `holds the line at offset ${offset}, which is none of the forms the pinned file uses — a key, a plain list item, a blank line or a line inside a |- block — and YAML readers split on the rest`;
    const valueDetail = ({ offset }: { offset: number }): string =>
      `holds a value on the line at offset ${offset} that is not plain, single-quoted or a bare |- — YAML readers split on the rest`;
    const attack = CONFIG.replace("    body: '*'", "    body:\n#c\n        x\n? title\n: Chronicle API");
    const explicitKey = `${CONFIG}? title\n: Chronicle API\n`;
    const underIndented = CONFIG.replace(scopes, `${scopes}\n      `);
    // A block under `- name:` ends at the key's column, not the dash's: a whitespace line two spaces deep is a
    // blank line to this reader and outside the block to the grammar.
    const dashBlock = CONFIG.replace(name, "- name: |-\n   google.cloud.chronicle.v1.RuleService\n  ");
    const commentedItem = `${CONFIG}  tags:\n  - x #c\n`;
    const comment = CONFIG.replace("api_short_name: chronicle", "api_short_name: chronicle #c");
    const trailing = CONFIG.replace("api_short_name: chronicle", "api_short_name: chronicle ");
    const cases = [
      { detailOf: lineDetail, offset: lineAt({ line: "#c", text: attack }), text: attack },
      { detailOf: lineDetail, offset: 0, text: `---\n${CONFIG}` },
      { detailOf: lineDetail, offset: lineAt({ line: "? title", text: explicitKey }), text: explicitKey },
      { detailOf: lineDetail, offset: lineAt({ line: "      ", text: underIndented }), text: underIndented },
      { detailOf: lineDetail, offset: lineAt({ line: "  ", text: dashBlock }), text: dashBlock },
      { detailOf: lineDetail, offset: lineAt({ line: "  - x #c", text: commentedItem }), text: commentedItem },
      {
        detailOf: valueDetail,
        offset: lineAt({ line: "  api_short_name: chronicle #c", text: comment }),
        text: comment,
      },
      {
        detailOf: valueDetail,
        offset: lineAt({ line: "  api_short_name: chronicle ", text: trailing }),
        text: trailing,
      },
    ];
    // Only the document marker sits at offset 0; anywhere else a 0 is a fragment the fixture failed to plant.
    expect(cases.map(({ offset }) => offset === 0)).toStrictEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(cases.map(({ text }) => unwrapErr(parseChronicleServiceConfig({ text })))).toStrictEqual(
      cases.map(({ detailOf, offset }) =>
        GoogleSecopsInventoryErrors.serviceConfigUnparseable({ detail: detailOf({ offset }) }),
      ),
    );
  });
});
