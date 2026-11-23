import { describe, expect, it } from "vitest";

import {
  resolveVantaCredentials,
  VANTA_CLIENT_ID_ENV,
  VANTA_CLIENT_SECRET_ENV,
} from "../../../../atlas/vanta/credentials.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("resolveVantaCredentials", () => {
  it("resolves both credentials when present and plausible", () => {
    const result = resolveVantaCredentials({
      env: { [VANTA_CLIENT_ID_ENV]: "a-client-id-value", [VANTA_CLIENT_SECRET_ENV]: "a-client-secret-value" },
    });
    expect(unwrap(result)).toEqual({ clientId: "a-client-id-value", clientSecret: "a-client-secret-value" });
  });

  it("reports both missing variables in one run", () => {
    const result = resolveVantaCredentials({ env: {} });
    expect(result.isErr()).toBe(true);
    const errors = unwrapErr(result);
    expect(errors.some((line) => line.includes(VANTA_CLIENT_ID_ENV))).toBe(true);
    expect(errors.some((line) => line.includes(VANTA_CLIENT_SECRET_ENV))).toBe(true);
  });

  it("refuses a value too short to be a real credential", () => {
    const result = resolveVantaCredentials({
      env: { [VANTA_CLIENT_ID_ENV]: "abc", [VANTA_CLIENT_SECRET_ENV]: "a-client-secret-value" },
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("plausible credential length");
  });

  it("refuses a value containing whitespace", () => {
    const result = resolveVantaCredentials({
      env: { [VANTA_CLIENT_ID_ENV]: "has a space", [VANTA_CLIENT_SECRET_ENV]: "a-client-secret-value" },
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("whitespace");
  });
});
