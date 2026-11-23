import { describe, expect, it } from "vitest";

import {
  DATADOG_SDK_PIN,
  DATADOG_SPEC_PARITY,
  DATADOG_SPEC_PINS,
} from "../../../../atlas/datadog/generated/sdkLock.js";

describe("DATADOG_SDK_PIN", () => {
  it("adds up: the per-method census equals the total the generator asserts against", () => {
    const sum =
      DATADOG_SDK_PIN.census.DELETE +
      DATADOG_SDK_PIN.census.GET +
      DATADOG_SDK_PIN.census.PATCH +
      DATADOG_SDK_PIN.census.POST +
      DATADOG_SDK_PIN.census.PUT;

    expect(sum).toBe(DATADOG_SDK_PIN.census.total);
  });

  it("pins the version this repository actually resolves, so the digest is checkable offline", () => {
    expect(DATADOG_SDK_PIN.version).toBe("1.62.0");
  });

  it("pins a full-length digest per package, never a prefix", () => {
    for (const pin of [DATADOG_SDK_PIN.packages.v1, DATADOG_SDK_PIN.packages.v2]) {
      expect(pin.sha256.length).toBe(64);
      expect(pin.apiModules).toBeGreaterThan(0);
    }
  });
});

describe("DATADOG_SPEC_PINS", () => {
  // An immutable tag URL rather than `latest`: a table regenerated from whatever the vendor served this
  // morning is a table nobody reviewed.
  it("points at the client's own release tag rather than a moving reference", () => {
    for (const pin of [DATADOG_SPEC_PINS.v1, DATADOG_SPEC_PINS.v2]) {
      expect(pin.url).toContain(`/v${DATADOG_SDK_PIN.version}/`);
      expect(pin.sha256.length).toBe(64);
      expect(pin.byteLength).toBeGreaterThan(0);
    }
  });
});

describe("DATADOG_SPEC_PARITY", () => {
  // The measurement the whole authority decision rests on. If either of these ever moves, the two pinned
  // artifacts have stopped agreeing, which is a real finding about Datadog's surface — and the generator
  // stops rather than absorbing it.
  it("records a ZERO diff, which is why the specification is not treated as a rival authority", () => {
    expect(DATADOG_SPEC_PARITY.specOnly).toBe(0);
    expect(DATADOG_SPEC_PARITY.sdkOnly).toBe(0);
    expect(DATADOG_SPEC_PARITY.matching).toBe(DATADOG_SDK_PIN.census.total);
  });

  it("records the one annotation the compiled client does not carry", () => {
    expect(DATADOG_SPEC_PARITY.deprecated).toBe(85);
  });
});
