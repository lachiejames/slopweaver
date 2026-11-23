/**
 * The one cut every GCP door output goes through: a literal env value or a payload is replaced by its label
 * wherever it appears, the longest first, in a message and in every string of a document, keys included.
 */
import { describe, expect, it } from "vitest";

import { GcpDoorErrors } from "../../../gcp/errors.js";
import { cutMessage, cutValues, cutValuesDeep, literalEnvValues } from "../../../gcp/redact.js";

const VALUES = [
  { label: "<env TOKEN>", value: "abc" },
  { label: "<env LONG>", value: "abcdef" },
  { label: "<env EMPTY>", value: "" },
] as const;

describe("literalEnvValues", () => {
  it("lists each literal value by its variable's name, and never a secret reference", () => {
    expect(
      literalEnvValues({
        template: {
          containers: [
            {
              env: [
                { name: "TOKEN", value: "abc" },
                { name: "REF", valueSource: { secretKeyRef: { secret: "s" } } },
              ],
              image: "i",
            },
            { image: "j" },
          ],
        },
      }),
    ).toEqual([{ label: "<env TOKEN>", value: "abc" }]);
  });

  it("lists nothing for a template with no containers", () => {
    expect(literalEnvValues({ template: {} })).toEqual([]);
  });
});

describe("cutValues", () => {
  it("cuts the longest value first, so one containing another is cut whole, and skips an empty value", () => {
    expect(cutValues({ text: "x abcdef y abc z", values: VALUES })).toBe("x <env LONG> y <env TOKEN> z");
  });
});

describe("cutMessage", () => {
  it("cuts the message and keeps every other field", () => {
    expect(cutMessage({ error: GcpDoorErrors.inputInvalid({ why: "bad abc" }), values: VALUES })).toEqual({
      code: "INPUT_INVALID",
      message: "bad <env TOKEN>",
    });
  });
});

describe("cutValuesDeep", () => {
  it("cuts every string in a document, keys included, and leaves other values alone", () => {
    expect(cutValuesDeep({ document: { abc: ["abcdef", 1, null, { k: true }] }, values: VALUES })).toEqual({
      "<env TOKEN>": ["<env LONG>", 1, null, { k: true }],
    });
  });
});
