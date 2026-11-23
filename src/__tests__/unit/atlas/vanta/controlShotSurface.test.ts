import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AtlasArtifactRef } from "../../../../atlas/kit/contract.js";
import { vantaControlSurface } from "../../../../atlas/vanta/browserPages.js";
import type { VantaBrowserWalkResult, VantaPageObservation } from "../../../../atlas/vanta/browserWalk.js";
import type { ResolvedVantaControl } from "../../../../atlas/vanta/controlShot.js";
import { publishVantaControlShot } from "../../../../atlas/vanta/controlShotSurface.js";
import { vantaEntityId } from "../../../../atlas/vanta/identity.js";
import {
  emptyVantaKindFile,
  initialVantaManifest,
  VANTA_KINDS,
  type VantaEntity,
  type VantaKindFile,
} from "../../../../atlas/vanta/model.js";
import {
  publishVantaAtlas,
  readVantaAtlas,
  type VantaAtlasPaths,
  vantaAtlasPaths,
  vantaPageArtifactPath,
} from "../../../../atlas/vanta/store.js";
import { unwrap } from "../../../../lib/result.js";
import { renderedPng } from "../../../pngFixture.js";
import { cloneHome } from "../homeTemplate.js";

const AT = "2026-09-07T10:00:00.000Z";
const SYNCED_AT = "2026-09-01T00:00:00.000Z";

const CONTROL: ResolvedVantaControl = {
  asked: "DCH-108",
  externalId: "DCH-108",
  name: "Data classified",
  providerId: "0syn0001",
};

/** A control as the Manage API sync left it: full detail, and no per-control URL anywhere. */
const syncedControl = ({ providerId }: { providerId: string }): VantaEntity => ({
  channels: {
    browser: null,
    "manage-api": {
      channel: "manage-api",
      detail: { description: "the company classifies its data", externalId: "DCH-108" },
      firstSeenAt: SYNCED_AT,
      lastSeenAt: SYNCED_AT,
      source: {
        artifacts: [],
        channel: "manage-api",
        deepLink: null,
        deepLinkStatus: "unavailable",
        endpoint: "/controls",
        observedAt: SYNCED_AT,
      },
      state: "observed",
    },
  },
  financialDetail: null,
  // Computed rather than written out, so the merge is exercised on identity rather than on a literal that
  // silently stops matching and turns a merge into a second row nobody notices.
  id: vantaEntityId({ components: { providerId }, kind: "control" }),
  kind: "control",
  providerId,
  sensitivity: null,
});

describe("publishVantaControlShot", () => {
  let home: string;
  let paths: VantaAtlasPaths;

  /** Write one picture into the atlas directory and return the reference addressing it. */
  const storeShot = ({ seed }: { seed: number }): AtlasArtifactRef => {
    const bytes = renderedPng({ seed });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const relativePath = vantaPageArtifactPath({ sha256 });
    const absolute = join(paths.directory, relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, bytes);
    return { byteLength: bytes.byteLength, kind: "page-png", mediaType: "image/png", relativePath, sha256 };
  };

  const observation = ({
    providerId,
    artifacts,
    screenshotMissingBecause = null,
  }: {
    providerId: string;
    artifacts: readonly AtlasArtifactRef[];
    screenshotMissingBecause?: string | null;
  }): VantaPageObservation => ({
    artifacts,
    attempted: true,
    calls: [],
    captureComplete: true,
    finalUrl: `https://app.vanta.com/c/acme/controls?controlId=${providerId}`,
    observedAt: AT,
    redirected: false,
    requestedUrl: `https://app.vanta.com/c/acme/controls?controlId=${providerId}`,
    responseAccounting: { bodyFailed: 0, bodySucceeded: 4, eligible: 4, seen: 300 },
    screenshotMissingBecause,
    statusCode: 200,
    surface: vantaControlSurface({ providerId }),
    title: "Controls - Vanta",
    unreachableBecause: null,
  });

  const walkOf = ({ pages }: { pages: readonly VantaPageObservation[] }): VantaBrowserWalkResult => ({
    pages,
    rootFound: true,
    sessionLost: false,
  });

  // Every case starts from the same synced generation, published once into a template and copied per case
  // (`homeTemplate.ts` says why, and what it measured).
  let template: string;
  beforeAll(() => {
    template = mkdtempSync(join(tmpdir(), "vanta-control-shot-template-"));
    const files: Record<string, VantaKindFile> = Object.fromEntries(
      VANTA_KINDS.map((kind) => [kind, emptyVantaKindFile({ kind, updatedAt: SYNCED_AT })]),
    );
    files["control"] = {
      ...files["control"]!,
      entities: [syncedControl({ providerId: "0syn0001" })],
    };
    unwrap(
      publishVantaAtlas({
        derivedFrom: null,
        files,
        manifest: initialVantaManifest({ updatedAt: SYNCED_AT }),
        paths: vantaAtlasPaths({ home: template }),
      }),
    );
  });
  afterAll(() => {
    rmSync(template, { force: true, recursive: true });
  });
  beforeEach(() => {
    home = cloneHome({ prefix: "vanta-control-shot-", template });
    paths = vantaAtlasPaths({ home });
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("gives the control a browser-discovered deep link and a picture, where it had neither", () => {
    const before = unwrap(readVantaAtlas({ paths })).files.control!.entities[0]!;
    expect(before.channels["manage-api"]!.source!.deepLinkStatus).toBe("unavailable");

    const outcome = unwrap(
      publishVantaControlShot({
        at: AT,
        controls: [CONTROL],
        paths,
        walk: walkOf({ pages: [observation({ artifacts: [storeShot({ seed: 3 })], providerId: "0syn0001" })] }),
      }),
    );
    expect(outcome.heldCount).toBe(1);
    expect(outcome.askedCount).toBe(1);

    const controls = unwrap(readVantaAtlas({ paths })).files.control!.entities;
    expect(controls.length).toBe(1);
    const control = controls[0]!;
    expect(control.channels.browser!.source!.deepLink).toBe("https://app.vanta.com/c/acme/controls?controlId=0syn0001");
    expect(control.channels.browser!.source!.deepLinkStatus).toBe("browser-discovered");
    expect(control.channels.browser!.source!.artifacts.length).toBe(1);
  });

  it("leaves the control's Manage API channel exactly where the sync left it", () => {
    unwrap(
      publishVantaControlShot({
        at: AT,
        controls: [CONTROL],
        paths,
        walk: walkOf({ pages: [observation({ artifacts: [storeShot({ seed: 3 })], providerId: "0syn0001" })] }),
      }),
    );
    const control = unwrap(readVantaAtlas({ paths })).files.control!.entities[0]!;
    expect(JSON.stringify(control.channels["manage-api"]!.detail)).toBe(
      '{"description":"the company classifies its data","externalId":"DCH-108"}',
    );
    expect(control.channels["manage-api"]!.state).toBe("observed");
    expect(control.channels["manage-api"]!.lastSeenAt).toBe(SYNCED_AT);
  });

  it("does not advance the control kind's manifest timestamps, so a stale sync cannot read as fresh", () => {
    const before = unwrap(readVantaAtlas({ paths })).manifest!.kinds.control;
    unwrap(
      publishVantaControlShot({
        at: AT,
        controls: [CONTROL],
        paths,
        walk: walkOf({ pages: [observation({ artifacts: [storeShot({ seed: 3 })], providerId: "0syn0001" })] }),
      }),
    );
    const after = unwrap(readVantaAtlas({ paths })).manifest!.kinds.control;
    expect(after.lastSuccessAt).toBe(before.lastSuccessAt);
    expect(after.entityCount).toBe(1);
  });

  it("writes the control's page as a browser-page row without touching the declared walk's coverage cell", () => {
    unwrap(
      publishVantaControlShot({
        at: AT,
        controls: [CONTROL],
        paths,
        walk: walkOf({ pages: [observation({ artifacts: [storeShot({ seed: 3 })], providerId: "0syn0001" })] }),
      }),
    );
    const file = unwrap(readVantaAtlas({ paths })).files["browser-page"]!;
    expect(file.entities.map((entity) => entity.providerId)).toEqual(["control:0syn0001"]);
    expect(file.coverage.map((cell) => cell.surface)).toEqual(["control-shot"]);
    expect(file.coverage[0]!.state).toBe("synced");
    expect(file.coverage[0]!.scope).toBe("controls 0syn0001");
  });

  it("grades a shot whose page carried no picture deferred, and names the control in a gap", () => {
    const outcome = unwrap(
      publishVantaControlShot({
        at: AT,
        controls: [CONTROL],
        paths,
        walk: walkOf({
          pages: [
            observation({
              artifacts: [],
              providerId: "0syn0001",
              screenshotMissingBecause: "the page was reached but the browser returned no screenshot for it",
            }),
          ],
        }),
      }),
    );
    expect(outcome.heldCount).toBe(0);
    expect(outcome.unheld).toEqual([
      { because: "the page was reached but the browser returned no screenshot for it", providerId: "0syn0001" },
    ]);
    const file = unwrap(readVantaAtlas({ paths })).files["browser-page"]!;
    expect(file.coverage[0]!.state).toBe("deferred");
    expect(file.gaps.map((gap) => gap.scope)).toEqual(["control:0syn0001"]);
    // The control learnt nothing about its own URL, so it must not have gained one.
    expect(unwrap(readVantaAtlas({ paths })).files.control!.entities[0]!.channels.browser).toBe(null);
  });

  it("withdraws a screenshot claim whose bytes are not on disk, rather than trusting the reference", () => {
    const invented: AtlasArtifactRef = {
      byteLength: 95_000,
      kind: "page-png",
      mediaType: "image/png",
      relativePath: vantaPageArtifactPath({ sha256: "0".repeat(64) }),
      sha256: "0".repeat(64),
    };
    const outcome = unwrap(
      publishVantaControlShot({
        at: AT,
        controls: [CONTROL],
        paths,
        walk: walkOf({ pages: [observation({ artifacts: [invented], providerId: "0syn0001" })] }),
      }),
    );
    expect(outcome.heldCount).toBe(0);
    expect(outcome.unheld[0]!.because).toContain("no longer hash to the digest they are addressed by");
  });

  it("leaves a control it never asked for untouched rather than staling it", () => {
    const current = unwrap(readVantaAtlas({ paths }));
    const stored = current.files.control!;
    unwrap(
      publishVantaAtlas({
        derivedFrom: current.manifest,
        files: {
          control: {
            ...stored,
            entities: [...stored.entities, syncedControl({ providerId: "0syn0002" })],
          },
        },
        manifest: current.manifest!,
        paths,
      }),
    );
    unwrap(
      publishVantaControlShot({
        at: AT,
        controls: [CONTROL],
        paths,
        walk: walkOf({ pages: [observation({ artifacts: [storeShot({ seed: 3 })], providerId: "0syn0001" })] }),
      }),
    );
    const other = unwrap(readVantaAtlas({ paths })).files.control!.entities.find(
      (entity) => entity.providerId === "0syn0002",
    )!;
    expect(other.channels["manage-api"]!.state).toBe("observed");
    expect(other.channels.browser).toBe(null);
  });
});
