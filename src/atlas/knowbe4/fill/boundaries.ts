/**
 * What each path the sync calls is allowed to answer — one strict boundary per endpoint, built from the
 * response schemas in KnowBe4's first-party OpenAPI document (`descriptor.ts` § `KNOWBE4_REPORTING_SPEC`,
 * sha256-pinned).
 *
 * Every key the document declares is declared here, because a strict object refuses a key it was not told
 * about and that refusal is the point: a field KnowBe4 adds, renames or retypes fails that one call with the
 * field named, instead of reading as success. A key the projection never keeps is declared `unread`, so the
 * key set stays known without the value being trusted or kept.
 *
 * Three things the document does not settle, and how each is read until a credentialed sync settles it:
 *
 * - **Nullability.** The document's own examples put `null` in fields typed `string`, so every non-id value is
 *   `nullable().optional()`. An id is required: an entity with no id cannot be stored, and a response without
 *   one is the shape change worth failing on.
 * - **Numbers.** Several fields are typed `integer` with `format: float` and a decimal example (risk scores,
 *   phish-prone percentages), so every number is `z.number()`, never `.int()`, except an id.
 * - **Campaign content.** The schema declares the store-purchase shape and the example also shows an uploaded
 *   policy (`policy_id`, `minimum_time`, `default_language`, `published`), so one strict object declares the
 *   union of both key sets.
 *
 * The enrolment's `campaign_id`/`store_purchase_id` are documented only by the `include_*` query parameters
 * that add them; they are declared optional at the top level of the row, where the first credentialed sync
 * found them.
 */
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";

/** A declared key whose value the projection never keeps. */
const unread = z.unknown().optional();

/** A KnowBe4 numeric id. */
const id = z.number().int();

/** A string value the document's own examples show as `null`. */
const text = z.string().nullable().optional();

/** A numeric value, possibly a decimal despite an `integer` type. */
const num = z.number().nullable().optional();

/** A boolean value. */
const flag = z.boolean().nullable().optional();

/** `{ group_id, name }` — how a campaign or a test names the groups it targets. */
const groupRefWire = z.strictObject({ group_id: id, name: text });

/**
 * The groups a campaign or a test targets — REQUIRED, because the group mapping reads it, and an absent list read
 * as an empty one would say "this campaign targets nobody".
 */
const targetedGroups = z.array(groupRefWire);

/** `Account`. */
export const GET_ACCOUNT = defineBoundary({
  endpoint: "GET /v1/account",
  schema: z.strictObject({
    admins: unread,
    current_risk_score: num,
    domains: z.array(z.string()).nullable().optional(),
    name: text,
    number_of_seats: num,
    subscription_end_date: text,
    subscription_level: text,
    type: text,
  }),
});

/** `User` — returned by `/v1/users` and, per group, by `/v1/groups/{id}/members`. */
const userWire = z.strictObject({
  aliases: unread,
  archived_at: text,
  comment: unread,
  current_risk_score: num,
  custom_date_1: unread,
  custom_date_2: unread,
  custom_field_1: unread,
  custom_field_2: unread,
  custom_field_3: unread,
  custom_field_4: unread,
  department: text,
  division: unread,
  email: z.string(),
  employee_number: text,
  employee_start_date: unread,
  extension: unread,
  first_name: text,
  groups: z.array(id).nullable().optional(),
  id,
  job_title: text,
  joined_on: text,
  language: unread,
  last_name: text,
  last_sign_in: unread,
  location: unread,
  manager_email: unread,
  manager_name: unread,
  mobile_phone_number: unread,
  organization: unread,
  phish_prone_percentage: num,
  phone_number: unread,
  provisioning_guid: unread,
  provisioning_managed: unread,
  status: text,
});

/** `GET /v1/users`. */
export const LIST_USERS = defineBoundary({ endpoint: "GET /v1/users", schema: z.array(userWire) });

/** `GET /v1/groups/{id}/members` — the same user shape; the parent group is the call's, never the row's. */
export const LIST_GROUP_MEMBERS = defineBoundary({
  endpoint: "GET /v1/groups/{group_id}/members",
  schema: z.array(userWire),
});

/** `GET /v1/groups`. */
export const LIST_GROUPS = defineBoundary({
  endpoint: "GET /v1/groups",
  schema: z.array(
    z.strictObject({
      current_risk_score: num,
      group_type: text,
      id,
      // Required, not optional: it is what a group's member list is held to, so a group without one would let a
      // short member read pass as whole.
      member_count: z.number().int().nonnegative(),
      // The name is what the Vanta↔KnowBe4 mapping matches on, so a group without one fails the page.
      name: z.string().min(1),
      provisioning_guid: unread,
      status: text,
    }),
  ),
});

/** `GET /v1/phishing/campaigns`. Its embedded `psts` are the security-test list's rows in brief, never kept. */
export const LIST_PHISHING_CAMPAIGNS = defineBoundary({
  endpoint: "GET /v1/phishing/campaigns",
  schema: z.array(
    z.strictObject({
      campaign_id: id,
      create_date: text,
      difficulty_filter: unread,
      frequency: text,
      groups: targetedGroups,
      hidden: flag,
      last_phish_prone_percentage: num,
      last_run: text,
      name: text,
      psts: unread,
      psts_count: num,
      send_duration: text,
      status: text,
      track_duration: text,
    }),
  ),
});

/** `{ id, name, difficulty, type }` — the template a test or a recipient was sent. */
const templateWire = z.strictObject({ difficulty: num, id: id.nullable().optional(), name: text, type: text });

/** `GET /v1/phishing/security_tests`. */
export const LIST_SECURITY_TESTS = defineBoundary({
  endpoint: "GET /v1/phishing/security_tests",
  schema: z.array(
    z.strictObject({
      attachment_open_count: num,
      bounced_count: num,
      campaign_id: id.nullable().optional(),
      categories: unread,
      clicked_count: num,
      data_entered_count: num,
      delivered_count: num,
      duration: num,
      groups: targetedGroups,
      "landing-page": unread,
      macro_enabled_count: num,
      name: text,
      opened_count: num,
      phish_prone_percentage: num,
      pst_id: id,
      qr_code_scanned_count: num,
      replied_count: num,
      reported_count: num,
      scheduled_count: num,
      started_at: text,
      status: text,
      template: templateWire.nullable().optional(),
    }),
  ),
});

/** `GET /v1/phishing/security_tests/{pst_id}/recipients`. Device and location telemetry is declared, never kept. */
export const LIST_RECIPIENTS = defineBoundary({
  endpoint: "GET /v1/phishing/security_tests/{pst_id}/recipients",
  schema: z.array(
    z.strictObject({
      attachment_opened_at: text,
      bounced_at: text,
      browser: unread,
      browser_version: unread,
      clicked_at: text,
      data_entered_at: text,
      delivered_at: text,
      ip: unread,
      ip_location: unread,
      macro_enabled_at: text,
      opened_at: text,
      os: unread,
      pst_id: id.nullable().optional(),
      qr_code_scanned: text,
      recipient_id: id,
      replied_at: text,
      reported_at: text,
      scheduled_at: text,
      template: templateWire.nullable().optional(),
      user: z.strictObject({
        email: text,
        first_name: text,
        id: id.nullable().optional(),
        last_name: text,
        provisioning_guid: unread,
      }),
    }),
  ),
});

/** One item of a training campaign's `content` — the union of the store-purchase and uploaded-policy shapes. */
const campaignContentWire = z.strictObject({
  content_type: text,
  default_language: unread,
  description: unread,
  duration: unread,
  minimum_time: unread,
  name: text,
  policy_id: id.nullable().optional(),
  policy_url: unread,
  publish_date: unread,
  published: unread,
  publisher: unread,
  purchase_date: unread,
  retired: unread,
  retirement_date: unread,
  store_purchase_id: id.nullable().optional(),
  type: unread,
});

/** `GET /v1/training/campaigns`, read with `exclude_percentages=true`, so `completion_percentage` may be absent. */
export const LIST_TRAINING_CAMPAIGNS = defineBoundary({
  endpoint: "GET /v1/training/campaigns",
  schema: z.array(
    z.strictObject({
      allow_multiple_enrollments: flag,
      auto_enroll: flag,
      campaign_id: id,
      completion_percentage: num,
      content: z.array(campaignContentWire).nullable().optional(),
      duration_type: text,
      end_date: text,
      groups: targetedGroups,
      name: text,
      relative_duration: text,
      start_date: text,
      status: text,
    }),
  ),
});

/** `GET /v1/training/enrollments`, read with `include_campaign_id` and `include_store_purchase_id`. */
export const LIST_ENROLLMENTS = defineBoundary({
  endpoint: "GET /v1/training/enrollments",
  schema: z.array(
    z.strictObject({
      campaign_id: id.nullable().optional(),
      campaign_name: text,
      completion_date: text,
      content_type: text,
      enrollment_date: text,
      enrollment_id: id,
      module_name: text,
      policy_acknowledged: flag,
      // Present only when a campaign has Show Scores on (KnowBe4's enrolment description); never kept.
      score: unread,
      start_date: text,
      // The nag's whole claim is "this person has not completed this", so an enrolment with no status, or no way
      // to say who it belongs to, fails the page rather than publishing as a row nobody can act on.
      status: z.string().min(1),
      store_purchase_id: id.nullable().optional(),
      time_spent: unread,
      // That it names a user id or an email is checked after the read, in `projectEnrollments`.
      user: z.strictObject({
        email: text,
        employee_number: unread,
        first_name: text,
        id: id.nullable().optional(),
        last_name: text,
      }),
    }),
  ),
});

/**
 * `GET /v1/training/store_purchases`. The id is `store_purchase_id` on the wire, as the enrolment and campaign
 * content name it; the OpenAPI document spells it `store_purchased_id`, and the first credentialed sync
 * refused every row on that spelling, so the wire wins.
 */
export const LIST_STORE_PURCHASES = defineBoundary({
  endpoint: "GET /v1/training/store_purchases",
  schema: z.array(
    z.strictObject({
      content_type: text,
      description: unread,
      duration: num,
      name: text,
      policy_url: unread,
      publish_date: text,
      publisher: text,
      purchase_date: text,
      retired: flag,
      retirement_date: text,
      store_purchase_id: id,
      type: text,
    }),
  ),
});

/** `GET /v1/training/policies`. `status` is 0 draft, 1 published, 2 archived. */
export const LIST_POLICIES = defineBoundary({
  endpoint: "GET /v1/training/policies",
  schema: z.array(
    z.strictObject({
      content_type: text,
      default_language: text,
      minimum_time: num,
      name: text,
      policy_id: id,
      status: num,
    }),
  ),
});
