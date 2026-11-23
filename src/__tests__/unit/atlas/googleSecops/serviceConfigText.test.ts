/**
 * The service config's text decoded on its own: the pinned file's forms decode to the plain value every YAML
 * reader agrees on, and a shape readers split on is refused before anything is decoded.
 */
import { describe, expect, it } from "vitest";

import { GoogleSecopsInventoryErrors } from "../../../../atlas/googleSecops/errors.js";
import { decodePinnedServiceConfigText } from "../../../../atlas/googleSecops/serviceConfigText.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("decodePinnedServiceConfigText", () => {
  it("decodes a key, a plain list item, a single-quoted value and a bare |- block", () => {
    const text = "name: a.b\napis:\n- name: x\nscopes:\n- plain\nrules:\n- selector: 'y.*'\n  get: |-\n    /v1/z\n";
    expect(unwrap(decodePinnedServiceConfigText({ text }))).toStrictEqual({
      apis: [{ name: "x" }],
      name: "a.b",
      rules: [{ get: "/v1/z", selector: "y.*" }],
      scopes: ["plain"],
    });
  });

  it("refuses a file that stops short of its last newline, which a closing block scalar reads two ways", () => {
    expect(unwrapErr(decodePinnedServiceConfigText({ text: "name: a" }))).toStrictEqual(
      GoogleSecopsInventoryErrors.serviceConfigUnparseable({
        detail:
          "ends at offset 7 without a newline, where a block scalar closing the file reads a trailing newline here and none in libyaml",
      }),
    );
  });

  it("still judges an indented line after a blank line or a list item, neither of which opens a block", () => {
    const found = ["a: b\n\n ? x\n", "a:\n- b\n  - 'x' y\n"].map(
      (text) => unwrapErr(decodePinnedServiceConfigText({ text })).message,
    );
    expect(found).toStrictEqual(
      [6, 7].map(
        (offset) =>
          `chronicle_v1.yaml could not be read: holds the line at offset ${offset}, which is none of the forms the pinned file uses — a key, a plain list item, a blank line or a line inside a |- block — and YAML readers split on the rest`,
      ),
    );
  });

  it("counts only leading spaces as indent, so a line with trailing spaces does not stay inside a |- block", () => {
    expect(unwrapErr(decodePinnedServiceConfigText({ text: "a: |-\n  t\nb: c #x   \n" })).message).toBe(
      "chronicle_v1.yaml could not be read: holds a value on the line at offset 10 that is not plain, single-quoted or a bare |- — YAML readers split on the rest",
    );
  });
});
