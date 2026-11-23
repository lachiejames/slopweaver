import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readInngestSnapshot } from "../../../../atlas/inngest/readAdapter.js";
import { resetInngestAtlas } from "../../../../atlas/inngest/reset.js";
import { inngestAtlasPaths, readInngestKindFile, readInngestManifest } from "../../../../atlas/inngest/store.js";
import type { InngestSyncDeps } from "../../../../atlas/inngest/sync.js";
import { syncInngestAtlas } from "../../../../atlas/inngest/sync.js";
import type { InngestProbeAnswer } from "../../../../atlas/inngest/transport.js";
import { ok, type Result, unwrap } from "../../../../lib/result.js";

const AT = "2026-09-07T02:00:00.000Z";

const CATALOGUE = [
  "# Inngest API",
  "- v1",
  "  - **Events**",
  "  - [List events](/v1/events/ListEvents): Fetches recent events.",
  "  - **Webhooks**",
  "  - [Create webhook](/v1/webhooks/CreateWebhook): Create a new webhook endpoint.",
  "- v2",
  "  - **Apps**",
  "  - [Get apps](/v2/apps/GetApps): Lists active apps.",
].join("\n");

const SIGN_IN_PAGE =
  '<link rel="modulepreload" href="/assets/index-AAAA1111.js"/>' +
  '<script>window.__clerk_init_state = {"__signInFallbackRedirectUrl":"/env/production/apps"};</script>';

const BUNDLE =
  'a=x.update({id:"/settings",path:"/settings",getParentRoute:()=>root}),' +
  'b=y.update({id:"/api-keys/",path:"/api-keys/",getParentRoute:()=>a})';

const NOT_FOUND: InngestProbeAnswer = { location: null, status: 404 };
const UNAUTHORIZED: InngestProbeAnswer = { location: null, status: 401 };
const SIGN_IN: InngestProbeAnswer = { location: "/sign-in?redirect_url=%2Fx", status: 307 };

/** Deterministic transports: an address table in, a fixed answer for anything else. */
function deps({ answers }: { answers: Readonly<Record<string, InngestProbeAnswer>> }): InngestSyncDeps {
  return {
    documentTransport: ({ url }: { url: string }): Promise<Result<string>> => {
      if (url.endsWith("/llms.txt")) {
        return Promise.resolve(ok(CATALOGUE));
      }
      if (url.endsWith("/sign-in")) {
        return Promise.resolve(ok(SIGN_IN_PAGE));
      }
      return Promise.resolve(ok(BUNDLE));
    },
    probeTransport: ({ url }: { url: string }): Promise<Result<InngestProbeAnswer>> => {
      const parsed = new URL(url);
      const answer = answers[`${parsed.host}${parsed.pathname}`];
      if (answer === undefined) {
        return Promise.resolve(ok(NOT_FOUND));
      }
      return Promise.resolve(ok(answer));
    },
  };
}

const V1_DISCRIMINATING: Readonly<Record<string, InngestProbeAnswer>> = {
  "api.inngest.com/gql": { location: null, status: 422 },
  "api.inngest.com/v1/events": UNAUTHORIZED,
  "api.inngest.com/v1/webhooks": UNAUTHORIZED,
  "api.inngest.com/v2/apps": UNAUTHORIZED,
  "api.inngest.com/v2/zzzsyntheticzzz-control": UNAUTHORIZED,
  "api-docs.inngest.com/llms-full.txt": { location: null, status: 500 },
  "api-docs.inngest.com/v1/events/ListEvents.md": { location: null, status: 500 },
  "app.inngest.com/settings": SIGN_IN,
};

describe("syncing the Inngest atlas from its published surfaces", () => {
  const homes: string[] = [];
  const newHome = (): string => {
    const home = mkdtempSync(join(tmpdir(), "inngest-atlas-"));
    homes.push(home);
    return home;
  };
  afterEach(() => {
    homes.splice(0).forEach((home) => {
      rmSync(home, { force: true, recursive: true });
    });
  });

  it("publishes a readable generation carrying both compiled surfaces", async () => {
    const home = newHome();
    const outcome = unwrap(await syncInngestAtlas({ at: AT, deps: deps({ answers: V1_DISCRIMINATING }), home }));
    expect(outcome.operationCount).toBe(3);
    expect(outcome.pageCount).toBe(2);
    const snapshot = unwrap(readInngestSnapshot({ home }));
    expect(snapshot.kinds.find((kind) => kind.kind === "operation")!.publishedCount).toBe(3);
    expect(snapshot.kinds.find((kind) => kind.kind === "page")!.publishedCount).toBe(2);
    expect(snapshot.descriptor.surfaces.find((surface) => surface.name === "published-catalogue")!.status).toBe(
      "filled",
    );
  });

  // The whole point of the atlas: `rest-api`, `graphql` and `dashboard` have not been filled by this sync,
  // and each SAYS so rather than being silently absent.
  it("leaves the three surfaces no sync can fill declared and unfilled", async () => {
    const home = newHome();
    await syncInngestAtlas({ at: AT, deps: deps({ answers: V1_DISCRIMINATING }), home });
    const snapshot = unwrap(readInngestSnapshot({ home }));
    const unfilled = snapshot.descriptor.surfaces.filter((surface) => surface.status === "declared-unfilled");
    expect(unfilled.map((surface) => surface.name).toSorted()).toEqual(["dashboard", "graphql", "rest-api"]);
    expect(unfilled.find((surface) => surface.name === "rest-api")!.unfilledBecause).toContain(
      "no Inngest signing key",
    );
  });

  it("records a v1 address as existing and every v2 operation as unprobeable, keyed by version", async () => {
    const home = newHome();
    await syncInngestAtlas({ at: AT, deps: deps({ answers: V1_DISCRIMINATING }), home });
    const file = unwrap(readInngestKindFile({ kind: "operation", paths: inngestAtlasPaths({ home }) }))!;
    const detailOf = ({ providerId }: { providerId: string }): Record<string, unknown> =>
      file.entities.find((entity) => entity.providerId === providerId)!.channels.compiled!.detail as Record<
        string,
        unknown
      >;
    expect(detailOf({ providerId: "v1 ListEvents" })["probeEvidence"]).toBe("exists-auth-required");
    expect(detailOf({ providerId: "v1 CreateWebhook" })["probeEvidence"]).toBe("exists-auth-required");
    expect(detailOf({ providerId: "v1 CreateWebhook" })["disposition"]).toBe("excluded");
    expect(detailOf({ providerId: "v2 GetApps" })["probeEvidence"]).toBe("unprobeable-control-agrees");
  });

  it("opens the vendor-document gap when the reference's own markdown mirror answers a server error", async () => {
    const home = newHome();
    await syncInngestAtlas({ at: AT, deps: deps({ answers: V1_DISCRIMINATING }), home });
    const file = unwrap(readInngestKindFile({ kind: "operation", paths: inngestAtlasPaths({ home }) }))!;
    const gap = file.gaps.find((row) => row.condition === "vendor-document-errors")!;
    expect(gap.status).toBe("open");
    expect(gap.reason).toContain("HTTP 500");
  });

  it("writes every entity kind's honest not-configured state rather than leaving its file absent", async () => {
    const home = newHome();
    await syncInngestAtlas({ at: AT, deps: deps({ answers: V1_DISCRIMINATING }), home });
    const file = unwrap(readInngestKindFile({ kind: "app", paths: inngestAtlasPaths({ home }) }))!;
    expect(file.entities).toEqual([]);
    expect(file.coverage.map((cell) => cell.state).toSorted()).toEqual(["not-configured", "unreadable"]);
    expect(file.gaps.filter((gap) => gap.condition === "api-credential-absent").length).toBe(1);
    const snapshot = unwrap(readInngestSnapshot({ home }));
    expect(snapshot.generation.unpublished).toEqual([]);
  });

  it("records a kind it never reads as a FAILED attempt over its kept success, so a later sync publishes", async () => {
    // On the installed generation the GraphQL kind carried a walk's earlier success while every sync stamped
    // it `ok` at its own instant, and the manifest-clock guard refused each one: "carries two clocks".
    const home = newHome();
    await syncInngestAtlas({ at: AT, deps: deps({ answers: V1_DISCRIMINATING }), home });
    const LATER = "2026-09-16T13:16:33.320Z";
    unwrap(await syncInngestAtlas({ at: LATER, deps: deps({ answers: V1_DISCRIMINATING }), home }));
    const manifest = unwrap(readInngestManifest({ paths: inngestAtlasPaths({ home }) }))!;
    const graphql = manifest.kinds["graphql-operation"];
    expect(graphql.lastAttempt).toEqual({
      at: LATER,
      outcome: "failed",
      reasons: ["a sync compiles published documents and reads no graphql-operation"],
    });
    expect(graphql.lastSuccessAt).toBe(null);
    expect(graphql.permissionBlocked).toBe(undefined);
    expect(manifest.kinds.app.permissionBlocked).toEqual({
      at: LATER,
      detail: "no Inngest signing key is configured on this installation, so no app of this account has been read",
      unblockedBy: manifest.kinds.function.permissionBlocked!.unblockedBy,
    });
    expect(manifest.kinds.operation.lastSuccessAt).toBe(LATER);
    expect(manifest.updatedAt).toBe(LATER);
    expect(unwrap(readInngestSnapshot({ home })).generation.unpublished).toEqual([]);
  });

  it("merges a second run onto the first rather than replacing it, keeping the first sighting", async () => {
    const home = newHome();
    await syncInngestAtlas({ at: AT, deps: deps({ answers: V1_DISCRIMINATING }), home });
    const later = "2026-09-08T02:00:00.000Z";
    await syncInngestAtlas({ at: later, deps: deps({ answers: V1_DISCRIMINATING }), home });
    const file = unwrap(readInngestKindFile({ kind: "operation", paths: inngestAtlasPaths({ home }) }))!;
    const channel = file.entities.find((entity) => entity.providerId === "v1 ListEvents")!.channels.compiled!;
    expect(channel.firstSeenAt).toBe(AT);
    expect(channel.lastSeenAt).toBe(later);
  });

  it("refuses to read a home nothing has ever been published under", () => {
    const read = readInngestSnapshot({ home: newHome() });
    expect(read.isErr()).toBe(true);
    expect(read._unsafeUnwrapErr().message).toContain("slopweaver atlas inngest sync");
  });

  it("archives a generation on reset and installs a complete empty one", async () => {
    const home = newHome();
    await syncInngestAtlas({ at: AT, deps: deps({ answers: V1_DISCRIMINATING }), home });
    const reset = unwrap(resetInngestAtlas({ at: "2026-09-09T02:00:00.000Z", paths: inngestAtlasPaths({ home }) }));
    expect(reset.archivedTo).toContain("_superseded");
    const file = unwrap(readInngestKindFile({ kind: "operation", paths: inngestAtlasPaths({ home }) }))!;
    expect(file.entities).toEqual([]);
  });
});
