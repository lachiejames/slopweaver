/** Unit: the `linear` verbs' typed refusals, and the one-line-per-problem view their printers read. */
import { describe, expect, it } from "vitest";

import { LinearVerbErrors, linearVerbErrorLines } from "../../../../../cli/commands/linear/errors.js";
import { parseLinearProjectArgs, parseLinearProjectForm } from "../../../../../cli/commands/linear/projectCore.js";
import { unwrapErr } from "../../../../../lib/result.js";

describe("linearVerbErrorLines", () => {
  it("prints every collected invocation problem on its own line, never the joined message", () => {
    const error = unwrapErr(parseLinearProjectArgs({ argv: ["update", "--project-id", "../../etc"] }));
    expect(error.code).toBe("ARGUMENTS_REFUSED");
    expect(linearVerbErrorLines({ error })).toEqual([
      "--form <json|-> is required (use `-` to read the form from stdin)",
      '--project-id must be a UUID v4; "../../etc" is not, and it would reach a ledger filename',
    ]);
    expect(error.message).toBe(
      "--form <json|-> is required (use `-` to read the form from stdin); " +
        '--project-id must be a UUID v4; "../../etc" is not, and it would reach a ledger filename',
    );
  });

  it("prints one line per schema issue, each naming its path", () => {
    const error = unwrapErr(parseLinearProjectForm({ raw: JSON.stringify({ fields: {} }) }));
    expect(error.code).toBe("FORM_INVALID");
    expect(linearVerbErrorLines({ error })).toEqual([
      "fields.name: Invalid input: expected string, received undefined",
      "fields.teamIds: Invalid input: expected array, received undefined",
    ]);
  });

  it("prints the flag parser's own refusals as they came", () => {
    const error = LinearVerbErrors.flagsRefused({ reasons: ["unknown flag --nope", "--form requires a value"] });
    expect(linearVerbErrorLines({ error })).toEqual(["unknown flag --nope", "--form requires a value"]);
  });

  it("prints a single-line refusal as its message alone", () => {
    const error = unwrapErr(parseLinearProjectArgs({ argv: ["delete"] }));
    expect(error).toEqual(LinearVerbErrors.usage({ noun: "project", shape: "<create|update>" }));
    expect(linearVerbErrorLines({ error })).toEqual([
      "usage: slopweaver linear project <create|update> --form <json|-> [...]",
    ]);
  });

  it("names a form that is not JSON at all", () => {
    const error = unwrapErr(parseLinearProjectForm({ raw: "{" }));
    expect(error.code).toBe("FORM_NOT_JSON");
    expect(linearVerbErrorLines({ error })[0]).toContain("the form is not valid JSON: ");
  });
});
