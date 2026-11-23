/*
 * The app session harness's wire is written once and copied: the desktop's canonical
 * `desktop/src/sessionControlProtocol.ts` and the CLI's `src/sessionHarness/appProtocol.ts` must stay byte for byte
 * the same file, because neither tree can import the other — and so must its two siblings, `wireBasics.ts` and
 * `usageWire.ts`, which share one name in both trees so the specifier importing them is the same bytes. This lane
 * reaches both roots, so it holds every pair to one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  APP_HARNESS_PROTOCOL_VERSION,
  appHarnessSocketPath,
  isAppHarnessRequestEnvelope,
  isAppHarnessResponseEnvelope,
} from "../../src/sessionControlProtocol";

const REPO = join(__dirname, "..", "..", "..");

const SNAPSHOT = {
  directory: "/work/acme",
  handle: "app:0b5e",
  ledgerKey: "abc-1",
  openedAtIso: "2026-11-09T01:00:00.000Z",
  sessionId: "0b5e",
  state: "idle",
  title: "abc-1",
  vendor: "claude",
};

/** Each mirrored file: the desktop's canonical copy, then the CLI's. */
const MIRRORED: readonly { readonly canonical: string; readonly mirror: string }[] = [
  { canonical: "sessionControlProtocol.ts", mirror: "appProtocol.ts" },
  { canonical: "wireBasics.ts", mirror: "wireBasics.ts" },
  { canonical: "usageWire.ts", mirror: "usageWire.ts" },
];

describe("the app harness protocol", () => {
  it("names every mirrored file, so the byte-for-byte check below is not vacuous", () => {
    expect(MIRRORED.length).toBeGreaterThan(0);
    expect(MIRRORED.map((pair) => pair.canonical)).toEqual([
      "sessionControlProtocol.ts",
      "wireBasics.ts",
      "usageWire.ts",
    ]);
  });

  it.each(MIRRORED)("is one file, byte for byte, in the desktop ($canonical) and in the CLI ($mirror)", (pair) => {
    const canonical = readFileSync(join(REPO, "desktop", "src", pair.canonical), "utf8");
    const mirror = readFileSync(join(REPO, "src", "sessionHarness", pair.mirror), "utf8");
    expect(canonical.length).toBeGreaterThan(0);
    expect(mirror).toBe(canonical);
  });

  it("accepts a message request with a known delivery and refuses an unknown one", () => {
    const envelope = {
      protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
      request: { delivery: "now", kind: "message", sessionId: "0b5e", text: "hello" },
      requestId: "r1",
    };
    expect(isAppHarnessRequestEnvelope(envelope)).toBe(true);
    expect(isAppHarnessRequestEnvelope({ ...envelope, request: { ...envelope.request, delivery: "soon" } })).toBe(
      false,
    );
  });

  it("refuses a request at another protocol version or with no id", () => {
    const envelope = { protocolVersion: APP_HARNESS_PROTOCOL_VERSION, request: { kind: "list" }, requestId: "r1" };
    expect(isAppHarnessRequestEnvelope(envelope)).toBe(true);
    expect(isAppHarnessRequestEnvelope({ ...envelope, protocolVersion: 1 })).toBe(false);
    expect(isAppHarnessRequestEnvelope({ ...envelope, requestId: "" })).toBe(false);
  });

  it("accepts a launch request only for a Codex spec carrying a Codex home and the app its door was judged against", () => {
    const spec = {
      codexHome: "/h/codex-one",
      judgedInstanceId: "instance-a",
      directory: "/work/acme",
      ledgerKey: "abc-1",
      title: "abc-1",
      vendor: "codex",
    };
    const envelope = {
      protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
      request: { kind: "launch.prepare", spec },
      requestId: "r2",
    };
    expect(isAppHarnessRequestEnvelope(envelope)).toBe(true);
    const { codexHome: _dropped, ...homeless } = spec;
    expect(isAppHarnessRequestEnvelope({ ...envelope, request: { kind: "launch.prepare", spec: homeless } })).toBe(
      false,
    );
    const { judgedInstanceId: _unjudged, ...unjudged } = spec;
    expect(isAppHarnessRequestEnvelope({ ...envelope, request: { kind: "launch.prepare", spec: unjudged } })).toBe(
      false,
    );
    expect(
      isAppHarnessRequestEnvelope({ ...envelope, request: { kind: "launch.prepare", spec: { ...spec, vendor: "x" } } }),
    ).toBe(false);
  });

  it("accepts a Claude launch request only with a credential store the plan routed, never a Codex field", () => {
    const spec = {
      claudeMdExcludes: ["/work/acme/AGENTS.md"],
      credential: { kind: "store", secureStorageDir: "/h/claude-two" },
      directory: "/work/acme",
      ledgerKey: "abc-1",
      title: "abc-1",
      vendor: "claude",
    };
    const prepare = (over: Record<string, unknown>) => ({
      protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
      request: { kind: "launch.prepare", spec: { ...spec, ...over } },
      requestId: "r2",
    });
    expect(isAppHarnessRequestEnvelope(prepare({}))).toBe(true);
    expect(isAppHarnessRequestEnvelope(prepare({ credential: { kind: "store" } }))).toBe(false);
    expect(isAppHarnessRequestEnvelope(prepare({ codexHome: "/h/codex-one" }))).toBe(false);
  });

  it("accepts an answered close and a refusal with a known code, and refuses an unknown code", () => {
    const closed = {
      outcome: "answered",
      protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
      requestId: "r3",
      response: { forced: true, kind: "closed", session: { ...SNAPSHOT, state: "closed" } },
    };
    expect(isAppHarnessResponseEnvelope(closed)).toBe(true);
    const refused = {
      code: "SESSION_NOT_FOUND",
      message: "no session app:0b5e",
      outcome: "refused",
      protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
      requestId: "r3",
    };
    expect(isAppHarnessResponseEnvelope(refused)).toBe(true);
    expect(isAppHarnessResponseEnvelope({ ...refused, code: "TEAPOT" })).toBe(false);
  });

  it("refuses a session list holding one malformed snapshot", () => {
    const listed = {
      outcome: "answered",
      protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
      requestId: "r4",
      response: { kind: "sessions", sessions: [SNAPSHOT, { ...SNAPSHOT, state: "asleep" }] },
    };
    expect(isAppHarnessResponseEnvelope(listed)).toBe(false);
    expect(isAppHarnessResponseEnvelope({ ...listed, response: { kind: "sessions", sessions: [SNAPSHOT] } })).toBe(
      true,
    );
  });

  it("puts the socket in one owner directory per user, under the root it is given", () => {
    expect(appHarnessSocketPath({ root: "/tmp", uid: 501 })).toEqual({
      directory: "/tmp/slopweaver-501",
      socket: "/tmp/slopweaver-501/session-harness-v2.sock",
    });
  });
});
