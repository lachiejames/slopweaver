import { describe, expect, it } from "vitest";

import { DatadogCitationErrors, datadogCitationErrorLines } from "../../../datadog/citationErrors.js";

describe("DatadogCitationErrors", () => {
  it("prints an unparseable link as its one sentence", () => {
    const error = DatadogCitationErrors.urlInvalid({ label: "logs link", url: "not a url" });
    expect(error).toEqual({
      code: "CITATION_URL_INVALID",
      label: "logs link",
      message: "logs link: not a valid URL: not a url",
      url: "not a url",
    });
    expect(datadogCitationErrorLines({ error })).toEqual(["logs link: not a valid URL: not a url"]);
  });

  it("prints every violation, then why an unresolvable citation is refused", () => {
    const error = DatadogCitationErrors.citationRefused({ label: "logs link", violations: ["wrong host"] });
    expect(error.code).toBe("CITATION_REFUSED");
    expect(datadogCitationErrorLines({ error })).toEqual([
      "wrong host",
      "logs link: a citation that does not resolve reads as proof and shows the reader nothing, which is worse than citing nothing",
    ]);
    expect(error.message).toBe(
      "wrong host; logs link: a citation that does not resolve reads as proof and shows the reader nothing, which is worse than citing nothing",
    );
  });
});
