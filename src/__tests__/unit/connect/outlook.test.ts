/** Unit: the Outlook preflight — registration, grant, per-tier scope rows and the live `/me` row. */
import { describe, expect, it } from "vitest";
import {
  checkOutlookConnection,
  classifyOutlook,
  type OutlookProbe,
  outlookGrantUnreadableReport,
  redactClientId,
} from "../../../connect/outlook.js";
import type { ConnectCapability } from "../../../connect/types.js";
import { err, ok } from "../../../lib/result.js";
import { OutlookErrors } from "../../../live/outlook/errors.js";

const READ_GRANT = ["User.Read", "Mail.Read", "MailboxSettings.Read"];
const MANAGE_GRANT = ["User.Read", "Mail.ReadWrite", "MailboxSettings.Read"];
const FULL_GRANT = [...MANAGE_GRANT, "Mail.Send"];

const CONNECTED: OutlookProbe = {
  account: "me@example.test",
  clientIdPresent: true,
  grantPresent: true,
  grantedScopes: READ_GRANT,
  meReachable: true,
  meRefusal: undefined,
};

function row({ capabilities, id }: { capabilities: readonly ConnectCapability[]; id: string }): ConnectCapability {
  return capabilities.find((capability) => capability.id === id)!;
}

describe("classifyOutlook", () => {
  it("names every registration setting when the client id is missing, and fails", () => {
    const report = classifyOutlook({ probe: { ...CONNECTED, clientIdPresent: false } });
    const registration = row({ capabilities: report.capabilities, id: "registration" });
    expect(report.ok).toBe(false);
    expect(registration.status).toBe("missing");
    expect(registration.detail).toContain("personal Microsoft accounts");
    expect(registration.detail).toContain("Mobile and desktop applications");
    expect(registration.detail).toContain("`http://localhost`");
    expect(registration.detail).toContain("no client secret");
    expect(registration.detail).toContain("skills/outlook/reference/connecting.md");
    expect(registration.detail).toContain("slopweaver secrets set outlook-client-id");
    expect(report.capabilities.map((capability) => capability.id)).not.toContain("read-probe");
  });

  it("reports no grant as a hard auth gap naming the one consent command", () => {
    const report = classifyOutlook({ probe: { ...CONNECTED, account: "", grantPresent: false, grantedScopes: [] } });
    expect(report.ok).toBe(false);
    expect(report.tokenPresent).toBe(false);
    expect(report.capabilities.map((capability) => capability.id)).toEqual(["registration", "auth"]);
    expect(row({ capabilities: report.capabilities, id: "auth" }).detail).toContain(
      "slopweaver outlook connect --grant manage",
    );
  });

  it("passes a read grant, warning on manage and send with the verb each costs and the grant that adds it", () => {
    const report = classifyOutlook({ probe: CONNECTED });
    const manage = row({ capabilities: report.capabilities, id: "scope:manage" });
    const send = row({ capabilities: report.capabilities, id: "scope:send" });
    expect(report.ok).toBe(true);
    expect(row({ capabilities: report.capabilities, id: "scope:read" }).status).toBe("ok");
    expect(manage.status).toBe("warning");
    expect(manage.detail).toBe(
      "not granted (Mail.ReadWrite) — outlook mark / category / archive / draft will refuse; widen with " +
        "`slopweaver outlook connect --grant manage`",
    );
    expect(send.status).toBe("warning");
    expect(send.detail).toContain("`slopweaver outlook connect --grant full`");
  });

  it("counts Mail.ReadWrite as satisfying the read tier too, leaving only send unwarned-for", () => {
    const report = classifyOutlook({ probe: { ...CONNECTED, grantedScopes: MANAGE_GRANT } });
    expect(row({ capabilities: report.capabilities, id: "scope:read" }).status).toBe("ok");
    expect(row({ capabilities: report.capabilities, id: "scope:manage" }).status).toBe("ok");
    expect(row({ capabilities: report.capabilities, id: "scope:send" }).status).toBe("warning");
  });

  it("warns on the read tier when the mailbox-settings permission was declined", () => {
    const report = classifyOutlook({ probe: { ...CONNECTED, grantedScopes: ["User.Read", "Mail.Read"] } });
    expect(row({ capabilities: report.capabilities, id: "scope:read" }).detail).toContain(
      "not granted (MailboxSettings.Read)",
    );
  });

  it("reports a full grant with a reachable /me as every row ok", () => {
    const report = classifyOutlook({ probe: { ...CONNECTED, grantedScopes: FULL_GRANT } });
    expect(report.ok).toBe(true);
    expect(report.capabilities.map((capability) => capability.status)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
  });

  it("fails a complete grant whose /me did not reach Graph, carrying the door's refusal", () => {
    const report = classifyOutlook({
      probe: { ...CONNECTED, grantedScopes: FULL_GRANT, meReachable: false, meRefusal: "consent withdrawn" },
    });
    const probe = row({ capabilities: report.capabilities, id: "read-probe" });
    expect(report.ok).toBe(false);
    expect(probe.status).toBe("missing");
    expect(probe.detail).toContain("did not reach Microsoft Graph: consent withdrawn");
    expect(probe.detail).toContain("https://account.live.com/consent/Manage");
  });
});

describe("checkOutlookConnection", () => {
  const STORED = {
    account: "me@example.test",
    clientIdPresent: true,
    grantPresent: true,
    grantedScopes: FULL_GRANT,
  };

  it("calls /me exactly once and reports it reachable", async () => {
    const calls: string[] = [];
    const report = await checkOutlookConnection({
      probe: STORED,
      probes: {
        me: () => {
          calls.push("me");
          return Promise.resolve(ok({ id: "id-1", mail: null, userPrincipalName: "me@example.test" }));
        },
      },
    });
    expect(calls).toEqual(["me"]);
    expect(report.ok).toBe(true);
    expect(row({ capabilities: report.capabilities, id: "read-probe" }).status).toBe("ok");
  });

  it("reduces a refused /me to a hard read-probe gap naming the refusal", async () => {
    const report = await checkOutlookConnection({
      probe: STORED,
      probes: { me: () => Promise.resolve(err(OutlookErrors.notConnected())) },
    });
    expect(report.ok).toBe(false);
    expect(row({ capabilities: report.capabilities, id: "read-probe" }).detail).toContain(
      OutlookErrors.notConnected().message,
    );
  });

  it("never calls /me when there is no client id or no grant to refresh", async () => {
    const calls: string[] = [];
    const me = () => {
      calls.push("me");
      return Promise.resolve(ok({ id: "id-1", mail: null, userPrincipalName: "me@example.test" }));
    };
    await checkOutlookConnection({ probe: { ...STORED, clientIdPresent: false }, probes: { me } });
    await checkOutlookConnection({ probe: { ...STORED, grantPresent: false }, probes: { me } });
    expect(calls).toEqual([]);
  });
});

describe("redactClientId", () => {
  const ID = "00000000-0000-0000-0000-000000000001";

  it("names every occurrence of the client id instead of printing it", () => {
    const message = `Application with identifier '${ID}' was not found (${ID})`;
    expect(redactClientId({ clientId: ID, message })).toBe(
      "Application with identifier '<outlook-client-id>' was not found (<outlook-client-id>)",
    );
  });

  it("leaves a message unchanged when no client id resolved", () => {
    expect(redactClientId({ clientId: undefined, message: `id ${ID}` })).toBe(`id ${ID}`);
  });

  it("leaves a message unchanged for an empty client id rather than splitting on nothing", () => {
    expect(redactClientId({ clientId: "", message: "refused" })).toBe("refused");
  });
});

describe("outlookGrantUnreadableReport", () => {
  it("keeps the registration row beside the unreadable grant, so both missing halves are named", () => {
    const report = outlookGrantUnreadableReport({ clientIdPresent: false, why: "not valid JSON" });
    expect(report.ok).toBe(false);
    expect(report.capabilities.map((capability) => [capability.id, capability.status])).toEqual([
      ["registration", "missing"],
      ["auth", "missing"],
    ]);
  });

  it("reports the registration ok when the client id resolved", () => {
    const report = outlookGrantUnreadableReport({ clientIdPresent: true, why: "not valid JSON" });
    expect(report.capabilities[0]!.status).toBe("ok");
    expect(report.capabilities[1]!.detail).toBe(
      "the stored Outlook grant is unreadable: not valid JSON — run `slopweaver outlook connect` again",
    );
  });
});
