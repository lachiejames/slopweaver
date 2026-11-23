import { describe, expect, it } from "vitest";

import * as gateway from "../../../../../atlas/cloudflare/projection/zeroTrustGateway.js";
import {
  projectCloudflareGatewayAuditSsh,
  projectCloudflareGatewayConfiguration,
  projectCloudflareGatewayLogging,
} from "../../../../../atlas/cloudflare/projection/zeroTrustGatewaySingleton.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("the three Gateway singletons", () => {
  it("stores every field an empty configuration omitted as null", () => {
    const entity = projectCloudflareGatewayConfiguration({ accountId: ACCOUNT_ID, at: AT, configuration: {} });
    expect(entity.detail).toEqual({
      createdAt: null,
      kind: "gateway-configuration",
      settings: null,
      updatedAt: null,
    });
  });

  it("stores every field an empty logging record omitted as null", () => {
    const entity = projectCloudflareGatewayLogging({ accountId: ACCOUNT_ID, at: AT, logging: {} });
    expect(entity.detail).toEqual({ kind: "gateway-logging", redactPii: null, settingsByRuleType: null });
  });

  it("stores every field an SSH audit setting omitted or sent as null as null", () => {
    const entity = projectCloudflareGatewayAuditSsh({
      accountId: ACCOUNT_ID,
      at: AT,
      setting: { is_public_key_valid: null, public_key: null },
    });
    expect(entity.detail).toEqual({
      createdAt: null,
      kind: "gateway-audit-ssh-setting",
      publicKey: null,
      publicKeyValid: null,
      seedId: null,
      updatedAt: null,
    });
  });

  it("is what the Gateway projection module re-exports, so its importers name one module", () => {
    expect(gateway.projectCloudflareGatewayConfiguration).toBe(projectCloudflareGatewayConfiguration);
    expect(gateway.projectCloudflareGatewayLogging).toBe(projectCloudflareGatewayLogging);
    expect(gateway.projectCloudflareGatewayAuditSsh).toBe(projectCloudflareGatewayAuditSsh);
    expect([gateway.GATEWAY_CONFIGURATION_ID, gateway.GATEWAY_LOGGING_ID, gateway.GATEWAY_AUDIT_SSH_ID]).toEqual([
      "gateway-configuration",
      "gateway-logging",
      "gateway-audit-ssh-setting",
    ]);
  });
});
