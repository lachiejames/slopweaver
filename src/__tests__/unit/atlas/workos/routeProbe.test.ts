/**
 * The oracle — the one judgement the whole API surface map rests on.
 *
 * Each case here is a body the running server actually returned, so a WorkOS that changes how
 * it answers breaks these tests rather than quietly filling the atlas with routes that do not exist. The
 * `absent` cases are the ones worth reading twice: two of them are byte-identical for a path that EXISTS
 * under another method and one that does not exist at all, which is why `routeProbe.ts` documents that
 * limit rather than claiming a verdict it cannot support.
 */
import { describe, expect, it } from "vitest";

import {
  classifyWorkosProbe,
  oauthMissingParameters,
  validationFields,
  workosRouteIsPresent,
} from "../../../../atlas/workos/routeProbe.js";

import {
  cannotMethod,
  entityNotFound,
  foreignUnauthenticated,
  genericNotFound,
  oauthInvalidRequest,
  redirected,
  unauthorized,
  validationFailed,
} from "./workosFixtures.js";

describe("classifyWorkosProbe", () => {
  it("reads the ordinary 401 as a routed, authenticated endpoint", () => {
    expect(classifyWorkosProbe({ response: unauthorized() }).verdict).toBe("authenticated");
  });

  it("separates the Vault service's own refusal vocabulary from the REST surface's", () => {
    expect(classifyWorkosProbe({ response: foreignUnauthenticated() }).verdict).toBe(
      "authenticated-foreign-vocabulary",
    );
  });

  it("reads a 422 as routed and hands back the parameter names it echoed", () => {
    const classified = classifyWorkosProbe({ response: validationFailed() });
    expect(classified.verdict).toBe("validation-echo");
    expect(classified.declaredParams).toEqual(["client_id", "client_secret", "code", "grant_type"]);
  });

  it("reads an OAuth 400 as routed and extracts the one parameter its prose names", () => {
    const classified = classifyWorkosProbe({ response: oauthInvalidRequest() });
    expect(classified.verdict).toBe("validation-echo");
    expect(classified.declaredParams).toEqual(["client_id"]);
  });

  it("reads an entity_not_found 404 as a route that RAN, not one that is missing", () => {
    expect(classifyWorkosProbe({ response: entityNotFound() }).verdict).toBe("entity-scoped");
  });

  it("reads a redirect as a routed, browser-facing entry point", () => {
    expect(classifyWorkosProbe({ response: redirected() }).verdict).toBe("redirect");
  });

  it("reads the Cannot-METHOD 404 as absent", () => {
    const response = cannotMethod({ method: "POST", path: "/directory_users" });
    expect(classifyWorkosProbe({ response }).verdict).toBe("absent");
  });

  // The whole point of the documented one-way limit: these two bodies are identical, and one path exists.
  it("cannot tell a wrong METHOD from a wrong PATH, and calls both absent", () => {
    const existingPath = cannotMethod({ method: "POST", path: "/directory_users" });
    const inventedPath = cannotMethod({ method: "POST", path: "/zzz_nope" });
    expect(classifyWorkosProbe({ response: existingPath }).verdict).toBe("absent");
    expect(classifyWorkosProbe({ response: inventedPath }).verdict).toBe("absent");
  });

  it("reads GET's generic not-found as absent", () => {
    expect(classifyWorkosProbe({ response: genericNotFound() }).verdict).toBe("absent");
  });

  it("declares no parameters for any verdict but validation-echo", () => {
    expect(classifyWorkosProbe({ response: unauthorized() }).declaredParams).toEqual([]);
    expect(classifyWorkosProbe({ response: entityNotFound() }).declaredParams).toEqual([]);
  });

  it("records a route that answered an unclassified status rather than losing it", () => {
    expect(classifyWorkosProbe({ response: { status: 429, text: "slow down" } }).verdict).toBe("authenticated");
  });

  it("falls back to the ordinary verdict when a 401 body is not JSON at all", () => {
    expect(classifyWorkosProbe({ response: { status: 401, text: "<html>" } }).verdict).toBe("authenticated");
  });

  it("calls a 404 with no JSON body absent", () => {
    expect(classifyWorkosProbe({ response: { status: 404, text: "<html>" } }).verdict).toBe("absent");
  });

  // A 404 whose handler ran and said something of its own is evidence the route exists, and reading it as
  // absent would drop a real endpoint out of the map.
  it("reads a 404 carrying its own message as entity-scoped rather than absent", () => {
    const response = { status: 404, text: JSON.stringify({ message: "Organization not found" }) };
    expect(classifyWorkosProbe({ response }).verdict).toBe("entity-scoped");
  });
});

describe("validationFields", () => {
  it("deduplicates and sorts the field names", () => {
    const body = { errors: [{ field: "b" }, { field: "a" }, { field: "b" }] };
    expect(validationFields({ body })).toEqual(["a", "b"]);
  });

  it("answers empty for a body carrying no errors array", () => {
    expect(validationFields({ body: { message: "Validation failed" } })).toEqual([]);
  });

  it("answers empty for a null body", () => {
    expect(validationFields({ body: null })).toEqual([]);
  });

  it("skips an error entry that names no field", () => {
    expect(validationFields({ body: { errors: [{ code: "bad" }, { field: "a" }] } })).toEqual(["a"]);
  });
});

describe("oauthMissingParameters", () => {
  it("takes the name and stops at the sentence's full stop", () => {
    const body = { error_description: "Missing required parameter: client_id." };
    expect(oauthMissingParameters({ body })).toEqual(["client_id"]);
  });

  it("answers empty when the description is worded differently", () => {
    expect(oauthMissingParameters({ body: { error_description: "something else entirely" } })).toEqual([]);
  });

  it("answers empty for a body with no description", () => {
    expect(oauthMissingParameters({ body: { error: "invalid_request" } })).toEqual([]);
  });
});

describe("workosRouteIsPresent", () => {
  it("calls every verdict but absent present", () => {
    expect(workosRouteIsPresent({ verdict: "authenticated" })).toBe(true);
    expect(workosRouteIsPresent({ verdict: "authenticated-foreign-vocabulary" })).toBe(true);
    expect(workosRouteIsPresent({ verdict: "validation-echo" })).toBe(true);
    expect(workosRouteIsPresent({ verdict: "entity-scoped" })).toBe(true);
    expect(workosRouteIsPresent({ verdict: "redirect" })).toBe(true);
  });

  it("calls absent absent", () => {
    expect(workosRouteIsPresent({ verdict: "absent" })).toBe(false);
  });
});
