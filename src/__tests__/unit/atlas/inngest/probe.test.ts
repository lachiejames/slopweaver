import { describe, expect, it } from "vitest";

import { probeInngestDashboard, probeInngestV1, probeInngestV2Control } from "../../../../atlas/inngest/probe.js";
import { v1AddressFor, v1EvidenceOf } from "../../../../atlas/inngest/restAddresses.js";
import type { InngestProbeAnswer, InngestProbeTransport } from "../../../../atlas/inngest/transport.js";
import { ok, type Result, unwrap } from "../../../../lib/result.js";

/** A deterministic transport built from a table of address → answer. Not a mock: a plain function. */
function transportOf({
  answers,
  fallback,
}: {
  answers: Readonly<Record<string, InngestProbeAnswer>>;
  fallback: InngestProbeAnswer;
}): InngestProbeTransport {
  return ({ url }): Promise<Result<InngestProbeAnswer>> => {
    const path = new URL(url).pathname;
    const answer = answers[path];
    if (answer === undefined) {
      return Promise.resolve(ok(fallback));
    }
    return Promise.resolve(ok(answer));
  };
}

const NOT_FOUND: InngestProbeAnswer = { location: null, status: 404 };
const UNAUTHORIZED: InngestProbeAnswer = { location: null, status: 401 };
const SIGN_IN: InngestProbeAnswer = { location: "/sign-in?redirect_url=%2Fx", status: 307 };

describe("classifying one v1 answer", () => {
  it("tells a route that does not exist from one that wants a credential from one that rejects the method", () => {
    expect(v1EvidenceOf({ status: 404 })).toBe("absent-404");
    expect(v1EvidenceOf({ status: 401 })).toBe("exists-auth-required");
    expect(v1EvidenceOf({ status: 403 })).toBe("exists-auth-required");
    expect(v1EvidenceOf({ status: 405 })).toBe("exists-method-not-allowed");
    expect(v1EvidenceOf({ status: 200 })).toBe("exists-unauthenticated");
  });

  it("names the reviewed address serving one catalogue operation, and none for one it does not claim", () => {
    expect(v1AddressFor({ operationId: "ListEvents" })!.pathShape).toBe("/v1/events");
    expect(v1AddressFor({ operationId: "CancelRun" })!.pathShape).toBe("/v1/runs/{runID}");
    expect(v1AddressFor({ operationId: "DeleteCancellation" })).toBe(null);
  });
});

describe("probing the v1 REST surface", () => {
  it("credits an address with existence only when every invented control answered 404", async () => {
    const probed = unwrap(
      await probeInngestV1({
        probeTransport: transportOf({
          answers: { "/v1/signals": { location: null, status: 405 } },
          fallback: UNAUTHORIZED,
        }),
      }),
    );
    // The controls in this run answered 401 rather than 404, so nothing is established however a real
    // address answered.
    expect(probed.controlsDiscriminate).toBe(false);
    expect(probed.outcomes.get("v1 ListEvents")!.evidence).toBe("unprobeable-control-agrees");
  });

  it("reads the evidence off each address once the controls discriminate", async () => {
    const probed = unwrap(
      await probeInngestV1({
        probeTransport: transportOf({
          answers: {
            "/v1/cancellations": UNAUTHORIZED,
            "/v1/events": UNAUTHORIZED,
            "/v1/events/zzzsynthetic": UNAUTHORIZED,
            "/v1/events/zzzsynthetic/runs": UNAUTHORIZED,
            "/v1/runs/zzzsynthetic": UNAUTHORIZED,
            "/v1/runs/zzzsynthetic/jobs": UNAUTHORIZED,
            "/v1/signals": { location: null, status: 405 },
            "/v1/webhooks": UNAUTHORIZED,
            "/v1/webhooks/zzzsynthetic": UNAUTHORIZED,
          },
          fallback: NOT_FOUND,
        }),
      }),
    );
    expect(probed.controlsDiscriminate).toBe(true);
    expect(probed.outcomes.get("v1 ListEvents")!.evidence).toBe("exists-auth-required");
    expect(probed.outcomes.get("v1 ResumeSignal")!.evidence).toBe("exists-method-not-allowed");
    expect(probed.outcomes.get("v1 CancelRun")!.evidence).toBe("exists-auth-required");
    expect(probed.outcomes.get("v1 ListEvents")!.note).toContain("address REVIEWED rather than vendor-declared");
  });

  // The reviewed address table is a reading of the catalogue, not a vendor declaration. A wrong entry is not
  // a quiet wrong answer: it answers 404 like every control, and the sync raises `rest-route-absent`.
  it("reports a reviewed address the platform answers 404 for as absent rather than as existing", async () => {
    const probed = unwrap(await probeInngestV1({ probeTransport: transportOf({ answers: {}, fallback: NOT_FOUND }) }));
    expect(probed.controlsDiscriminate).toBe(true);
    expect(probed.outcomes.get("v1 ListEvents")!.evidence).toBe("absent-404");
  });
});

describe("probing the v2 REST surface's control", () => {
  it("reports that nothing can be established when the invented address answers what a real one does", async () => {
    const probed = unwrap(
      await probeInngestV2Control({ probeTransport: transportOf({ answers: {}, fallback: UNAUTHORIZED }) }),
    );
    expect(probed.controlAgrees).toBe(true);
    expect(probed.note).toContain("no v2 route's existence can be established");
  });

  it("reports the interesting direction — a control that has begun answering differently", async () => {
    const probed = unwrap(
      await probeInngestV2Control({
        probeTransport: transportOf({ answers: { "/v2/apps": UNAUTHORIZED }, fallback: NOT_FOUND }),
      }),
    );
    expect(probed.controlAgrees).toBe(false);
    expect(probed.note).toContain("v2 has begun discriminating");
  });
});

describe("probing the dashboard's declared routes", () => {
  const routes = [
    { parameterised: false, routePath: "/settings", section: "settings" },
    { parameterised: false, routePath: "/settings/api-keys", section: "settings" },
    { parameterised: true, routePath: "/env/$envSlug/runs/$runID", section: "env" },
  ];

  it("credits a root-level route whose own prefix discriminates, and refuses one whose prefix does not", async () => {
    const probed = unwrap(
      await probeInngestDashboard({
        environmentSlug: "production",
        probeTransport: transportOf({
          answers: { "/settings": SIGN_IN, "/settings/api-keys": SIGN_IN, "/zzzsyntheticzzz-control": NOT_FOUND },
          fallback: SIGN_IN,
        }),
        routes,
      }),
    );
    expect(probed.outcomes.get("/settings")!.evidence).toBe("exists-sign-in-redirect");
    expect(probed.outcomes.get("/settings/api-keys")!.evidence).toBe("unprobeable-control-agrees");
    expect(probed.outcomes.get("/settings/api-keys")!.note).toContain(
      "the invented control under this prefix answers the same",
    );
  });

  it("records a route carrying an identifier it will not invent as having no concrete address", async () => {
    const probed = unwrap(
      await probeInngestDashboard({
        environmentSlug: "production",
        probeTransport: transportOf({ answers: {}, fallback: NOT_FOUND }),
        routes,
      }),
    );
    expect(probed.outcomes.get("/env/$envSlug/runs/$runID")!.evidence).toBe("unprobeable-parameterised");
    expect(probed.probedUrls.get("/env/$envSlug/runs/$runID")).toBe(null);
    expect(probed.probedUrls.get("/settings")).toBe("https://app.inngest.com/settings");
  });

  it("says so when a declared route answers a server error rather than a page or a sign-in wall", async () => {
    const probed = unwrap(
      await probeInngestDashboard({
        environmentSlug: null,
        probeTransport: transportOf({
          answers: { "/settings": { location: null, status: 500 }, "/zzzsyntheticzzz-control": NOT_FOUND },
          fallback: NOT_FOUND,
        }),
        routes: [routes[0]!],
      }),
    );
    expect(probed.outcomes.get("/settings")!.evidence).toBe("probe-failed");
  });
});
