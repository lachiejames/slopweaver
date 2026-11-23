import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { SecretsErrors } from "../../../secrets/errors.js";
import { parseSecretName, SECRET_NAMES } from "../../../secrets/names.js";

describe("parseSecretName", () => {
  it("has at least one entry in SECRET_NAMES, so the guards below are not vacuously green", () => {
    expect(SECRET_NAMES.length).toBeGreaterThan(0);
  });

  it("accepts every allowlisted connector name", () => {
    for (const name of SECRET_NAMES) {
      expect(unwrap(parseSecretName({ value: name }))).toBe(name);
    }
  });

  it("trims surrounding whitespace before matching", () => {
    expect(unwrap(parseSecretName({ value: "  slack-user-token  " }))).toBe("slack-user-token");
  });

  it("rejects an unknown name with the accepted list", () => {
    const error = unwrapErr(parseSecretName({ value: "slack-token" }));

    expect(error).toEqual(SecretsErrors.secretNameUnknown({ expected: SECRET_NAMES, value: "slack-token" }));
    expect(error.message).toBe(`unknown secret name: slack-token (expected ${SECRET_NAMES.join(" | ")})`);
  });

  it("rejects a path-traversal name", () => {
    const error = unwrapErr(parseSecretName({ value: "../evil" }));

    expect(error.code).toBe("SECRET_NAME_INVALID");
    expect(error.message).toBe("invalid secret name (no path separators): ../evil");
  });

  it("rejects a name containing a slash", () => {
    const error = unwrapErr(parseSecretName({ value: "linear-token/x" }));

    expect(error.code).toBe("SECRET_NAME_INVALID");
    expect(error.message).toBe("invalid secret name (no path separators): linear-token/x");
  });
});
