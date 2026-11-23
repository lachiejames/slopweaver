/** Unit: the JSON-then-schema sequence every `linear` write verb runs over its `--form`. */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { linearVerbErrorLines } from "../../../../../cli/commands/linear/errors.js";
import { parseLinearForm } from "../../../../../cli/commands/linear/formParse.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const schema = z.object({ fields: z.object({ title: z.string() }) }).strict();

describe("parseLinearForm", () => {
  it("returns the schema's own typed value for a form of the right shape", () => {
    expect(unwrap(parseLinearForm({ raw: '{"fields":{"title":"t"}}', schema }))).toEqual({ fields: { title: "t" } });
  });

  it("refuses text that is not JSON as FORM_NOT_JSON, before the schema sees it", () => {
    const error = unwrapErr(parseLinearForm({ raw: "not json", schema }));
    expect(error.code).toBe("FORM_NOT_JSON");
    expect(error.message.startsWith("the form is not valid JSON: ")).toBe(true);
  });

  it("refuses JSON of the wrong shape as FORM_INVALID, one path-named line per issue", () => {
    const error = unwrapErr(parseLinearForm({ raw: '{"fields":{"title":1},"extra":true}', schema }));
    expect(error.code).toBe("FORM_INVALID");
    expect(linearVerbErrorLines({ error })).toEqual([
      "fields.title: Invalid input: expected string, received number",
      ': Unrecognized key: "extra"',
    ]);
  });
});
