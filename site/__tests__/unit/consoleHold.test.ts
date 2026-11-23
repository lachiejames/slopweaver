import { describe, expect, it } from "vitest";

import {
  CALL_LEASE_MS,
  heldNote,
  holdsNavigation,
  isRefreshRoundArgs,
  leaseOf,
  mintLeaseOf,
  parseBeatAnswer,
  parseCallBeat,
  parseWaiting,
} from "../../lib/consoleHold";
import { OFFER_ANSWER_BOUND_MS } from "../../lib/talkOffer";

const CALL_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SHA = "1053af72c0a1b2c3d4e5f60718293a4b5c6d7e8f";
const WAITING = { pid: 4242, sha: SHA, sinceIso: "2026-09-25T02:34:05Z" };

describe("a call beat's body", () => {
  it("reads a live beat and a hang-up", () => {
    expect(parseCallBeat({ raw: JSON.stringify({ callId: CALL_ID, live: true }) })).toEqual({
      beat: { callId: CALL_ID, live: true },
      kind: "beat",
    });
    expect(parseCallBeat({ raw: JSON.stringify({ callId: CALL_ID, live: false }) })).toEqual({
      beat: { callId: CALL_ID, live: false },
      kind: "beat",
    });
  });

  it("refuses a call id that is not the widget's UUID, because it names a file", () => {
    expect(parseCallBeat({ raw: JSON.stringify({ callId: "../../record", live: true }) })).toEqual({
      kind: "refused",
      why: "callId must be the widget's own lowercase UUID",
    });
  });

  it("refuses a live that is not a boolean, and a body that is not a JSON object", () => {
    expect(parseCallBeat({ raw: JSON.stringify({ callId: CALL_ID, live: "yes" }) })).toEqual({
      kind: "refused",
      why: "live must be true or false",
    });
    expect(parseCallBeat({ raw: "[]" })).toEqual({ kind: "refused", why: "the body is not a JSON object" });
    expect(parseCallBeat({ raw: "{" })).toEqual({ kind: "refused", why: "the body is not JSON" });
  });
});

describe("a lease", () => {
  it("expires one lease length after the beat that wrote it", () => {
    expect(leaseOf({ callId: CALL_ID, nowMs: 1_000 })).toEqual({ callId: CALL_ID, untilMs: 1_000 + CALL_LEASE_MS });
  });

  it("holds a mint for the offer route's whole bound plus one lease, so the swap cannot fire mid-composition", () => {
    // A follow-on press after the 90-minute limit would hold no lease, and the rebuild would kill `talk offer`.
    expect(mintLeaseOf({ boundMs: OFFER_ANSWER_BOUND_MS, callId: CALL_ID, nowMs: 1_000 })).toEqual({
      callId: CALL_ID,
      untilMs: 1_000 + OFFER_ANSWER_BOUND_MS + 60_000,
    });
  });
});

describe("waiting.json", () => {
  it("reads exactly what the refresh round writes", () => {
    expect(parseWaiting({ raw: JSON.stringify(WAITING) })).toEqual(WAITING);
  });

  it("reads nothing from a half-written or malformed file", () => {
    expect(parseWaiting({ raw: '{"sha":' })).toBeUndefined();
    expect(parseWaiting({ raw: JSON.stringify({ ...WAITING, sha: "1053af72c" }) })).toBeUndefined();
    expect(parseWaiting({ raw: JSON.stringify({ ...WAITING, pid: 0 }) })).toBeUndefined();
    expect(parseWaiting({ raw: JSON.stringify({ ...WAITING, sinceIso: "soon" }) })).toBeUndefined();
  });

  it("reads a file a round wrote before the hold lost its clock, dropping the deadline it named", () => {
    expect(parseWaiting({ raw: JSON.stringify({ ...WAITING, capIso: "2026-09-25T03:04:05Z" }) })).toEqual(WAITING);
  });

  it("believes the pid it names only while that pid is a refresh round", () => {
    expect(isRefreshRoundArgs({ args: "bash /work/slopweaver/scripts/docs-site.sh --refresh-round\n" })).toBe(true);
    expect(isRefreshRoundArgs({ args: "sleep 600" })).toBe(false);
    expect(isRefreshRoundArgs({ args: "vim scripts/docs-site.sh" })).toBe(false);
    expect(isRefreshRoundArgs({ args: "node monitor.js /work/scripts/docs-site.sh --refresh-round" })).toBe(false);
    expect(isRefreshRoundArgs({ args: undefined })).toBe(false);
  });
});

describe("the route's answer", () => {
  it("carries the waiting build through", () => {
    expect(parseBeatAnswer({ body: { recorded: true, waiting: WAITING } })).toEqual({
      recorded: true,
      waiting: WAITING,
      why: undefined,
    });
  });

  it("says why nothing was recorded on a server with no hold directory", () => {
    expect(parseBeatAnswer({ body: { recorded: false, why: "no hold dir" } })).toEqual({
      recorded: false,
      waiting: undefined,
      why: "no hold dir",
    });
  });

  it("is not an answer without its recorded flag", () => {
    expect(parseBeatAnswer({ body: { waiting: WAITING } })).toBeUndefined();
  });
});

describe("the widget's notes", () => {
  it("names a held console page by its path", () => {
    expect(heldNote({ href: "http://localhost:3000/queue?open=ask%3Ax", origin: "http://localhost:3000" })).toBe(
      "Opening /queue?open=ask%3Ax reloads the console, which would end this call; it opens when you hang up.",
    );
  });

  it("names a held page elsewhere by its whole URL", () => {
    expect(heldNote({ href: "https://github.com/x/y", origin: "http://localhost:3000" })).toBe(
      "Opening https://github.com/x/y reloads the console, which would end this call; it opens when you hang up.",
    );
  });
});

describe("which navigation a live call holds", () => {
  const push = { cancelable: true, download: false, navigationType: "push", sameDocument: false };

  it("holds a push or replace that would unload the page — Next's forced reload is one", () => {
    expect(holdsNavigation(push)).toBe(true);
    expect(holdsNavigation({ ...push, navigationType: "replace" })).toBe(true);
  });

  it("lets a same-document navigation through, which is every client route change that worked", () => {
    expect(holdsNavigation({ ...push, sameDocument: true })).toBe(false);
  });

  it("lets the owner's own reload and back/forward through, and a download, and anything the browser will not cancel", () => {
    expect(holdsNavigation({ ...push, navigationType: "reload" })).toBe(false);
    expect(holdsNavigation({ ...push, navigationType: "traverse" })).toBe(false);
    expect(holdsNavigation({ ...push, download: true })).toBe(false);
    expect(holdsNavigation({ ...push, cancelable: false })).toBe(false);
  });
});
