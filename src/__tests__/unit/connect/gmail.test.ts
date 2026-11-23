/** Unit: the Gmail preflight classifier — the only source whose report is mostly a scope breakdown. */
import { describe, expect, it } from "vitest";
import { classifyGmail, type GmailProbe } from "../../../connect/gmail.js";
import type { ConnectCapability } from "../../../connect/types.js";
import { GMAIL_SCOPES } from "../../../live/gmail/scopes.js";

const CONNECTED: GmailProbe = {
  account: "me@example.test",
  grantPresent: true,
  grantedScopes: [GMAIL_SCOPES.identity, GMAIL_SCOPES.read],
  messagesTotal: 1234,
  profileReachable: true,
};

function row({ capabilities, id }: { capabilities: readonly ConnectCapability[]; id: string }): ConnectCapability {
  return capabilities.find((capability) => capability.id === id)!;
}

describe("classifyGmail", () => {
  it("reports no grant as a hard auth gap naming the verb that fixes it", () => {
    const report = classifyGmail({ probe: { ...CONNECTED, grantPresent: false } });
    expect(report.ok).toBe(false);
    expect(report.tokenPresent).toBe(false);
    expect(row({ capabilities: report.capabilities, id: "auth" }).detail).toContain("gmail connect");
  });

  it("passes a read-only grant: a declined optional scope is a warning, never a failure", () => {
    const report = classifyGmail({ probe: CONNECTED });
    expect(report.ok).toBe(true);
    expect(row({ capabilities: report.capabilities, id: `scope:${GMAIL_SCOPES.read}` }).status).toBe("ok");
    expect(row({ capabilities: report.capabilities, id: `scope:${GMAIL_SCOPES.send}` }).status).toBe("warning");
    expect(row({ capabilities: report.capabilities, id: `scope:${GMAIL_SCOPES.modify}` }).status).toBe("warning");
  });

  it("counts gmail.modify as satisfying the read row too", () => {
    const report = classifyGmail({
      probe: { ...CONNECTED, grantedScopes: [GMAIL_SCOPES.identity, GMAIL_SCOPES.modify] },
    });
    expect(row({ capabilities: report.capabilities, id: `scope:${GMAIL_SCOPES.read}` }).status).toBe("ok");
    expect(row({ capabilities: report.capabilities, id: `scope:${GMAIL_SCOPES.modify}` }).status).toBe("ok");
  });

  it("FAILS when identity was withheld, because the report could not then name its own mailbox", () => {
    const report = classifyGmail({ probe: { ...CONNECTED, grantedScopes: [GMAIL_SCOPES.read] } });
    expect(report.ok).toBe(false);
    expect(row({ capabilities: report.capabilities, id: `scope:${GMAIL_SCOPES.identity}` }).status).toBe("missing");
  });

  it("fails a stored grant the mailbox refused, and points at where a grant is revoked", () => {
    const report = classifyGmail({ probe: { ...CONNECTED, messagesTotal: 0, profileReachable: false } });
    expect(report.ok).toBe(false);
    expect(row({ capabilities: report.capabilities, id: "read-probe" }).detail).toContain("revoked");
  });

  it.each([
    ["absent", CONNECTED],
    ["none", { ...CONNECTED, refreshLapse: { kind: "none" } } satisfies GmailProbe],
  ])("adds no refresh-token row when the lapse is %s", (_label, probe) => {
    const report = classifyGmail({ probe });
    expect(report.capabilities.map((capability) => capability.id)).toStrictEqual([
      "auth",
      ...["identity", "read", "modify", "compose", "send", "docs"].map(
        (capability) => `scope:${GMAIL_SCOPES[capability as keyof typeof GMAIL_SCOPES]}`,
      ),
      "read-probe",
    ]);
  });

  it.each([
    ["soon", "warning", true],
    ["lapsed", "missing", false],
    ["unreadable", "missing", false],
  ] as const)("reports a %s refresh token as %s, carrying its warning", (kind, status, passes) => {
    const report = classifyGmail({
      probe: { ...CONNECTED, refreshLapse: { expiresAtIso: "2026-09-03T12:00:00.000Z", kind, warning: "W" } },
    });
    expect(row({ capabilities: report.capabilities, id: "refresh-token" })).toStrictEqual({
      detail: "W",
      id: "refresh-token",
      status,
    });
    expect(report.ok).toBe(passes);
  });

  it("passes a refresh token outside the window, naming its lapse and how to stop it", () => {
    const report = classifyGmail({
      probe: { ...CONNECTED, refreshLapse: { expiresAtIso: "2026-09-03T12:00:00.000Z", kind: "ok" } },
    });
    const lapse = row({ capabilities: report.capabilities, id: "refresh-token" });
    expect(lapse.status).toBe("ok");
    expect(lapse.detail).toBe(
      "lapses at 2026-09-03T12:00:00.000Z, as Google does for a Testing-status OAuth client — publish the client to Production to stop it lapsing",
    );
    expect(report.capabilities[1]!.id).toBe("refresh-token");
  });

  it("says the mailbox total is a PROBE SAMPLE rather than corpus coverage", () => {
    const report = classifyGmail({ probe: CONNECTED });
    const probe = row({ capabilities: report.capabilities, id: "read-probe" });
    expect(probe.detail).toContain("1234 message(s)");
    expect(probe.detail).toContain("PROBE SAMPLE SIZES, not corpus coverage");
  });
});
