/**
 * What the KnowBe4 projectors keep: allowlisted fields only. Each excluded field is fed a sentinel, the input is
 * asserted to carry it, and the projection is asserted not to — so an absence is a witness, not silence.
 */
import { describe, expect, it } from "vitest";

import {
  projectAccount,
  projectEnrollments,
  projectGroupMembers,
  projectGroups,
  projectRecipients,
  projectTrainingCampaigns,
  projectUsers,
} from "../../../../atlas/knowbe4/fill/project.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const SENTINEL = "SENTINEL-NEVER-KEPT";

const USER_ROW = {
  custom_field_1: SENTINEL,
  department: "Engineering",
  email: "person@example.com",
  first_name: "Pat",
  groups: [10, 11],
  id: 1,
  last_name: "Lee",
  manager_email: SENTINEL,
  phone_number: SENTINEL,
  status: "active",
};

const RECIPIENT_ROW = {
  browser: SENTINEL,
  clicked_at: "2026-10-01T00:00:00.000Z",
  ip: SENTINEL,
  ip_location: SENTINEL,
  os: SENTINEL,
  recipient_id: 7,
  reported_at: null,
  user: { email: "person@example.com", first_name: "Pat", id: 1, last_name: "Lee" },
};

describe("projectUsers", () => {
  it("keeps who a person is and their groups, and never a phone, a manager or a custom field", () => {
    expect(JSON.stringify(USER_ROW)).toContain(SENTINEL);
    const page = unwrap(projectUsers({ body: [USER_ROW], parentId: null }));
    expect(page.rowCount).toBe(1);
    expect(page.items[0]!.providerId).toBe("1");
    expect(page.items[0]!.detail).toEqual({
      archivedAt: null,
      currentRiskScore: null,
      department: "Engineering",
      email: "person@example.com",
      employeeNumber: null,
      family: "/v1/users",
      firstName: "Pat",
      groupIds: ["10", "11"],
      jobTitle: null,
      joinedOn: null,
      lastName: "Lee",
      phishPronePercentage: null,
      status: "active",
    });
    expect(JSON.stringify(page)).not.toContain(SENTINEL);
  });

  it("reads a user whose groups KnowBe4 left out as membership unknown, never as in no groups", () => {
    const { groups: _groups, ...groupless } = USER_ROW;
    expect([
      unwrap(projectUsers({ body: [groupless], parentId: null })).items[0]!.detail["groupIds"],
      unwrap(projectUsers({ body: [{ ...USER_ROW, groups: [] }], parentId: null })).items[0]!.detail["groupIds"],
    ]).toEqual([null, []]);
  });

  it("refuses a row carrying a field the spec never declared, rather than guessing at it", () => {
    expect(unwrapErr(projectUsers({ body: [{ ...USER_ROW, new_field: 1 }], parentId: null })).code).toBe(
      "BOUNDARY_SHAPE_CHANGED",
    );
  });
});

describe("projectGroupMembers", () => {
  it("keys one membership edge per group and person, from the call's parent", () => {
    const page = unwrap(projectGroupMembers({ body: [USER_ROW], parentId: "10" }));
    expect(page.items).toEqual([
      {
        detail: {
          email: "person@example.com",
          family: "/v1/groups/{id}/members",
          groupId: "10",
          status: "active",
          userId: "1",
        },
        providerId: "10:1",
      },
    ]);
  });

  it("refuses a page projected with no parent — a runner defect, never a provider answer", () => {
    expect(unwrapErr(projectGroupMembers({ body: [USER_ROW], parentId: null })).code).toBe("PARENT_MISSING");
  });
});

describe("projectRecipients", () => {
  it("keeps the outcome timestamps and never the IP, location, browser or OS", () => {
    expect(JSON.stringify(RECIPIENT_ROW)).toContain(SENTINEL);
    const page = unwrap(projectRecipients({ body: [RECIPIENT_ROW], parentId: "300" }));
    expect(page.items[0]!.providerId).toBe("300:7");
    expect(page.items[0]!.detail["clickedAt"]).toBe("2026-10-01T00:00:00.000Z");
    expect(page.items[0]!.detail["testId"]).toBe("300");
    expect(JSON.stringify(page)).not.toContain(SENTINEL);
  });
});

describe("projectEnrollments", () => {
  it("keeps the assignment's status and dates with no due date, and never time spent", () => {
    const row = {
      campaign_id: 55,
      completion_date: null,
      enrollment_id: 900,
      module_name: "Security Awareness 2026",
      status: "Past Due",
      time_spent: SENTINEL,
      user: { email: "person@example.com", id: 1 },
    };
    expect(JSON.stringify(row)).toContain(SENTINEL);
    const detail = unwrap(projectEnrollments({ body: [row], parentId: null })).items[0]!.detail;
    expect([detail["campaignId"], detail["status"], detail["userId"], detail["completionDate"]]).toEqual([
      "55",
      "Past Due",
      "1",
      null,
    ]);
    expect(Object.keys(detail).filter((key) => key.toLowerCase().includes("due"))).toEqual([]);
    expect(JSON.stringify(detail)).not.toContain(SENTINEL);
  });

  it("refuses an enrolment with no status, or naming neither a user id nor an email", () => {
    const row = { enrollment_id: 901, status: "Not Started", user: { email: "person@example.com", id: 1 } };
    const { status: _status, ...statusless } = row;
    const unowned = {
      code: "OWNER_MISSING",
      message: "/v1/training/enrollments row 901 names neither a user id nor an email",
    };
    expect([
      unwrapErr(projectEnrollments({ body: [statusless], parentId: null })).code,
      unwrapErr(projectEnrollments({ body: [{ ...row, status: "" }], parentId: null })).code,
      unwrapErr(projectEnrollments({ body: [{ ...row, user: { email: "", id: null } }], parentId: null })),
      unwrapErr(projectEnrollments({ body: [{ ...row, user: { email: " \t", id: null } }], parentId: null })),
    ]).toEqual(["BOUNDARY_SHAPE_CHANGED", "BOUNDARY_SHAPE_CHANGED", unowned, unowned]);
  });

  it("reads an enrolment carrying a Show Scores score, and never keeps the score", () => {
    const row = { enrollment_id: 902, score: 87, status: "Passed", user: { id: 1 } };
    const detail = unwrap(projectEnrollments({ body: [row], parentId: null })).items[0]!.detail;
    expect([detail["status"], Object.values(detail).includes(87)]).toEqual(["Passed", false]);
  });
});

describe("projectRecipients ownership", () => {
  it("refuses a recipient naming neither a user id nor an email", () => {
    expect(
      unwrapErr(projectRecipients({ body: [{ recipient_id: 8, user: { email: null } }], parentId: "300" })),
    ).toEqual({
      code: "OWNER_MISSING",
      message: "/v1/phishing/security_tests/{id}/recipients row 8 names neither a user id nor an email",
    });
  });
});

describe("projectGroups", () => {
  it("refuses a group with no member_count, which its member list is held to, or with no name", () => {
    expect([
      unwrapErr(projectGroups({ body: [{ id: 10, name: "Everyone" }], parentId: null })).code,
      unwrapErr(projectGroups({ body: [{ id: 10, member_count: 4, name: "" }], parentId: null })).code,
    ]).toEqual(["BOUNDARY_SHAPE_CHANGED", "BOUNDARY_SHAPE_CHANGED"]);
  });
});

describe("projectTrainingCampaigns", () => {
  it("keeps each target group's name beside its id, so KnowBe4's All Users target stays nameable", () => {
    const body = [{ campaign_id: 3, groups: [{ group_id: 0, name: "All Users" }], name: "Annual" }];
    expect(unwrap(projectTrainingCampaigns({ body, parentId: null })).items[0]!.detail["targetGroups"]).toEqual([
      { groupId: "0", name: "All Users" },
    ]);
  });

  it("refuses a campaign that leaves out the groups it targets, rather than reading it as targeting nobody", () => {
    expect(
      unwrapErr(projectTrainingCampaigns({ body: [{ campaign_id: 3, name: "Annual" }], parentId: null })).code,
    ).toBe("BOUNDARY_SHAPE_CHANGED");
  });
});

describe("projectAccount", () => {
  it("keys the one account row as `account` and never keeps the admins", () => {
    const body = { admins: [{ email: SENTINEL }], name: "Example Co", subscription_level: "Diamond" };
    expect(JSON.stringify(body)).toContain(SENTINEL);
    const page = unwrap(projectAccount({ body, parentId: null }));
    expect(page.items.map((item) => [item.providerId, item.detail["subscriptionLevel"]])).toEqual([
      ["account", "Diamond"],
    ]);
    expect(JSON.stringify(page)).not.toContain(SENTINEL);
  });
});
