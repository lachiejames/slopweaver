import { describe, expect, it } from "vitest";

import { needsSurfaceForOneCard, publicDripRefusal } from "../../../../outbound/slack/publicCardGate.js";

const DRIP = { allowPublicDrip: false, messageCount: 4, shape: "top-level" } as const;

describe("needsSurfaceForOneCard", () => {
  it("is true only for a MULTI-message top-level send — the one case the surface can refuse", () => {
    expect(needsSurfaceForOneCard({ messageCount: 4, shape: "top-level" })).toBe(true);
    expect(needsSurfaceForOneCard({ messageCount: 1, shape: "top-level" })).toBe(false);
    expect(needsSurfaceForOneCard({ messageCount: 4, shape: "thread" })).toBe(false);
  });

  it("is false at the boundary, so the compliant one-message shape never pays for a Slack call", () => {
    expect(needsSurfaceForOneCard({ messageCount: 2, shape: "top-level" })).toBe(true);
    expect(needsSurfaceForOneCard({ messageCount: 0, shape: "top-level" })).toBe(false);
  });
});

describe("publicDripRefusal", () => {
  it("REFUSES a multi-message top-level post into a public channel", () => {
    const refusals = publicDripRefusal({ ...DRIP, surface: "public-channel" });

    expect(refusals.length).toBe(1);
    expect(refusals[0]!).toContain("4 separate top-level messages into a PUBLIC channel");
  });

  it("names the TARGET SHAPE, not a direction — 'fewer' is what gets minimum-complied with", () => {
    const refusal = publicDripRefusal({ ...DRIP, surface: "public-channel" })[0]!;

    expect(refusal).toContain("ONE top-level message");
    expect(refusal).toContain('{"kind":"one-card"}');
    expect(refusal).not.toContain("fewer");
  });

  it("names the LIST form too, so a ten-row roster is not pushed back at the card's line bound", () => {
    const refusal = publicDripRefusal({ ...DRIP, surface: "public-channel" })[0]!;

    expect(refusal).toContain('{"kind":"one-list"}');
    expect(refusal).toContain("roster or batch ask");
  });

  it("names the journalled hatch, so a deliberate exception has one documented way through", () => {
    const refusal = publicDripRefusal({ ...DRIP, surface: "public-channel" })[0]!;

    expect(refusal).toContain(
      'run slopweaver hatch open public-drip --reason "<why this one is a legitimate exception>", then re-run',
    );
    expect(refusal).not.toContain("SLOPWEAVER_ALLOW_PUBLIC_DRIP");
  });

  it("FAILS CLOSED when the surface could not be established, because the guess it would make is public", () => {
    const refusals = publicDripRefusal({ ...DRIP, surface: undefined });

    expect(refusals.length).toBe(1);
    expect(refusals[0]!).toContain("could not say whether that channel is public or private");
    expect(refusals[0]!).toContain("ONE top-level message");
  });

  it("leaves a PRIVATE channel on today's drip rules, exactly as the ruling scopes it", () => {
    expect(publicDripRefusal({ ...DRIP, surface: "private-channel" })).toEqual([]);
  });

  it("leaves a DM alone — a drip between two people is conversation, not a wall", () => {
    expect(publicDripRefusal({ ...DRIP, surface: "direct-message" })).toEqual([]);
  });

  it("leaves a THREAD alone in a public channel: a parent with replies under it is not a wall", () => {
    expect(publicDripRefusal({ ...DRIP, shape: "thread", surface: "public-channel" })).toEqual([]);
  });

  it("admits the compliant shape — ONE top-level message in public is what the ruling asks for", () => {
    expect(publicDripRefusal({ ...DRIP, messageCount: 1, surface: "public-channel" })).toEqual([]);
  });

  it("admits a public drip once the caller resolved a live public-drip grant, and only then", () => {
    expect(publicDripRefusal({ ...DRIP, allowPublicDrip: true, surface: "public-channel" })).toEqual([]);
    expect(publicDripRefusal({ ...DRIP, allowPublicDrip: true, surface: undefined })).toEqual([]);
  });
});
