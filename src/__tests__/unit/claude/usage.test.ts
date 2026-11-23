import { describe, expect, it } from "vitest";

import { ClaudeRotationErrors } from "../../../claude/errors.js";
import { parseClaudeGauge, readGaugeResponse } from "../../../claude/usage.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/**
 * The exact headers a live Max plan returned, from one
 * `POST /v1/messages` with `max_tokens: 1`. Kept verbatim so a shape change upstream fails this test rather
 * than being absorbed silently.
 */
const LIVE_HEADERS: Readonly<Record<string, string>> = {
  "anthropic-ratelimit-unified-5h-reset": "1788459000",
  "anthropic-ratelimit-unified-5h-status": "allowed",
  "anthropic-ratelimit-unified-5h-utilization": "0.34",
  "anthropic-ratelimit-unified-7d-reset": "1788645600",
  "anthropic-ratelimit-unified-7d-status": "allowed",
  "anthropic-ratelimit-unified-7d-utilization": "0.34",
  "anthropic-ratelimit-unified-overage-status": "rejected",
  "anthropic-ratelimit-unified-representative-claim": "five_hour",
  "anthropic-ratelimit-unified-status": "allowed",
};

const OBSERVED = "2026-09-03T15:39:00.000Z";

describe("parseClaudeGauge", () => {
  it("parses the live header set as measured", () => {
    const result = parseClaudeGauge({ alias: "plan-one", headers: LIVE_HEADERS, observedAtIso: OBSERVED });
    expect(result.isOk()).toBe(true);
    const gauge = unwrap(result);
    expect(gauge.alias).toBe("plan-one");
    expect(gauge.observedAtIso).toBe(OBSERVED);
    expect(gauge.fiveHour!.utilization).toBe(0.34);
    expect(gauge.fiveHour!.status).toBe("allowed");
    expect(gauge.fiveHour!.resetAtIso).toBe("2026-09-03T18:10:00.000Z");
    expect(gauge.sevenDay.utilization).toBe(0.34);
    expect(gauge.sevenDay.resetAtIso).toBe("2026-09-05T22:00:00.000Z");
    expect(gauge.representativeClaim).toBe("five_hour");
  });

  it("reads utilization as a fraction, not a percentage", () => {
    const gauge = unwrap(
      parseClaudeGauge({
        alias: "plan-one",
        headers: { ...LIVE_HEADERS, "anthropic-ratelimit-unified-5h-utilization": "0.97" },
        observedAtIso: OBSERVED,
      }),
    );
    expect(gauge.fiveHour!.utilization).toBe(0.97);
  });

  it("matches header names case-insensitively", () => {
    const upper = Object.fromEntries(Object.entries(LIVE_HEADERS).map(([key, value]) => [key.toUpperCase(), value]));
    const gauge = unwrap(parseClaudeGauge({ alias: "plan-one", headers: upper, observedAtIso: OBSERVED }));
    expect(gauge.fiveHour!.status).toBe("allowed");
  });

  it("carries allowed_warning through as the proactive signal", () => {
    const gauge = unwrap(
      parseClaudeGauge({
        alias: "plan-one",
        headers: { ...LIVE_HEADERS, "anthropic-ratelimit-unified-7d-status": "allowed_warning" },
        observedAtIso: OBSERVED,
      }),
    );
    expect(gauge.sevenDay.status).toBe("allowed_warning");
  });

  it("fails closed on a representative claim it does not recognise, since it names a window no trio reads", () => {
    const result = parseClaudeGauge({
      alias: "plan-one",
      headers: { ...LIVE_HEADERS, "anthropic-ratelimit-unified-representative-claim": "thirty_day" },
      observedAtIso: OBSERVED,
    });
    expect(unwrapErr(result)).toStrictEqual(
      ClaudeRotationErrors.usageShapeChanged({ field: "anthropic-ratelimit-unified-representative-claim" }),
    );
  });

  it("fails closed on a five_hour claim when no five-hour trio was sent, a shape contradicting itself", () => {
    const headers: Record<string, string> = { ...LIVE_HEADERS };
    delete headers["anthropic-ratelimit-unified-5h-status"];
    delete headers["anthropic-ratelimit-unified-5h-utilization"];
    delete headers["anthropic-ratelimit-unified-5h-reset"];
    const result = parseClaudeGauge({ alias: "plan-one", headers, observedAtIso: OBSERVED });
    expect(unwrapErr(result)).toStrictEqual(
      ClaudeRotationErrors.usageShapeChanged({ field: "anthropic-ratelimit-unified-representative-claim" }),
    );
  });

  it("fails closed on a -status family it does not read, since each one grades a limit", () => {
    const result = parseClaudeGauge({
      alias: "plan-one",
      headers: { ...LIVE_HEADERS, "anthropic-ratelimit-unified-30d-status": "rejected" },
      observedAtIso: OBSERVED,
    });
    expect(unwrapErr(result)).toStrictEqual(
      ClaudeRotationErrors.usageShapeChanged({ field: "anthropic-ratelimit-unified-30d-status" }),
    );
  });

  it.each([["anthropic-ratelimit-unified-status"], ["anthropic-ratelimit-unified-overage-status"]] as const)(
    "fails closed when %s carries a value outside the known statuses",
    (field) => {
      const result = parseClaudeGauge({
        alias: "plan-one",
        headers: { ...LIVE_HEADERS, [field]: "not-a-status" },
        observedAtIso: OBSERVED,
      });
      expect(unwrapErr(result)).toStrictEqual(ClaudeRotationErrors.usageShapeChanged({ field }));
    },
  );

  it.each([["anthropic-ratelimit-unified-reset"], ["anthropic-ratelimit-unified-overage-reset"]] as const)(
    "fails closed when %s is not a plain decimal epoch",
    (field) => {
      const result = parseClaudeGauge({
        alias: "plan-one",
        headers: { ...LIVE_HEADERS, [field]: "not-an-epoch" },
        observedAtIso: OBSERVED,
      });
      expect(unwrapErr(result)).toStrictEqual(ClaudeRotationErrors.usageShapeChanged({ field }));
    },
  );

  it("fails closed on one header name sent under two casings, rather than reading only the first", () => {
    const result = parseClaudeGauge({
      alias: "plan-one",
      headers: {
        ...LIVE_HEADERS,
        "ANTHROPIC-RATELIMIT-UNIFIED-REPRESENTATIVE-CLAIM": "thirty_day",
      },
      observedAtIso: OBSERVED,
    });
    expect(unwrapErr(result)).toStrictEqual(
      ClaudeRotationErrors.usageShapeChanged({ field: "anthropic-ratelimit-unified-representative-claim" }),
    );
  });

  it("fails closed on an unknown family sending only utilization and reset, with no status", () => {
    const result = parseClaudeGauge({
      alias: "plan-one",
      headers: {
        ...LIVE_HEADERS,
        "anthropic-ratelimit-unified-30d-reset": "1794106800",
        "anthropic-ratelimit-unified-30d-utilization": "0.99",
      },
      observedAtIso: OBSERVED,
    });
    expect(unwrapErr(result).code).toBe("USAGE_SHAPE_CHANGED");
    expect(unwrapErr(result).message).toContain("anthropic-ratelimit-unified-30d-");
  });

  it.each([
    ["anthropic-ratelimit-unified-30d-surpassed-threshold"],
    ["anthropic-ratelimit-unified-7d_opus-surpassed-threshold"],
  ] as const)("fails closed on an unknown window family %s, whatever field it sends", (field) => {
    const result = parseClaudeGauge({
      alias: "plan-one",
      headers: { ...LIVE_HEADERS, [field]: "0.75" },
      observedAtIso: OBSERVED,
    });
    expect(unwrapErr(result)).toStrictEqual(ClaudeRotationErrors.usageShapeChanged({ field }));
  });

  it.each([
    ["anthropic-ratelimit-unified-7d_oi-surpassed-threshold"],
    ["anthropic-ratelimit-unified-fallback-percentage"],
  ] as const)("reads past %s, an unknown header that names no unread window", (field) => {
    const gauge = unwrap(
      parseClaudeGauge({
        alias: "plan-one",
        headers: { ...LIVE_HEADERS, [field]: "0.75" },
        observedAtIso: OBSERVED,
      }),
    );
    expect(gauge.sevenDay.utilization).toBe(0.34);
  });

  it("fails closed on a representative claim header that is sent blank", () => {
    const result = parseClaudeGauge({
      alias: "plan-one",
      headers: { ...LIVE_HEADERS, "anthropic-ratelimit-unified-representative-claim": "   " },
      observedAtIso: OBSERVED,
    });
    expect(unwrapErr(result)).toStrictEqual(
      ClaudeRotationErrors.usageShapeChanged({ field: "anthropic-ratelimit-unified-representative-claim" }),
    );
  });

  it("reads a gauge whose representative claim header is absent", () => {
    const headers = { ...LIVE_HEADERS };
    delete (headers as Record<string, string>)["anthropic-ratelimit-unified-representative-claim"];
    const gauge = unwrap(parseClaudeGauge({ alias: "plan-one", headers, observedAtIso: OBSERVED }));
    expect(gauge.representativeClaim).toBe(undefined);
    expect(gauge.sevenDay.utilization).toBe(0.34);
  });

  const missing = [
    ["anthropic-ratelimit-unified-5h-status", "anthropic-ratelimit-unified-5h-status"],
    ["anthropic-ratelimit-unified-5h-utilization", "anthropic-ratelimit-unified-5h-utilization"],
    ["anthropic-ratelimit-unified-5h-reset", "anthropic-ratelimit-unified-5h-reset"],
    ["anthropic-ratelimit-unified-7d-status", "anthropic-ratelimit-unified-7d-status"],
    ["anthropic-ratelimit-unified-7d-utilization", "anthropic-ratelimit-unified-7d-utilization"],
    ["anthropic-ratelimit-unified-7d-reset", "anthropic-ratelimit-unified-7d-reset"],
  ] as const;

  it.each(missing)("fails closed when %s alone is absent, leaving a partial trio", (drop, field) => {
    const headers = { ...LIVE_HEADERS };
    delete (headers as Record<string, string>)[drop];
    const result = parseClaudeGauge({ alias: "plan-one", headers, observedAtIso: OBSERVED });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("USAGE_SHAPE_CHANGED");
    expect(unwrapErr(result)).toStrictEqual(ClaudeRotationErrors.usageShapeChanged({ field }));
  });

  it("fails closed on a status value it does not know", () => {
    const result = parseClaudeGauge({
      alias: "plan-one",
      headers: { ...LIVE_HEADERS, "anthropic-ratelimit-unified-5h-status": "throttled" },
      observedAtIso: OBSERVED,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("USAGE_SHAPE_CHANGED");
  });

  it("fails closed on a non-numeric utilization", () => {
    const result = parseClaudeGauge({
      alias: "plan-one",
      headers: { ...LIVE_HEADERS, "anthropic-ratelimit-unified-7d-utilization": "most of it" },
      observedAtIso: OBSERVED,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toStrictEqual(
      ClaudeRotationErrors.usageShapeChanged({ field: "anthropic-ratelimit-unified-7d-utilization" }),
    );
  });

  const nonDecimal = [
    ["anthropic-ratelimit-unified-7d-utilization", "0x0"],
    ["anthropic-ratelimit-unified-7d-utilization", "1e-1"],
    ["anthropic-ratelimit-unified-7d-utilization", "-0.1"],
    ["anthropic-ratelimit-unified-7d-reset", "0x6A9E1F40"],
    ["anthropic-ratelimit-unified-7d-reset", "Infinity"],
  ] as const;

  it.each(nonDecimal)("fails closed when %s is %s, a number Number() takes but no response sends", (field, value) => {
    const result = parseClaudeGauge({
      alias: "plan-one",
      headers: { ...LIVE_HEADERS, [field]: value },
      observedAtIso: OBSERVED,
    });
    expect(unwrapErr(result)).toStrictEqual(ClaudeRotationErrors.usageShapeChanged({ field }));
  });

  it("fails closed on a blank header rather than reading it as zero", () => {
    const result = parseClaudeGauge({
      alias: "plan-one",
      headers: { ...LIVE_HEADERS, "anthropic-ratelimit-unified-5h-utilization": "   " },
      observedAtIso: OBSERVED,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toStrictEqual(
      ClaudeRotationErrors.usageShapeChanged({ field: "anthropic-ratelimit-unified-5h-utilization" }),
    );
  });
});

/**
 * The headers a REFUSED probe carries — none of the rate-limit family at all.
 *
 * MEASURED against `plan-two`'s store, whose credential had been dead for roughly 39 hours:
 * `POST /v1/messages` answered `401` with `{"type":"authentication_error"}` and zero
 * `anthropic-ratelimit-*` headers. That emptiness is why a header-only parser blames the header contract.
 */
const REFUSED_HEADERS: Readonly<Record<string, string>> = { "content-type": "application/json" };

describe("readGaugeResponse", () => {
  it("reads a 200 exactly as the header parser does, so the status check adds nothing on the happy path", () => {
    const viaStatus = readGaugeResponse({
      alias: "plan-one",
      headers: LIVE_HEADERS,
      observedAtIso: OBSERVED,
      status: 200,
    });
    expect(viaStatus.isOk()).toBe(true);
    expect(unwrap(viaStatus)).toStrictEqual(
      unwrap(parseClaudeGauge({ alias: "plan-one", headers: LIVE_HEADERS, observedAtIso: OBSERVED })),
    );
  });

  it("calls a 401 a REFUSED credential rather than an unparseable header, which is the whole defect", () => {
    const result = readGaugeResponse({
      alias: "plan-two",
      headers: REFUSED_HEADERS,
      observedAtIso: OBSERVED,
      status: 401,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toStrictEqual(
      ClaudeRotationErrors.credentialRejected({ alias: "plan-two", status: 401 }),
    );
    expect(unwrapErr(result).code).toBe("CREDENTIAL_REJECTED");
  });

  it("calls a 403 a refusal too, since both authentication answers mean the same repair", () => {
    const result = readGaugeResponse({
      alias: "plan-three",
      headers: REFUSED_HEADERS,
      observedAtIso: OBSERVED,
      status: 403,
    });
    expect(unwrapErr(result)).toStrictEqual(
      ClaudeRotationErrors.credentialRejected({ alias: "plan-three", status: 403 }),
    );
  });

  it("leaves a 429 on the shape path, because a throttled response still carries the headers", () => {
    const result = readGaugeResponse({
      alias: "plan-one",
      headers: LIVE_HEADERS,
      observedAtIso: OBSERVED,
      status: 429,
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).fiveHour!.utilization).toBe(0.34);
  });

  it("leaves a 500 on the shape path, so a provider fault never sends the owner to sign in", () => {
    const result = readGaugeResponse({
      alias: "plan-one",
      headers: REFUSED_HEADERS,
      observedAtIso: OBSERVED,
      status: 500,
    });
    expect(unwrapErr(result).code).toBe("USAGE_SHAPE_CHANGED");
  });

  it("names the alias, the status and the REPAIR in the refusal a reader is shown", () => {
    // The wording changed with the routing gate and the change is the point. It used to tell the reader to
    // touch the store with `claude doctor` and then to conclude, on a second refusal, that the store "has
    // nothing left to refresh from and needs one browser sign-in". Both halves were wrong: `doctor` run from
    // an arbitrary directory refreshes nothing (MEASURED), and a refusal after one attempt is not
    // a diagnosis of a refresh grant whose own expiry is a readable fact weeks away.
    const message = ClaudeRotationErrors.credentialRejected({ alias: "plan-two", status: 401 }).message;
    expect(message).toContain("`plan-two`");
    expect(message).toContain("HTTP 401");
    expect(message).toContain("repairs this on demand");
    expect(message).toContain("reports per store what it attempted");
    expect(message).not.toContain("claude doctor");
    expect(message).not.toContain("anthropic-ratelimit");
  });
});

/**
 * The exact headers the SPENT plan returned to a request naming a Fable model, with the
 * organisation and workspace ids dropped. It is the whole point of the Fable trio in one reading: the
 * plan-wide week refused at 100% while the Fable week was still `allowed` at 52% — the two numbers on the
 * owner's own usage screenshot, in one response.
 */
const LIVE_FABLE_HEADERS: Readonly<Record<string, string>> = {
  "anthropic-ratelimit-unified-5h-reset": "1788826200",
  "anthropic-ratelimit-unified-5h-status": "allowed",
  "anthropic-ratelimit-unified-5h-utilization": "0.0",
  "anthropic-ratelimit-unified-7d-reset": "1789250400",
  "anthropic-ratelimit-unified-7d-status": "rejected",
  "anthropic-ratelimit-unified-7d-surpassed-threshold": "1.0",
  "anthropic-ratelimit-unified-7d-utilization": "1.0",
  "anthropic-ratelimit-unified-7d_oi-reset": "1789250400",
  "anthropic-ratelimit-unified-7d_oi-status": "allowed",
  "anthropic-ratelimit-unified-7d_oi-utilization": "0.52",
  "anthropic-ratelimit-unified-representative-claim": "seven_day",
  "anthropic-ratelimit-unified-status": "rejected",
};

describe("the Fable-only seven-day window", () => {
  it("reads the 7d_oi trio a Fable probe carries, beside the plan-wide week that refused", () => {
    const gauge = unwrap(parseClaudeGauge({ alias: "plan-a", headers: LIVE_FABLE_HEADERS, observedAtIso: OBSERVED }));
    expect(gauge.sevenDay.status).toBe("rejected");
    expect(gauge.sevenDay.utilization).toBe(1);
    expect(gauge.sevenDayFable!.status).toBe("allowed");
    expect(gauge.sevenDayFable!.utilization).toBe(0.52);
    expect(gauge.sevenDayFable!.resetAtIso).toBe("2026-09-12T22:00:00.000Z");
  });

  it("is ABSENT, not a shape error, when the probe named a model that carries no Fable trio", () => {
    const gauge = unwrap(parseClaudeGauge({ alias: "plan-one", headers: LIVE_HEADERS, observedAtIso: OBSERVED }));
    expect(gauge.sevenDayFable).toBe(undefined);
  });

  it("refuses a PARTIAL trio, because that is the header contract changing rather than a missing window", () => {
    const partial = { ...LIVE_FABLE_HEADERS };
    delete (partial as Record<string, string>)["anthropic-ratelimit-unified-7d_oi-utilization"];
    const error = unwrapErr(parseClaudeGauge({ alias: "plan-a", headers: partial, observedAtIso: OBSERVED }));
    expect(error.code).toBe("USAGE_SHAPE_CHANGED");
    expect(error.message).toContain("7d_oi-utilization");
  });
});

/**
 * The exact rate-limit headers plan-five's store answered the morning Anthropic began removing
 * the five-hour limit from the Ultra plan (formerly Max 20x): NO `5h` trio at all, the `7d` and `7d_oi`
 * trios, a Fable week the provider grades `allowed_warning`, and a representative label no earlier response
 * carried. Captured with the gauge's own one-token Fable probe; only `anthropic-ratelimit-*` headers kept.
 */
const ULTRA_HEADERS: Readonly<Record<string, string>> = {
  "anthropic-ratelimit-unified-7d-reset": "1793790000",
  "anthropic-ratelimit-unified-7d-status": "allowed",
  "anthropic-ratelimit-unified-7d-utilization": "0.42",
  "anthropic-ratelimit-unified-7d_oi-reset": "1793790000",
  "anthropic-ratelimit-unified-7d_oi-status": "allowed_warning",
  "anthropic-ratelimit-unified-7d_oi-surpassed-threshold": "0.75",
  "anthropic-ratelimit-unified-7d_oi-utilization": "0.85",
  "anthropic-ratelimit-unified-fallback-percentage": "0.5",
  "anthropic-ratelimit-unified-overage-disabled-reason": "org_level_disabled",
  "anthropic-ratelimit-unified-overage-status": "rejected",
  "anthropic-ratelimit-unified-representative-claim": "seven_day_overage_included",
  "anthropic-ratelimit-unified-reset": "1793790000",
  "anthropic-ratelimit-unified-status": "allowed_warning",
  "anthropic-ratelimit-unified-upgrade-paths": "overage",
};

describe("the Ultra shape: no five-hour window", () => {
  it("reads the Ultra response with the week primary and no five-hour window", () => {
    const gauge = unwrap(parseClaudeGauge({ alias: "plan-five", headers: ULTRA_HEADERS, observedAtIso: OBSERVED }));
    expect(Object.hasOwn(gauge, "fiveHour")).toBe(false);
    expect(gauge.sevenDay).toStrictEqual({
      resetAtIso: "2026-11-04T11:00:00.000Z",
      status: "allowed",
      utilization: 0.42,
    });
    expect(gauge.sevenDayFable).toStrictEqual({
      resetAtIso: "2026-11-04T11:00:00.000Z",
      status: "allowed_warning",
      utilization: 0.85,
    });
  });

  it("recognises the seven_day_overage_included representative label", () => {
    const gauge = unwrap(parseClaudeGauge({ alias: "plan-five", headers: ULTRA_HEADERS, observedAtIso: OBSERVED }));
    expect(gauge.representativeClaim).toBe("seven_day_overage_included");
  });

  it("still reads a legacy response that carries the five-hour trio", () => {
    const gauge = unwrap(parseClaudeGauge({ alias: "plan-one", headers: LIVE_HEADERS, observedAtIso: OBSERVED }));
    expect(gauge.fiveHour).toStrictEqual({
      resetAtIso: "2026-09-03T18:10:00.000Z",
      status: "allowed",
      utilization: 0.34,
    });
  });

  const partialFiveHour = [
    ["status", "anthropic-ratelimit-unified-5h-utilization"],
    ["utilization", "anthropic-ratelimit-unified-5h-status"],
    ["reset", "anthropic-ratelimit-unified-5h-status"],
  ] as const;

  it.each(partialFiveHour)("refuses a five-hour trio carrying only its %s", (only, field) => {
    const headers = {
      ...ULTRA_HEADERS,
      [`anthropic-ratelimit-unified-5h-${only}`]: LIVE_HEADERS[`anthropic-ratelimit-unified-5h-${only}`]!,
    };
    expect(unwrapErr(parseClaudeGauge({ alias: "plan-five", headers, observedAtIso: OBSERVED }))).toStrictEqual(
      ClaudeRotationErrors.usageShapeChanged({ field }),
    );
  });

  it("refuses a blank five-hour header rather than reading it as the Ultra plan's absent trio", () => {
    const headers = { ...ULTRA_HEADERS, "anthropic-ratelimit-unified-5h-status": "  " };
    expect(unwrapErr(parseClaudeGauge({ alias: "plan-five", headers, observedAtIso: OBSERVED }))).toStrictEqual(
      ClaudeRotationErrors.usageShapeChanged({ field: "anthropic-ratelimit-unified-5h-status" }),
    );
  });

  const requiredWeek = [
    "anthropic-ratelimit-unified-7d-status",
    "anthropic-ratelimit-unified-7d-utilization",
    "anthropic-ratelimit-unified-7d-reset",
  ] as const;

  it.each(requiredWeek)("still fails closed on the Ultra shape when %s is absent", (drop) => {
    const headers = { ...ULTRA_HEADERS };
    delete (headers as Record<string, string>)[drop];
    expect(unwrapErr(parseClaudeGauge({ alias: "plan-five", headers, observedAtIso: OBSERVED }))).toStrictEqual(
      ClaudeRotationErrors.usageShapeChanged({ field: drop }),
    );
  });

  it("still fails closed on an unknown week status on the Ultra shape", () => {
    const headers = { ...ULTRA_HEADERS, "anthropic-ratelimit-unified-7d-status": "throttled" };
    expect(unwrapErr(parseClaudeGauge({ alias: "plan-five", headers, observedAtIso: OBSERVED }))).toStrictEqual(
      ClaudeRotationErrors.usageShapeChanged({ field: "anthropic-ratelimit-unified-7d-status" }),
    );
  });
});
