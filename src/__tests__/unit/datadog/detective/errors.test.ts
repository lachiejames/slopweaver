/**
 * The Datadog shape catalogue's four failures, built through their factory: an absent catalogue that names
 * the build verb, an unreadable one that keeps its cause, a failed call that takes an Error's own message or
 * stringifies anything else, and a window reaching past the index's retention.
 */
import { describe, expect, it } from "vitest";

import { DatadogDetectiveErrors } from "../../../../datadog/detective/errors.js";

describe("DatadogDetectiveErrors", () => {
  it("catalogueAbsent is CATALOGUE_ABSENT, naming the path and the build verb", () => {
    expect(DatadogDetectiveErrors.catalogueAbsent({ path: "/h/datadog/catalogue.json" })).toEqual({
      code: "CATALOGUE_ABSENT",
      message:
        "no Datadog shape catalogue at /h/datadog/catalogue.json — build one with `slopweaver datadog catalogue build`",
      path: "/h/datadog/catalogue.json",
    });
  });

  it("catalogueUnreadable is CATALOGUE_UNREADABLE, keeping the cause and telling the reader to rebuild", () => {
    const cause = new SyntaxError("Unexpected token");

    const error = DatadogDetectiveErrors.catalogueUnreadable({ cause, path: "/h/datadog/catalogue.json" });

    expect(error).toEqual({
      cause,
      code: "CATALOGUE_UNREADABLE",
      message:
        "the Datadog shape catalogue at /h/datadog/catalogue.json could not be read as one — rebuild it with `slopweaver datadog catalogue build`",
      path: "/h/datadog/catalogue.json",
    });
    expect(error.cause).toBe(cause);
  });

  it("callFailed is DATADOG_CALL_FAILED, taking an Error's own message and keeping the Error", () => {
    const cause = new Error("timed out");

    const error = DatadogDetectiveErrors.callFailed({ cause, what: "logs search" });

    expect(error).toEqual({
      cause,
      code: "DATADOG_CALL_FAILED",
      message: "logs search did not come back usable: timed out",
      what: "logs search",
    });
    expect(error.cause).toBe(cause);
  });

  it("callFailed is DATADOG_CALL_FAILED, stringifying a cause that is not an Error", () => {
    expect(DatadogDetectiveErrors.callFailed({ cause: 503, what: "service map" })).toEqual({
      cause: 503,
      code: "DATADOG_CALL_FAILED",
      message: "service map did not come back usable: 503",
      what: "service map",
    });
  });

  it("windowPastRetention is WINDOW_PAST_RETENTION, naming both day counts and what a zero means", () => {
    expect(DatadogDetectiveErrors.windowPastRetention({ requestedDays: 31, retainedDays: 30 })).toEqual({
      code: "WINDOW_PAST_RETENTION",
      message:
        "a 31-day window reaches past this index's 30-day retention. " +
        'A zero for an older window means "not retained", never "no events" — narrow the window rather than believing the count.',
      requestedDays: 31,
      retainedDays: 30,
    });
  });
});
