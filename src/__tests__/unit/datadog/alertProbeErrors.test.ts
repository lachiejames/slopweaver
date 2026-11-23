/**
 * `AlertProbeErrors`: the six constructors of an alert-probe set's typed failure union. Each test is named for
 * the code it builds and pins that code as a literal, the whole returned record and its exact message.
 */
import { describe, expect, it } from "vitest";

import { AlertProbeErrors } from "../../../datadog/alertProbeErrors.js";

describe("AlertProbeErrors", () => {
  it("documentUnreadable builds PROBE_DOCUMENT_UNREADABLE carrying the parser's detail", () => {
    const error = AlertProbeErrors.documentUnreadable({ detail: "Unexpected token } in JSON at position 4" });

    expect(error.code).toBe("PROBE_DOCUMENT_UNREADABLE");
    expect(error).toEqual({
      code: "PROBE_DOCUMENT_UNREADABLE",
      detail: "Unexpected token } in JSON at position 4",
      message: "the probe document could not be read as JSON: Unexpected token } in JSON at position 4",
    });
  });

  it("setInvalid builds PROBE_SET_INVALID, keeping every issue and joining them with '; ' in order", () => {
    const issues = ["probes: Required", "probes.0.kind: Invalid enum value"];
    const error = AlertProbeErrors.setInvalid({ issues });

    expect(error.code).toBe("PROBE_SET_INVALID");
    expect(error).toEqual({
      code: "PROBE_SET_INVALID",
      issues: ["probes: Required", "probes.0.kind: Invalid enum value"],
      message: "not a probe set: probes: Required; probes.0.kind: Invalid enum value",
    });
  });

  it("shapeMismatch builds PROBE_SHAPE_MISMATCH attributed to the probe, with the detail only in the message", () => {
    const error = AlertProbeErrors.shapeMismatch({
      detail: "kind 'logs-count' takes no aggregation",
      probeId: "checkout-5xx",
    });

    expect(error.code).toBe("PROBE_SHAPE_MISMATCH");
    expect(error).toEqual({
      code: "PROBE_SHAPE_MISMATCH",
      message: "probe 'checkout-5xx' cannot run as declared: kind 'logs-count' takes no aggregation",
      probeId: "checkout-5xx",
    });
  });

  it("setTooLarge builds PROBE_SET_TOO_LARGE carrying both the declared count and the cap", () => {
    const error = AlertProbeErrors.setTooLarge({ cap: 8, declared: 11 });

    expect(error.code).toBe("PROBE_SET_TOO_LARGE");
    expect(error).toEqual({
      cap: 8,
      code: "PROBE_SET_TOO_LARGE",
      declared: 11,
      message:
        "this set declares 11 probes and a digest card carries 8 rows — split it into two postings rather than " +
        "letting the card decide which findings nobody sees",
    });
  });

  it("readingNotCountable builds PROBE_READING_NOT_COUNTABLE naming the probe, the value and the safe-integer ceiling", () => {
    const error = AlertProbeErrors.readingNotCountable({ probeId: "p95-latency", value: 12.5 });

    expect(error.code).toBe("PROBE_READING_NOT_COUNTABLE");
    expect(error).toEqual({
      code: "PROBE_READING_NOT_COUNTABLE",
      message:
        "probe 'p95-latency' aggregate returned 12.5, and a card row is a whole number of things from 0 to " +
        "9007199254740991 — point this probe at something countable, or use kind 'logs-count'",
      probeId: "p95-latency",
      value: 12.5,
    });
  });

  it("idDuplicated builds PROBE_ID_DUPLICATED attributed to the repeated id", () => {
    const error = AlertProbeErrors.idDuplicated({ probeId: "checkout-5xx" });

    expect(error.code).toBe("PROBE_ID_DUPLICATED");
    expect(error).toEqual({
      code: "PROBE_ID_DUPLICATED",
      message:
        "two probes both declare id 'checkout-5xx' — an id names one row on the card and one line in the report, " +
        "so a duplicate makes a finding impossible to attribute",
      probeId: "checkout-5xx",
    });
  });
});
