/**
 * The `auditevents` page's strict boundary over plain strings: every declared key accepted, every added,
 * dropped or renamed one refused by name, and nothing a page carried quoted back.
 */
import { describe, expect, it } from "vitest";

import { readOnepasswordAuditPage } from "../../../../atlas/onepassword/eventsBoundaries.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** The three keys the atlas floor requires of every event. */
const FLOOR = { action: "signin", timestamp: "2026-09-02T00:00:00Z", uuid: "EVENTEVENTEVENTEVENTEVENTA" };

/** An event carrying every key the boundary declares, read and unread alike. */
const FULL_EVENT = {
  ...FLOOR,
  account_uuid: "ACCOUNTACCOUNTACCOUNTACCAA",
  actor_details: { email: "person@example.test", name: "A Person", uuid: "ACTORACTORACTORACTORACTORA" },
  actor_type: "user",
  actor_uuid: "ACTORACTORACTORACTORACTORA",
  aux_details: null,
  aux_id: 0,
  aux_info: "",
  aux_uuid: "",
  location: { city: "Sydney", country: "AU", latitude: -33.9, longitude: 151.2, region: "NSW" },
  object_details: { name: "a vault" },
  object_type: "vault",
  object_uuid: "OBJECTOBJECTOBJECTOBJECT01",
  session: { device_uuid: "DEVICE", ip: "192.0.2.1", login_time: "2026-09-02T00:00:00Z", uuid: "SESSION" },
};

/** A page body, as the Events API sends one. */
const page = ({ fields }: { fields: Record<string, unknown> }): string => JSON.stringify(fields);

const REFUSED = "POST /api/v2/auditevents answered a shape this version does not read — refused, not guessed:";

describe("readOnepasswordAuditPage", () => {
  it("reads a page whose event carries every declared key, renaming only the envelope", () => {
    const text = page({ fields: { cursor: "CURSOR", has_more: true, items: [FULL_EVENT] } });
    expect(unwrap(readOnepasswordAuditPage({ text }))).toEqual({
      cursor: "CURSOR",
      hasMore: true,
      items: [FULL_EVENT],
    });
  });

  it("reads an event carrying only the floor, and null session and location", () => {
    const event = { ...FLOOR, location: null, session: null };
    const text = page({ fields: { cursor: "CURSOR", has_more: false, items: [event] } });
    expect(unwrap(readOnepasswordAuditPage({ text })).items).toEqual([event]);
  });

  it("refuses an envelope missing has_more, rather than reading it as the end of the walk", () => {
    const text = page({ fields: { cursor: "CURSOR", items: [] } });
    expect(unwrapErr(readOnepasswordAuditPage({ text })).message).toBe(`${REFUSED} field "has_more" is missing`);
  });

  it("refuses an empty cursor, because there is nothing to continue from", () => {
    const text = page({ fields: { cursor: "", has_more: true, items: [] } });
    expect(unwrapErr(readOnepasswordAuditPage({ text })).message).toContain('field "cursor" changed');
  });

  it("refuses a key added to the envelope, by name", () => {
    const text = page({ fields: { cursor: "CURSOR", has_more: false, items: [], next: "x" } });
    expect(unwrapErr(readOnepasswordAuditPage({ text })).message).toBe(`${REFUSED} new field "next"`);
  });

  it("refuses an event missing a floor key", () => {
    const { uuid: _dropped, ...withoutUuid } = FLOOR;
    const text = page({ fields: { cursor: "CURSOR", has_more: false, items: [withoutUuid] } });
    expect(unwrapErr(readOnepasswordAuditPage({ text })).message).toContain('field "items[0].uuid" is missing');
  });

  it("refuses a key added inside an event's location, naming its path and never its value", () => {
    const leaked = "DO_NOT_ECHO_7f3a";
    const event = { ...FLOOR, location: { country: "AU", street: leaked } };
    const text = page({ fields: { cursor: "CURSOR", has_more: false, items: [event] } });
    const message = unwrapErr(readOnepasswordAuditPage({ text })).message;

    expect(text).toContain(leaked);
    expect(message).toBe(`${REFUSED} new field "items[0].location.street"`);
    expect(message).not.toContain(leaked);
  });

  it("refuses a body that is not JSON", () => {
    expect(unwrapErr(readOnepasswordAuditPage({ text: "<html>" })).code).toBe("BOUNDARY_NOT_JSON");
  });
});
