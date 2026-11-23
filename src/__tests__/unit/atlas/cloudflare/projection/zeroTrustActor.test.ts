import { describe, expect, it } from "vitest";

import {
  type CloudflareAccessUserDetail,
  type CloudflareZeroTrustOrganizationDetail,
  projectCloudflareAccessUser,
  projectCloudflareZeroTrustOrganization,
  ZERO_TRUST_ORGANIZATION_ID,
} from "../../../../../atlas/cloudflare/projection/zeroTrustActor.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("projectCloudflareAccessUser", () => {
  it("keeps the two seat entitlements apart", () => {
    const detail = projectCloudflareAccessUser({
      accountId: ACCOUNT_ID,
      at: AT,
      user: {
        access_seat: true,
        email: "person@example.test",
        gateway_seat: false,
        id: "user-1",
        last_successful_login: AT,
        name: "A Person",
      },
    }).detail as CloudflareAccessUserDetail;
    expect(detail.accessSeat).toBe(true);
    expect(detail.gatewaySeat).toBe(false);
    expect(detail.email).toBe("person@example.test");
    expect(detail.lastSuccessfulLogin).toBe(AT);
  });

  it("nulls a user who has never signed in", () => {
    const detail = projectCloudflareAccessUser({ accountId: ACCOUNT_ID, at: AT, user: { id: "user-2" } })
      .detail as CloudflareAccessUserDetail;
    expect(detail.lastSuccessfulLogin).toBeNull();
    expect(detail.accessSeat).toBeNull();
  });

  it("stores null for every field when the user row carries nothing but an id", () => {
    const detail = projectCloudflareAccessUser({ accountId: ACCOUNT_ID, at: AT, user: { id: "user-3" } }).detail;
    expect(detail).toEqual({
      accessSeat: null,
      createdAt: null,
      email: null,
      gatewaySeat: null,
      kind: "access-user",
      lastSuccessfulLogin: null,
      name: null,
      seatUid: null,
      uid: null,
      updatedAt: null,
    });
  });

  it("stores null for a field the provider sent as null", () => {
    const detail = projectCloudflareAccessUser({
      accountId: ACCOUNT_ID,
      at: AT,
      user: { access_seat: null, email: null, id: "user-4" },
    }).detail as CloudflareAccessUserDetail;
    expect(detail.accessSeat).toBeNull();
    expect(detail.email).toBeNull();
  });
});

describe("projectCloudflareZeroTrustOrganization", () => {
  it("keeps the session and unmatched-request terms every user is judged under", () => {
    const entity = projectCloudflareZeroTrustOrganization({
      accountId: ACCOUNT_ID,
      at: AT,
      organization: {
        auth_domain: "team.example.test",
        cache_device_posture: true,
        deny_unmatched_requests: false,
        deny_unmatched_requests_exempted_zone_names: ["public.example.test"],
        name: "team",
        user_seat_expiration_inactive_time: "2190h",
        warp_auth_session_duration: "36h",
      },
    });
    const detail = entity.detail as CloudflareZeroTrustOrganizationDetail;
    expect(detail.authDomain).toBe("team.example.test");
    expect(detail.warpAuthSessionDuration).toBe("36h");
    expect(detail.denyUnmatchedRequests).toBe(false);
    expect(detail.denyUnmatchedRequestsExemptedZoneNames).toEqual(["public.example.test"]);
    expect(detail.cacheDevicePosture).toBe(true);
    expect(detail.userSeatExpirationInactiveTime).toBe("2190h");
    expect(entity.providerId).toBe(ZERO_TRUST_ORGANIZATION_ID);
  });

  it("gives an empty exemption list rather than null when the field is absent", () => {
    const detail = projectCloudflareZeroTrustOrganization({ accountId: ACCOUNT_ID, at: AT, organization: {} })
      .detail as CloudflareZeroTrustOrganizationDetail;
    expect(detail.denyUnmatchedRequestsExemptedZoneNames).toEqual([]);
  });

  it("gives an empty exemption list when the provider sent null", () => {
    const detail = projectCloudflareZeroTrustOrganization({
      accountId: ACCOUNT_ID,
      at: AT,
      organization: { deny_unmatched_requests_exempted_zone_names: null },
    }).detail as CloudflareZeroTrustOrganizationDetail;
    expect(detail.denyUnmatchedRequestsExemptedZoneNames).toEqual([]);
  });

  it("copies the exemption list rather than aliasing the provider's array", () => {
    const names = ["public.example.test"];
    const detail = projectCloudflareZeroTrustOrganization({
      accountId: ACCOUNT_ID,
      at: AT,
      organization: { deny_unmatched_requests_exempted_zone_names: names },
    }).detail as CloudflareZeroTrustOrganizationDetail;
    expect(detail.denyUnmatchedRequestsExemptedZoneNames).not.toBe(names);
    expect(detail.denyUnmatchedRequestsExemptedZoneNames).toEqual(names);
  });

  it("stores null for every scalar and an empty list when the organisation row is empty", () => {
    const detail = projectCloudflareZeroTrustOrganization({ accountId: ACCOUNT_ID, at: AT, organization: {} }).detail;
    expect(detail).toEqual({
      allowAuthenticateViaWarp: null,
      authDomain: null,
      cacheDevicePosture: null,
      createdAt: null,
      denyUnmatchedRequests: null,
      denyUnmatchedRequestsExemptedZoneNames: [],
      hasMigratedPrivateApps: null,
      isUiReadOnly: null,
      kind: "zero-trust-organization",
      loginDesign: null,
      name: null,
      updatedAt: null,
      userSeatExpirationInactiveTime: null,
      warpAuthNonBrowser401: null,
      warpAuthSessionDuration: null,
    });
  });
});
