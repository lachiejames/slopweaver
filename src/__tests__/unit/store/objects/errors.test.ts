/**
 * The object half's typed failures: each factory's code is what a caller branches on, and its message names
 * the key or the secret a reader acts on.
 */
import { describe, expect, it } from "vitest";

import { ObjectStoreErrors } from "../../../../store/objects/errors.js";

describe("ObjectStoreErrors", () => {
  it("names the key and the hash a mismatched object carries", () => {
    const error = ObjectStoreErrors.digestMismatch({ actual: "b".repeat(64), key: "a".repeat(64) });
    expect(error.code).toBe("OBJECT_DIGEST_MISMATCH");
    expect(error.message).toBe(
      `the stored object ${"a".repeat(64)} hashes to ${"b".repeat(64)}, not to its own key — it no longer holds what was put in it`,
    );
  });

  it("prints an HTTP status only when the API answered", () => {
    expect(ObjectStoreErrors.requestFailed({ key: "k", reason: "denied", status: 403 }).message).toBe(
      "the Storage API refused k (HTTP 403): denied",
    );
    expect(ObjectStoreErrors.requestFailed({ key: "k", reason: "ECONNREFUSED", status: undefined }).message).toBe(
      "the Storage API refused k: ECONNREFUSED",
    );
  });

  it("names the container and the reason docker could not describe it", () => {
    expect(ObjectStoreErrors.stackUnreadable({ container: "c", reason: "the container is stopped" })).toEqual({
      code: "OBJECTS_STACK_UNREADABLE",
      container: "c",
      message:
        "refusing to open Supabase Storage: docker could not describe c (the container is stopped). Is the local stack running? `yarn store:start` from this checkout starts it.",
      reason: "the container is stopped",
    });
  });

  it("names SERVICE_KEY, the rename risk and supabase status as a manual check only", () => {
    const missing = ObjectStoreErrors.serviceKeyMissing({ container: "c" });
    expect(missing.code).toBe("OBJECTS_SERVICE_KEY_MISSING");
    expect(missing.container).toBe("c");
    expect(missing.variable).toBe("SERVICE_KEY");
    expect(missing.message).toBe(
      "refusing to open Supabase Storage: the running c carries no SERVICE_KEY setting. That name is the Supabase " +
        "CLI's own and undocumented, so a CLI upgrade may have renamed it; nothing here guesses another. " +
        "`yarn store:status -o env`, run from this checkout, prints the same key as SERVICE_ROLE_KEY — use it to " +
        "find the new name by hand, never as a fallback.",
    );
  });

  it("names the gateway's unpublished port and every exposed address", () => {
    expect(ObjectStoreErrors.apiPortUnpublished({ container: "g" })).toEqual({
      code: "OBJECTS_API_PORT_UNPUBLISHED",
      container: "g",
      containerPort: "8000/tcp",
      message:
        "refusing to open Supabase Storage: g publishes no host port for 8000/tcp, so there is no API to call. Is the stack started with `yarn store:start`?",
    });
    const exposed = ObjectStoreErrors.apiPortExposed({ container: "g", hostIps: ["0.0.0.0", "::"] });
    expect(exposed.code).toBe("OBJECTS_API_PORT_EXPOSED");
    expect(exposed.container).toBe("g");
    expect(exposed.hostIps).toEqual(["0.0.0.0", "::"]);
    expect(exposed.message).toContain("publishes the API on 0.0.0.0, ::, which another machine may reach");
  });

  it("names a docker context it could not read, and a remote one by scheme only", () => {
    expect(ObjectStoreErrors.dockerEndpointUnreadable({ reason: "the docker daemon is not running" })).toEqual({
      code: "OBJECTS_DOCKER_ENDPOINT_UNREADABLE",
      message:
        "refusing to open Supabase Storage: docker could not say which daemon its active context points at (the docker daemon is not running). Is Docker running?",
      reason: "the docker daemon is not running",
    });
    expect(ObjectStoreErrors.dockerNotLocal({ scheme: "tcp" })).toEqual({
      code: "OBJECTS_DOCKER_NOT_LOCAL",
      message:
        "refusing to open Supabase Storage: docker's active context reaches its daemon over tcp, not a local Unix " +
        "socket, so the containers it describes may be another machine's and so may the key. Switch back to this " +
        "machine's daemon (`docker context use` with the local context) and run it again.",
      scheme: "tcp",
    });
    expect(ObjectStoreErrors.envProxyOn({ switchedOnBy: "NODE_USE_ENV_PROXY" })).toEqual({
      code: "OBJECTS_ENV_PROXY_ON",
      message:
        "refusing to open Supabase Storage: NODE_USE_ENV_PROXY switches on Node's environment proxy and a proxy is " +
        "set, so the request carrying the service key could go to that proxy instead of straight to this " +
        "machine's gateway. Run it again without the environment proxy.",
      switchedOnBy: "NODE_USE_ENV_PROXY",
    });
  });
});
