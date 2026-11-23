/**
 * What `handover pause` and `unpause` were asked to do, read straight off parsed flag values — the stated
 * defaults (`--since` is the moment recorded, `--status` is `ready`) and each usage refusal.
 */
import { describe, expect, it } from "vitest";

import { pauseFields, pauseFlag, pausePlan, unpausePlan } from "../../../../../cli/commands/handover/pausePlan.js";

const NOW = "2026-10-14T01:00:00.000Z";

describe("pauseFlag", () => {
  it("trims a given value", () => {
    expect(pauseFlag({ name: "on", values: { on: "  the owner " } })).toBe("the owner");
  });

  it("reads a blank value as absent, since a pause on nobody names nobody", () => {
    expect(pauseFlag({ name: "on", values: { on: "   " } })).toBe(undefined);
  });

  it("reads a switch as absent, since it carries no text", () => {
    expect(pauseFlag({ name: "on", values: { on: true } })).toBe(undefined);
  });
});

describe("pausePlan", () => {
  it("records the pause at the moment it is recorded when --since is not given", () => {
    expect(pausePlan({ nowIso: NOW, positionals: ["a-row"], values: { on: "the owner" } })).toEqual({
      since: NOW,
      slug: "a-row",
      who: "the owner",
      why: undefined,
    });
  });

  it("keeps a --since that was given", () => {
    const plan = pausePlan({
      nowIso: NOW,
      positionals: ["a-row"],
      values: { on: "the owner", since: "2026-10-01T00:00:00.000Z", why: "a review" },
    });
    expect(plan).toEqual({ since: "2026-10-01T00:00:00.000Z", slug: "a-row", who: "the owner", why: "a review" });
  });

  it("refuses with no slug", () => {
    expect(pausePlan({ nowIso: NOW, positionals: [], values: { on: "the owner" } })).toEqual({
      refusal: "which row? Pass its slug",
    });
  });

  it("refuses with nobody named", () => {
    expect(pausePlan({ nowIso: NOW, positionals: ["a-row"], values: {} })).toEqual({
      refusal: "--on is required — a pause with nobody named is the parking this state replaced",
    });
  });

  it("refuses a --since that is not an instant", () => {
    expect(pausePlan({ nowIso: NOW, positionals: ["a-row"], values: { on: "the owner", since: "soon" } })).toEqual({
      refusal: '--since "soon" is not an instant',
    });
  });

  it("refuses a line break in --on, which front-matter would read as a new key", () => {
    expect(pausePlan({ nowIso: NOW, positionals: ["a-row"], values: { on: "the\nowner" } })).toEqual({
      refusal: "--on cannot contain a line break — front-matter is read line by line",
    });
  });
});

describe("pauseFields", () => {
  it("writes the status, who and since, and the summary only when a reason was given", () => {
    expect(pauseFields({ since: NOW, who: "the owner", why: undefined })).toEqual([
      { key: "status", value: "paused" },
      { key: "pausedOn", value: "the owner" },
      { key: "pausedSince", value: NOW },
    ]);
    expect(pauseFields({ since: NOW, who: "the owner", why: "a review" })[3]).toEqual({
      key: "statusSummary",
      value: "a review",
    });
  });
});

describe("unpausePlan", () => {
  it("returns a row to ready when --status is not given", () => {
    expect(unpausePlan({ positionals: ["a-row"], values: {} })).toEqual({
      slug: "a-row",
      status: "ready",
      why: undefined,
    });
  });

  it("keeps an in-progress --status", () => {
    expect(unpausePlan({ positionals: ["a-row"], values: { status: "in-progress" } })).toEqual({
      slug: "a-row",
      status: "in-progress",
      why: undefined,
    });
  });

  it("refuses a status a resumed row cannot honestly claim", () => {
    expect(unpausePlan({ positionals: ["a-row"], values: { status: "done" } })).toEqual({
      refusal: "--status must be ready or in-progress",
    });
  });

  it("refuses with no slug", () => {
    expect(unpausePlan({ positionals: [], values: {} })).toEqual({ refusal: "which row? Pass its slug" });
  });
});
