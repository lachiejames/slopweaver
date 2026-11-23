/**
 * What the atlas keeps from one page of each path — an ALLOWLIST per endpoint, never the row itself.
 *
 * Every reader parses the page through its endpoint's strict boundary first, then copies the named fields it
 * keeps into a fresh object. Nothing is spread from the wire, so a field nobody chose cannot reach the store by
 * riding along: a recipient contributes when they were sent, opened, clicked and reported and never their IP,
 * browser or OS; a user contributes who they are and which groups they sit in and never their phone, manager
 * or custom fields. The descriptor's `names-not-values` exclusion is this file's contract.
 *
 * A per-parent path (a group's members, a test's recipients) is projected with the parent's id from the CALL,
 * because KnowBe4's row does not name its parent; the entity's provider id is the pair, so one person in two
 * groups is two membership edges rather than one overwritten row.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import type { Result } from "#lib/result.js";
import {
  GET_ACCOUNT,
  LIST_ENROLLMENTS,
  LIST_GROUP_MEMBERS,
  LIST_GROUPS,
  LIST_PHISHING_CAMPAIGNS,
  LIST_POLICIES,
  LIST_RECIPIENTS,
  LIST_SECURITY_TESTS,
  LIST_STORE_PURCHASES,
  LIST_TRAINING_CAMPAIGNS,
  LIST_USERS,
} from "./boundaries.js";
import {
  campaignContent,
  type Knowbe4ProjectError,
  type Knowbe4ProjectedPage,
  parentMissing,
  projected,
  rowsOwned,
  targetGroups,
} from "./projectShapes.js";

/** What every projector takes: the body, and the parent id a per-parent call was made under. */
interface ProjectInput {
  readonly body: unknown;
  readonly parentId: string | null;
}

/**
 * `GET /v1/account`: name, tier, seats, domains and the aggregate risk score — never the admins.
 *
 * @param body the response body, untyped until the boundary reads it
 * @returns the one projected item, or the boundary's refusal
 */
export function projectAccount({ body }: ProjectInput): Result<Knowbe4ProjectedPage, Knowbe4ProjectError> {
  return GET_ACCOUNT.parse({ value: body }).map((account) => ({
    items: [
      {
        detail: projected({
          detail: {
            currentRiskScore: unsetFieldAsNull({ key: "current_risk_score", record: account }),
            domains: unsetFieldAsNull({ key: "domains", record: account }),
            family: "/v1/account",
            name: unsetFieldAsNull({ key: "name", record: account }),
            numberOfSeats: unsetFieldAsNull({ key: "number_of_seats", record: account }),
            subscriptionEndDate: unsetFieldAsNull({ key: "subscription_end_date", record: account }),
            subscriptionLevel: unsetFieldAsNull({ key: "subscription_level", record: account }),
            type: unsetFieldAsNull({ key: "type", record: account }),
          },
        }),
        // One account per token: the row has no id of its own, so it is keyed by the only one it can be.
        providerId: "account",
      },
    ],
    rowCount: 1,
  }));
}

/**
 * `GET /v1/users`: who each person is, their status and their groups.
 *
 * @param body the response body, untyped until the boundary reads it
 * @returns the projected page, or the boundary's refusal
 */
export function projectUsers({ body }: ProjectInput): Result<Knowbe4ProjectedPage, Knowbe4ProjectError> {
  return LIST_USERS.parse({ value: body }).map((users) => ({
    items: users.map((user) => ({
      detail: projected({
        detail: {
          archivedAt: unsetFieldAsNull({ key: "archived_at", record: user }),
          currentRiskScore: unsetFieldAsNull({ key: "current_risk_score", record: user }),
          department: unsetFieldAsNull({ key: "department", record: user }),
          email: user.email,
          employeeNumber: unsetFieldAsNull({ key: "employee_number", record: user }),
          family: "/v1/users",
          firstName: unsetFieldAsNull({ key: "first_name", record: user }),
          // Absent is UNKNOWN, never "in no groups": the spec does not require the field (p3).
          groupIds: user.groups == null ? null : user.groups.map(String),
          jobTitle: unsetFieldAsNull({ key: "job_title", record: user }),
          joinedOn: unsetFieldAsNull({ key: "joined_on", record: user }),
          lastName: unsetFieldAsNull({ key: "last_name", record: user }),
          phishPronePercentage: unsetFieldAsNull({ key: "phish_prone_percentage", record: user }),
          status: unsetFieldAsNull({ key: "status", record: user }),
        },
      }),
      providerId: String(user.id),
    })),
    rowCount: users.length,
  }));
}

/**
 * `GET /v1/groups`: name, type, size and status.
 *
 * @param body the response body, untyped until the boundary reads it
 * @returns the projected page, or the boundary's refusal
 */
export function projectGroups({ body }: ProjectInput): Result<Knowbe4ProjectedPage, Knowbe4ProjectError> {
  return LIST_GROUPS.parse({ value: body }).map((groups) => ({
    items: groups.map((group) => ({
      detail: projected({
        detail: {
          currentRiskScore: unsetFieldAsNull({ key: "current_risk_score", record: group }),
          family: "/v1/groups",
          groupType: unsetFieldAsNull({ key: "group_type", record: group }),
          memberCount: group.member_count,
          name: group.name,
          status: unsetFieldAsNull({ key: "status", record: group }),
        },
      }),
      providerId: String(group.id),
    })),
    rowCount: groups.length,
  }));
}

/**
 * `GET /v1/groups/{id}/members`: one membership edge per person, keyed `<group>:<user>`.
 *
 * @param body the response body, untyped until the boundary reads it
 * @param parentId the group the call was made under
 * @returns the projected page, or the boundary's refusal
 */
export function projectGroupMembers({
  body,
  parentId,
}: ProjectInput): Result<Knowbe4ProjectedPage, Knowbe4ProjectError> {
  if (parentId === null) {
    return parentMissing({ path: "/v1/groups/{id}/members" });
  }
  return LIST_GROUP_MEMBERS.parse({ value: body }).map((members) => ({
    items: members.map((member) => ({
      detail: projected({
        detail: {
          email: member.email,
          family: "/v1/groups/{id}/members",
          groupId: parentId,
          // Kept because the group's `member_count` counts active members only, and the list returns archived ones.
          status: unsetFieldAsNull({ key: "status", record: member }),
          userId: String(member.id),
        },
      }),
      providerId: `${parentId}:${String(member.id)}`,
    })),
    rowCount: members.length,
  }));
}

/**
 * `GET /v1/training/campaigns`: which groups a campaign enrols, in what content, on what timing.
 *
 * @param body the response body, untyped until the boundary reads it
 * @returns the projected page, or the boundary's refusal
 */
export function projectTrainingCampaigns({ body }: ProjectInput): Result<Knowbe4ProjectedPage, Knowbe4ProjectError> {
  return LIST_TRAINING_CAMPAIGNS.parse({ value: body }).map((campaigns) => ({
    items: campaigns.map((campaign) => ({
      detail: projected({
        detail: {
          autoEnroll: unsetFieldAsNull({ key: "auto_enroll", record: campaign }),
          completionPercentage: unsetFieldAsNull({ key: "completion_percentage", record: campaign }),
          content: campaignContent({ content: campaign.content }),
          durationType: unsetFieldAsNull({ key: "duration_type", record: campaign }),
          endDate: unsetFieldAsNull({ key: "end_date", record: campaign }),
          family: "/v1/training/campaigns",
          name: unsetFieldAsNull({ key: "name", record: campaign }),
          relativeDuration: unsetFieldAsNull({ key: "relative_duration", record: campaign }),
          startDate: unsetFieldAsNull({ key: "start_date", record: campaign }),
          status: unsetFieldAsNull({ key: "status", record: campaign }),
          targetGroups: targetGroups({ groups: campaign.groups }),
        },
      }),
      providerId: String(campaign.campaign_id),
    })),
    rowCount: campaigns.length,
  }));
}

/**
 * `GET /v1/training/store_purchases`: the modules this account holds — metadata only, never a description.
 *
 * @param body the response body, untyped until the boundary reads it
 * @returns the projected page, or the boundary's refusal
 */
export function projectStorePurchases({ body }: ProjectInput): Result<Knowbe4ProjectedPage, Knowbe4ProjectError> {
  return LIST_STORE_PURCHASES.parse({ value: body }).map((purchases) => ({
    items: purchases.map((purchase) => ({
      detail: projected({
        detail: {
          contentType: unsetFieldAsNull({ key: "content_type", record: purchase }),
          durationMinutes: unsetFieldAsNull({ key: "duration", record: purchase }),
          family: "/v1/training/store_purchases",
          name: unsetFieldAsNull({ key: "name", record: purchase }),
          publishDate: unsetFieldAsNull({ key: "publish_date", record: purchase }),
          publisher: unsetFieldAsNull({ key: "publisher", record: purchase }),
          purchaseDate: unsetFieldAsNull({ key: "purchase_date", record: purchase }),
          retired: unsetFieldAsNull({ key: "retired", record: purchase }),
          retirementDate: unsetFieldAsNull({ key: "retirement_date", record: purchase }),
          type: unsetFieldAsNull({ key: "type", record: purchase }),
        },
      }),
      providerId: String(purchase.store_purchase_id),
    })),
    rowCount: purchases.length,
  }));
}

/**
 * `GET /v1/training/policies`: the uploaded policies people acknowledge.
 *
 * @param body the response body, untyped until the boundary reads it
 * @returns the projected page, or the boundary's refusal
 */
export function projectPolicies({ body }: ProjectInput): Result<Knowbe4ProjectedPage, Knowbe4ProjectError> {
  return LIST_POLICIES.parse({ value: body }).map((policies) => ({
    items: policies.map((policy) => ({
      detail: projected({
        detail: {
          contentType: unsetFieldAsNull({ key: "content_type", record: policy }),
          defaultLanguage: unsetFieldAsNull({ key: "default_language", record: policy }),
          family: "/v1/training/policies",
          minimumTimeMinutes: unsetFieldAsNull({ key: "minimum_time", record: policy }),
          name: unsetFieldAsNull({ key: "name", record: policy }),
          status: unsetFieldAsNull({ key: "status", record: policy }),
        },
      }),
      providerId: String(policy.policy_id),
    })),
    rowCount: policies.length,
  }));
}

/**
 * `GET /v1/training/enrollments`: one person's one assignment and where it stands — what a update prompt reads.
 *
 * No due date: the Reporting API publishes none (see the descriptor's `claim-not-made`), so `status` — which
 * includes KnowBe4's own `Past Due` — is the authority, and the campaign carries its timing.
 *
 * @param body the response body, untyped until the boundary reads it
 * @returns the projected page, or the boundary's refusal
 */
export function projectEnrollments({ body }: ProjectInput): Result<Knowbe4ProjectedPage, Knowbe4ProjectError> {
  return LIST_ENROLLMENTS.parse({ value: body })
    .andThen((rows) => rowsOwned({ path: "/v1/training/enrollments", rowId: (row) => row.enrollment_id, rows }))
    .map((enrollments) => ({
      items: enrollments.map((enrollment) => ({
        detail: projected({
          detail: {
            campaignId: enrollment.campaign_id == null ? null : String(enrollment.campaign_id),
            campaignName: unsetFieldAsNull({ key: "campaign_name", record: enrollment }),
            completionDate: unsetFieldAsNull({ key: "completion_date", record: enrollment }),
            contentType: unsetFieldAsNull({ key: "content_type", record: enrollment }),
            enrollmentDate: unsetFieldAsNull({ key: "enrollment_date", record: enrollment }),
            family: "/v1/training/enrollments",
            moduleName: unsetFieldAsNull({ key: "module_name", record: enrollment }),
            policyAcknowledged: unsetFieldAsNull({ key: "policy_acknowledged", record: enrollment }),
            startDate: unsetFieldAsNull({ key: "start_date", record: enrollment }),
            status: enrollment.status,
            storePurchaseId: enrollment.store_purchase_id == null ? null : String(enrollment.store_purchase_id),
            userEmail: unsetFieldAsNull({ key: "email", record: enrollment.user }),
            userId: enrollment.user.id == null ? null : String(enrollment.user.id),
          },
        }),
        providerId: String(enrollment.enrollment_id),
      })),
      rowCount: enrollments.length,
    }));
}

/**
 * `GET /v1/phishing/campaigns`: which groups a phishing campaign targets, and how it runs.
 *
 * @param body the response body, untyped until the boundary reads it
 * @returns the projected page, or the boundary's refusal
 */
export function projectPhishingCampaigns({ body }: ProjectInput): Result<Knowbe4ProjectedPage, Knowbe4ProjectError> {
  return LIST_PHISHING_CAMPAIGNS.parse({ value: body }).map((campaigns) => ({
    items: campaigns.map((campaign) => ({
      detail: projected({
        detail: {
          createDate: unsetFieldAsNull({ key: "create_date", record: campaign }),
          family: "/v1/phishing/campaigns",
          frequency: unsetFieldAsNull({ key: "frequency", record: campaign }),
          hidden: unsetFieldAsNull({ key: "hidden", record: campaign }),
          lastPhishPronePercentage: unsetFieldAsNull({ key: "last_phish_prone_percentage", record: campaign }),
          lastRun: unsetFieldAsNull({ key: "last_run", record: campaign }),
          name: unsetFieldAsNull({ key: "name", record: campaign }),
          sendDuration: unsetFieldAsNull({ key: "send_duration", record: campaign }),
          status: unsetFieldAsNull({ key: "status", record: campaign }),
          targetGroups: targetGroups({ groups: campaign.groups }),
          testCount: unsetFieldAsNull({ key: "psts_count", record: campaign }),
          trackDuration: unsetFieldAsNull({ key: "track_duration", record: campaign }),
        },
      }),
      providerId: String(campaign.campaign_id),
    })),
    rowCount: campaigns.length,
  }));
}

/**
 * `GET /v1/phishing/security_tests`: each test run and its aggregate outcome counts.
 *
 * @param body the response body, untyped until the boundary reads it
 * @returns the projected page, or the boundary's refusal
 */
export function projectSecurityTests({ body }: ProjectInput): Result<Knowbe4ProjectedPage, Knowbe4ProjectError> {
  return LIST_SECURITY_TESTS.parse({ value: body }).map((tests) => ({
    items: tests.map((test) => ({
      detail: projected({
        detail: {
          campaignId: test.campaign_id == null ? null : String(test.campaign_id),
          counts: {
            attachmentOpened: unsetFieldAsNull({ key: "attachment_open_count", record: test }),
            bounced: unsetFieldAsNull({ key: "bounced_count", record: test }),
            clicked: unsetFieldAsNull({ key: "clicked_count", record: test }),
            dataEntered: unsetFieldAsNull({ key: "data_entered_count", record: test }),
            delivered: unsetFieldAsNull({ key: "delivered_count", record: test }),
            macroEnabled: unsetFieldAsNull({ key: "macro_enabled_count", record: test }),
            opened: unsetFieldAsNull({ key: "opened_count", record: test }),
            qrCodeScanned: unsetFieldAsNull({ key: "qr_code_scanned_count", record: test }),
            replied: unsetFieldAsNull({ key: "replied_count", record: test }),
            reported: unsetFieldAsNull({ key: "reported_count", record: test }),
            scheduled: unsetFieldAsNull({ key: "scheduled_count", record: test }),
          },
          durationDays: unsetFieldAsNull({ key: "duration", record: test }),
          family: "/v1/phishing/security_tests",
          name: unsetFieldAsNull({ key: "name", record: test }),
          phishPronePercentage: unsetFieldAsNull({ key: "phish_prone_percentage", record: test }),
          startedAt: unsetFieldAsNull({ key: "started_at", record: test }),
          status: unsetFieldAsNull({ key: "status", record: test }),
          targetGroups: targetGroups({ groups: test.groups }),
          templateName: unsetFieldAsNull({ key: "name", record: test.template }),
        },
      }),
      providerId: String(test.pst_id),
    })),
    rowCount: tests.length,
  }));
}

/**
 * `GET /v1/phishing/security_tests/{id}/recipients`: how each person did on one test — the outcome timestamps,
 * never their IP, location, browser or OS.
 *
 * @param body the response body, untyped until the boundary reads it
 * @param parentId the test the call was made under
 * @returns the projected page, or the boundary's refusal
 */
export function projectRecipients({ body, parentId }: ProjectInput): Result<Knowbe4ProjectedPage, Knowbe4ProjectError> {
  const path = "/v1/phishing/security_tests/{id}/recipients";
  if (parentId === null) {
    return parentMissing({ path });
  }
  const read = LIST_RECIPIENTS.parse({ value: body });
  return read
    .andThen((rows) => rowsOwned({ path, rowId: (row) => row.recipient_id, rows }))
    .map((recipients) => ({
      items: recipients.map((recipient) => ({
        detail: projected({
          detail: {
            attachmentOpenedAt: unsetFieldAsNull({ key: "attachment_opened_at", record: recipient }),
            bouncedAt: unsetFieldAsNull({ key: "bounced_at", record: recipient }),
            clickedAt: unsetFieldAsNull({ key: "clicked_at", record: recipient }),
            dataEnteredAt: unsetFieldAsNull({ key: "data_entered_at", record: recipient }),
            deliveredAt: unsetFieldAsNull({ key: "delivered_at", record: recipient }),
            family: "/v1/phishing/security_tests/{id}/recipients",
            macroEnabledAt: unsetFieldAsNull({ key: "macro_enabled_at", record: recipient }),
            openedAt: unsetFieldAsNull({ key: "opened_at", record: recipient }),
            qrCodeScannedAt: unsetFieldAsNull({ key: "qr_code_scanned", record: recipient }),
            repliedAt: unsetFieldAsNull({ key: "replied_at", record: recipient }),
            reportedAt: unsetFieldAsNull({ key: "reported_at", record: recipient }),
            scheduledAt: unsetFieldAsNull({ key: "scheduled_at", record: recipient }),
            templateName: unsetFieldAsNull({ key: "name", record: recipient.template }),
            testId: parentId,
            userEmail: unsetFieldAsNull({ key: "email", record: recipient.user }),
            userId: recipient.user.id == null ? null : String(recipient.user.id),
          },
        }),
        providerId: `${parentId}:${String(recipient.recipient_id)}`,
      })),
      rowCount: recipients.length,
    }));
}
