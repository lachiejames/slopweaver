/**
 * `SecretsErrors` — the typed failures `src/secrets` authors, each naming a secret or a grant file and never
 * a value.
 */
import { describe, expect, it } from "vitest";

import { SecretsErrors } from "../../../secrets/errors.js";

describe("SecretsErrors", () => {
  it("names the act, the door and the path when a grant file operation fails", () => {
    const error = SecretsErrors.grantFileFailed({
      action: "delete",
      cause: new Error("EACCES: permission denied"),
      path: "/home/secrets/drive-oauth.json",
      productName: "Google Drive",
    });

    expect(error.code).toBe("GRANT_FILE_FAILED");
    expect(error.message).toBe(
      "could not delete the Google Drive grant at /home/secrets/drive-oauth.json: EACCES: permission denied",
    );
  });

  it("tells the operator which verb re-establishes a grant whose shape is wrong", () => {
    const error = SecretsErrors.grantShapeInvalid({ connectVerb: "slopweaver gmail connect", productName: "Gmail" });

    expect(error).toEqual({
      code: "GRANT_SHAPE_INVALID",
      connectVerb: "slopweaver gmail connect",
      message:
        "the stored Gmail grant is missing account, scopes or refreshToken, or holds a field of the wrong shape — re-run `slopweaver gmail connect`",
      productName: "Gmail",
    });
  });

  it("names the store path and the cause when the store cannot be listed", () => {
    const error = SecretsErrors.storeUnreadable({
      cause: new Error("EACCES: permission denied"),
      path: "/home/secrets",
    });

    expect(error.code).toBe("SECRETS_STORE_UNREADABLE");
    expect(error.message).toBe("could not list the secrets store at /home/secrets: EACCES: permission denied");
  });

  it("names the secret and the cause when a write does not land", () => {
    const error = SecretsErrors.secretWriteFailed({ cause: new Error("ENOSPC"), name: "linear-token" });

    expect(error.code).toBe("SECRET_WRITE_FAILED");
    expect(error.message).toBe("could not write secret linear-token: ENOSPC");
  });

  it("stringifies a cause that is not an Error when a write does not land", () => {
    const error = SecretsErrors.secretWriteFailed({ cause: "disk gone", name: "linear-token" });

    expect(error.message).toBe("could not write secret linear-token: disk gone");
  });
});
