/**
 * `BriefingCommandErrors` — the typed failures the `briefing` verb directory authors, and the lines each prints.
 */
import { describe, expect, it } from "vitest";

import { BriefingCommandErrors, briefingCommandErrorLines } from "../../../../../cli/commands/briefing/errors.js";
import { STALE_CARDS_HATCH } from "../../../../../cli/prPremiseDoor.js";

describe("BriefingCommandErrors", () => {
  it("prints a failed premise read as the cause, then the break-glass, on two lines", () => {
    const error = BriefingCommandErrors.premiseReadFailed({ cause: "rate limited", verb: "render" });

    expect(error.code).toBe("PREMISE_CHECK_FAILED");
    expect(briefingCommandErrorLines({ error })).toEqual([
      "the rendered page's cards could not be checked against GitHub: rate limited",
      `For one deliberate exception run slopweaver hatch open ${STALE_CARDS_HATCH} ` +
        '--reason "<why this one is a legitimate exception>", then re-run; the grant skips the live ' +
        "pull-request read entirely.",
    ]);
  });

  it("heads a failed render check with what it withheld, then every check line", () => {
    const error = BriefingCommandErrors.renderCheckFailed({
      lines: ["card 1: over the word cap", "card 2: jargon"],
      refusedPage: "<main></main>",
    });

    expect(briefingCommandErrorLines({ error })).toEqual([
      "the rendered page does not pass `briefing check`, so it was not written:",
      "card 1: over the word cap",
      "card 2: jargon",
    ]);
  });

  it("follows a missing previous version with the verb's usage", () => {
    const error = BriefingCommandErrors.previousVersionMissing({ usage: "usage: briefing corrections" });

    expect(briefingCommandErrorLines({ error })).toEqual([
      "briefing corrections needs the version the owner already read: --artifact <url|id> to take it from the " +
        "freeze, or --previous <html> to name the file directly.",
      "usage: briefing corrections",
    ]);
  });

  it("tells an oversized projected page to reach back fewer days rather than archive", () => {
    const error = BriefingCommandErrors.renderTooLarge({
      bytes: 900,
      cap: 800,
      projected: true,
      refusedPage: "<main></main>",
    });

    expect(error.code).toBe("RENDER_TOO_LARGE");
    expect(error.message).toContain("the rendered page weighs 900 bytes with its images stripped, over the cap of 800");
    expect(error.message).toContain("re-run with `--ticks-days <n>`");
  });

  it("names a document that is not JSON by what it is, with the error it threw", () => {
    expect(
      BriefingCommandErrors.documentNotJson({ cause: new SyntaxError("bad token"), document: "form" }).message,
    ).toBe("the form is not valid JSON: bad token");
    expect(BriefingCommandErrors.documentNotJson({ cause: "not an error", document: "--your-list" }).message).toBe(
      "the --your-list document is not valid JSON: unknown",
    );
  });

  it("prints a single-message variant as its one line", () => {
    const error = BriefingCommandErrors.topOutOfRange({ max: 10 });

    expect(error).toEqual({
      code: "FLAG_OUT_OF_RANGE",
      flag: "--top",
      max: 10,
      message: "--top takes a whole number between 1 and 10",
      min: 1,
    });
    expect(briefingCommandErrorLines({ error })).toEqual(["--top takes a whole number between 1 and 10"]);
  });

  it("forwards another module's refusal as the lines it came as", () => {
    const error = BriefingCommandErrors.upstreamRefused({ reasons: ["first", "second"] });

    expect(error.message).toBe("first; second");
    expect(briefingCommandErrorLines({ error })).toEqual(["first", "second"]);
  });
});
