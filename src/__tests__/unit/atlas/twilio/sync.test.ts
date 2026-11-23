import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { TwilioSpecErrors } from "../../../../atlas/twilio/errors.js";
import { TWILIO_SPEC_PINS } from "../../../../atlas/twilio/generated/specLock.js";
import { foldTwilioChannel } from "../../../../atlas/twilio/merge.js";
import type { TwilioSpecTransport } from "../../../../atlas/twilio/specFetch.js";
import type { TwilioSpecPin } from "../../../../atlas/twilio/specPin.js";
import { readTwilioAtlas, twilioAtlasPaths } from "../../../../atlas/twilio/store.js";
import { compileTwilioCatalogue, syncTwilioSpecSurface } from "../../../../atlas/twilio/sync.js";
import type { TwilioWalkResult } from "../../../../atlas/twilio/walk.js";
import { publishTwilioWalk } from "../../../../atlas/twilio/walkPublish.js";
import { err, ok, unwrap } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";

/** Every scratch home this file mints, removed on the way out. */
const homes: string[] = [];

/** A throwaway state home, so nothing here writes to the ambient one. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-twilio-sync-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** The document every fake transport below serves, unless a test says otherwise. */
const document = JSON.stringify({
  info: { title: "Twilio - Test" },
  paths: {
    "/v1/Services": {
      get: {
        responses: {
          "200": { content: { "application/json": { schema: { properties: { sid: {} }, type: "object" } } } },
        },
      },
    },
  },
  servers: [{ url: "https://test.twilio.com" }],
});

/** A transport that answers every pin with the same document. Typed as the seam it stands in for. */
const servesDocument: TwilioSpecTransport = async () => ok(document);

describe("compiling the pinned catalogue", () => {
  // One failure must not sink the batch: a sync that refused everything on one timeout would leave an
  // install with no atlas rather than with a slightly incomplete one.
  it("keeps every document it could read when one of them fails", async () => {
    const failing: TwilioSpecPin = { ...TWILIO_SPEC_PINS[0]!, id: "twilio_broken_v1" };
    const catalogue = await compileTwilioCatalogue({
      pins: [TWILIO_SPEC_PINS[0]!, failing],
      transport: async ({ pin }) =>
        pin.id === "twilio_broken_v1"
          ? err(TwilioSpecErrors.unreachable({ cause: new Error("HTTP 503"), specId: pin.id }))
          : ok(document),
    });

    expect(catalogue.surfaces.length).toBe(1);
    expect(catalogue.failures.length).toBe(1);
    expect(catalogue.failures[0]!.specId).toBe("twilio_broken_v1");
  });

  it("records a document whose bytes moved rather than refusing it", async () => {
    const catalogue = await compileTwilioCatalogue({ pins: [TWILIO_SPEC_PINS[0]!], transport: servesDocument });

    expect(catalogue.surfaces.length).toBe(1);
    expect(catalogue.drifts.length).toBe(1);
    expect(catalogue.drifts[0]!.specId).toBe(TWILIO_SPEC_PINS[0]!.id);
  });
});

describe("publishing the Twilio definition surface", () => {
  it("publishes an api and a method row per compiled operation", async () => {
    const paths = twilioAtlasPaths({ home: scratchHome() });

    const outcome = unwrap(await syncTwilioSpecSurface({ at: AT, paths, transport: servesDocument }));

    expect(outcome.specsDeclared).toBe(TWILIO_SPEC_PINS.length);
    expect(outcome.specsCompiled).toBe(TWILIO_SPEC_PINS.length);
    expect(outcome.methodCount).toBe(1);
    expect(outcome.apiCount).toBe(TWILIO_SPEC_PINS.length);
  });

  // A kind with no file reads as a kind that does not exist, where a `not-configured` cell is the atlas
  // saying, about itself, that it is supposed to hold this and does not.
  it("gives the two credentialled kinds a not-configured cell naming what would fill them", async () => {
    const paths = twilioAtlasPaths({ home: scratchHome() });
    unwrap(await syncTwilioSpecSurface({ at: AT, paths, transport: servesDocument }));

    const snapshot = unwrap(readTwilioAtlas({ paths }));
    for (const kind of ["account", "resource"] as const) {
      const cell = snapshot.files[kind]!.coverage.find((held) => held.surface === "account-api")!;
      expect(cell.state).toBe("not-configured");
      expect(cell.unblockedBy).toContain("slopweaver secrets set twilio-account-sid");
    }
  });

  it("gives the page kind a deferred cell rather than a silence", async () => {
    const paths = twilioAtlasPaths({ home: scratchHome() });
    unwrap(await syncTwilioSpecSurface({ at: AT, paths, transport: servesDocument }));

    const cell = unwrap(readTwilioAtlas({ paths })).files.page!.coverage.find((held) => held.surface === "console")!;
    expect(cell.state).toBe("deferred");
    expect(cell.unblockedBy).toContain("sign in to console.twilio.com");
  });

  it("raises one gap per credentialled kind, naming the credential", async () => {
    const paths = twilioAtlasPaths({ home: scratchHome() });
    unwrap(await syncTwilioSpecSurface({ at: AT, paths, transport: servesDocument }));

    const snapshot = unwrap(readTwilioAtlas({ paths }));
    expect(snapshot.files.account!.gaps.map((gap) => gap.condition)).toEqual(["entity-surface-not-configured"]);
    expect(snapshot.files.resource!.gaps.map((gap) => gap.condition)).toEqual(["entity-surface-not-configured"]);
  });

  it("raises a gap per moved document, on every compiled kind", async () => {
    const paths = twilioAtlasPaths({ home: scratchHome() });
    unwrap(await syncTwilioSpecSurface({ at: AT, paths, transport: servesDocument }));

    const snapshot = unwrap(readTwilioAtlas({ paths }));
    expect(snapshot.files.method!.gaps.filter((gap) => gap.condition === "spec-moved").length).toBe(
      TWILIO_SPEC_PINS.length,
    );
  });

  // A `synced` cell states the fraction, so a reader never has to infer completeness from an entity total.
  it("states the compile as a fraction and calls a short one deferred", async () => {
    const paths = twilioAtlasPaths({ home: scratchHome() });
    unwrap(
      await syncTwilioSpecSurface({
        at: AT,
        paths,
        transport: async ({ pin }) =>
          pin.id === TWILIO_SPEC_PINS[0]!.id
            ? err(TwilioSpecErrors.unreachable({ cause: new Error("HTTP 503"), specId: pin.id }))
            : ok(document),
      }),
    );

    const cell = unwrap(readTwilioAtlas({ paths })).files.method!.coverage.find(
      (held) => held.surface === "spec-declared",
    )!;
    expect(cell.state).toBe("deferred");
    expect(cell.reason).toContain(`${String(TWILIO_SPEC_PINS.length - 1)} of ${String(TWILIO_SPEC_PINS.length)}`);
  });

  // `store.ts`'s grading reads an attempt with no success as "not yet synced" rather than as corruption.
  it("stamps every kind it wrote, so none reads as unpublished on a clean first sync", async () => {
    const paths = twilioAtlasPaths({ home: scratchHome() });
    unwrap(await syncTwilioSpecSurface({ at: AT, paths, transport: servesDocument }));

    const snapshot = unwrap(readTwilioAtlas({ paths }));
    expect(snapshot.unpublished).toEqual([]);
    expect(snapshot.mismatched).toEqual([]);
    expect(snapshot.manifest!.kinds.page.lastSuccessAt).toBe(null);
    expect(snapshot.manifest!.kinds.method.lastSuccessAt).toBe(AT);
  });

  it("keeps the date an operation was first seen when a later sync sees it again", async () => {
    const paths = twilioAtlasPaths({ home: scratchHome() });
    const later = "2026-09-06T00:00:00.000Z";
    unwrap(await syncTwilioSpecSurface({ at: AT, paths, transport: servesDocument }));
    unwrap(await syncTwilioSpecSurface({ at: later, paths, transport: servesDocument }));

    const method = unwrap(readTwilioAtlas({ paths })).files.method!.entities[0]!;
    expect(method.channels.api!.firstSeenAt).toBe(AT);
    expect(method.channels.api!.lastSeenAt).toBe(later);
  });

  it("keeps the browser channel a walk stored when a later sync refreshes only the api channel", async () => {
    const paths = twilioAtlasPaths({ home: scratchHome() });
    unwrap(await syncTwilioSpecSurface({ at: AT, paths, transport: servesDocument }));
    const synced = unwrap(readTwilioAtlas({ paths })).files.method!.entities[0]!;
    const walked = { ...synced.channels.api!, firstSeenAt: "2026-09-01T00:00:00.000Z" };
    const stored = { ...synced, channels: { ...synced.channels, browser: walked } };

    const folded = foldTwilioChannel({ channel: "api", observed: synced, stored });

    expect(synced.channels.browser).toBe(null);
    expect(folded.channels.browser).toEqual(walked);
  });

  it("publishes a signed-out walk run after the spec compile, keeping the method clock on the spec leg", async () => {
    const paths = twilioAtlasPaths({ home: scratchHome() });
    const later = "2026-09-06T00:00:00.000Z";
    unwrap(await syncTwilioSpecSurface({ at: AT, paths, transport: servesDocument }));
    const signedOut: TwilioWalkResult = {
      artifactsWritten: 0,
      calls: [],
      incompletePages: [],
      notAttempted: [],
      pages: [
        {
          artifacts: [],
          discoveredFrom: null,
          finalUrl: "https://www.twilio.com/login",
          linksRendered: [],
          outcome: "signed-out",
          responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
          route: "/{region}/develop/sms/services",
          statusCode: 200,
          title: "Log in",
        },
      ],
      region: "us1",
      roundsRun: 1,
      sessionEndedAt: null,
      signedOut: true,
    };

    const outcome = publishTwilioWalk({ at: later, paths, walk: signedOut });
    const snapshot = unwrap(readTwilioAtlas({ paths }));

    expect(outcome.isOk()).toBe(true);
    expect(snapshot.files.method!.updatedAt).toBe(AT);
    expect(snapshot.manifest!.kinds.method.lastSuccessAt).toBe(AT);
    expect(snapshot.manifest!.kinds.method.lastAttempt!.at).toBe(later);
  });

  // A walk's success must outlive a later sync: the sync stamps an attempt on the page kind, never erases it.
  it("carries the page kind's walked success and count forward through a later sync", async () => {
    const paths = twilioAtlasPaths({ home: scratchHome() });
    const walkedAt = "2026-09-06T00:00:00.000Z";
    const resyncedAt = "2026-09-07T00:00:00.000Z";
    unwrap(await syncTwilioSpecSurface({ at: AT, paths, transport: servesDocument }));
    const landed: TwilioWalkResult = {
      artifactsWritten: 0,
      calls: [],
      incompletePages: [],
      notAttempted: [],
      pages: [
        {
          artifacts: [],
          discoveredFrom: null,
          finalUrl: "https://console.twilio.com/us1/develop/sms/services",
          linksRendered: [],
          outcome: "landed",
          responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
          route: "/{region}/develop/sms/services",
          statusCode: 200,
          title: "Messaging Services",
        },
      ],
      region: "us1",
      roundsRun: 1,
      sessionEndedAt: null,
      signedOut: false,
    };
    unwrap(publishTwilioWalk({ at: walkedAt, paths, walk: landed }));

    unwrap(await syncTwilioSpecSurface({ at: resyncedAt, paths, transport: servesDocument }));
    const page = unwrap(readTwilioAtlas({ paths })).manifest!.kinds.page;

    expect(page.lastSuccessAt).toBe(walkedAt);
    expect(page.entityCount).toBe(1);
    expect(page.lastAttempt!.at).toBe(resyncedAt);
  });
});
