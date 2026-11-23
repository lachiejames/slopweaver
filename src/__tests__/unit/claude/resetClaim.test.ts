/**
 * `claude reset`'s pure half: reading the `cedar_ember` status block, choosing the grant a claim spends, whether the
 * provider would honour it now, the request and answer, and which earlier attempt a resend settles.
 *
 * The property that costs a reset when it is wrong is the attempt judgement: an open intent must be resent under
 * its own request id while the status shows it unsettled, and CLOSED once the status shows the spend landed, so a
 * lost answer is never replayed into a second spend.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import {
  type ClaudeResetIntentRow,
  type ClaudeResetJournalRow,
  claimAttemptOverReason,
  openClaimAttempt,
  parseClaudeResetJournalLine,
} from "../../../claude/resetAttempt.js";
import {
  chooseResetGrant,
  freshClaimRefusal,
  readClaimAnswer,
  resetClaimBody,
  resetClaimUrl,
} from "../../../claude/resetClaim.js";
import { ClaudeResetErrors } from "../../../claude/resetErrors.js";
import { type ClaudeResetBlock, type ClaudeResetGrant, parseResetStatus } from "../../../claude/resetStatus.js";

const NOW = "2026-09-30T08:00:00.000Z";
const ORG = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";

const GRANT: ClaudeResetGrant = {
  clears: ["seven_day"],
  id: "welcome-1",
  paused: false,
  resetsLeft: 2,
  usableNow: true,
  useRequiresLimit: true,
};

const AT_LIMIT: ClaudeResetBlock = {
  atLimit: true,
  eligible: true,
  exhausted: ["seven_day"],
  grants: [GRANT],
  nextGrantId: "welcome-1",
};

const INTENT: ClaudeResetIntentRow = {
  alias: "plan-five",
  atIso: NOW,
  atLimitAtIntent: true,
  grantId: "welcome-1",
  kind: "intent",
  requestId: "req-1",
  resetsLeftAtIntent: 2,
  v: 1,
};

describe("parseResetStatus", () => {
  it("reads the block, converting epoch seconds and keeping a next grant only when it is listed", () => {
    const bodyText = JSON.stringify({
      cedar_ember: {
        at_limit: true,
        cooldown_until: null,
        eligible: true,
        exhausted: ["seven_day"],
        event_props: { source: "usage" },
        grants: [
          {
            arm: "control",
            clears: ["seven_day"],
            ends_at: 1790000000,
            id: "welcome-1",
            label: "Welcome",
            percent_used: 40,
            resets_left: 2,
            resets_total: 3,
            usable_now: true,
            use_requires_limit: false,
          },
        ],
        next_grant_id: "welcome-1",
        weekly_resets_at: "2026-10-01T11:00:00Z",
      },
      five_hour: { utilization: 12 },
    });

    expect(unwrap(parseResetStatus({ bodyText }))).toEqual({
      block: {
        atLimit: true,
        eligible: true,
        exhausted: ["seven_day"],
        grants: [
          {
            clears: ["seven_day"],
            endsAtIso: "2026-09-21T14:13:20.000Z",
            id: "welcome-1",
            label: "Welcome",
            paused: false,
            resetsLeft: 2,
            resetsTotal: 3,
            usableNow: true,
            useRequiresLimit: false,
          },
        ],
        nextGrantId: "welcome-1",
        weeklyResetsAtIso: "2026-10-01T11:00:00Z",
      },
    });
  });

  it("reads an absent use_requires_limit as true, and drops a next grant the read does not list", () => {
    const bodyText = JSON.stringify({
      cedar_ember: { eligible: true, grants: [{ id: "g2", resets_left: 1 }], next_grant_id: "gone" },
    });

    const status = unwrap(parseResetStatus({ bodyText }));

    expect(status.block.grants.map((grant) => [grant.id, grant.useRequiresLimit])).toEqual([["g2", true]]);
    expect(status.block.nextGrantId).toBeUndefined();
  });

  it("refuses the whole answer over one malformed grant, naming it, rather than dropping it", () => {
    const bodyText = JSON.stringify({
      cedar_ember: {
        eligible: true,
        grants: [
          { id: "BAD ID", resets_left: 1 },
          { id: "g2", resets_left: 1 },
        ],
      },
    });

    expect(unwrapErr(parseResetStatus({ bodyText })).message).toContain('field "cedar_ember.grants[0].id" changed: ');
  });

  it("names a field the provider added or renamed instead of reading around it", () => {
    const added = JSON.stringify({ cedar_ember: { eligible: true, tier: "max" } });
    const renamed = JSON.stringify({ cedar_ember: { eligible: true, grants: [{ id: "g2", resetsLeft: 1 }] } });

    expect(unwrapErr(parseResetStatus({ bodyText: added })).message).toBe(
      'the reset status could not be read: GET /api/oauth/usage?cedar_ember=1 answered a shape this version does not read — refused, not guessed: new field "cedar_ember.tier"',
    );
    expect(unwrapErr(parseResetStatus({ bodyText: renamed })).message).toContain(
      'field "cedar_ember.grants[0].resets_left" renamed to "cedar_ember.grants[0].resetsLeft"?',
    );
  });

  it("reads the newer answer, whose new siblings and paused_held are declared rather than refused", () => {
    const bodyText = JSON.stringify({
      amber_cistern_offer: null,
      cedar_ember: { eligible: true, grants: [{ id: "g2", resets_left: 1 }], paused_held: false },
      granite_teacup: { arm: "control" },
      pace: 0.4,
      promo_credits: null,
      starry_waterfall: { wall: false },
      weekly_scoped_shares: [{ scope: "fable", share: 0.2 }],
    });

    expect(unwrap(parseResetStatus({ bodyText })).block.grants.map((grant) => grant.resetsLeft)).toEqual([1]);
  });

  it("names an absent block as its own error, never as not eligible", () => {
    expect(unwrapErr(parseResetStatus({ bodyText: '{"five_hour":{}}' })).code).toBe("RESET_BLOCK_ABSENT");
  });

  it("refuses a body that is not JSON", () => {
    expect(unwrapErr(parseResetStatus({ bodyText: "<html>" })).message).toBe(
      "the reset status could not be read: GET /api/oauth/usage?cedar_ember=1 answered a body that is not JSON",
    );
  });

  it("refuses a body that is not an object, and a block that is not the shape it reads", () => {
    expect(unwrapErr(parseResetStatus({ bodyText: "[1]" })).message).toContain('field "(body)" changed: ');
    expect(unwrapErr(parseResetStatus({ bodyText: '{"cedar_ember":{"eligible":"yes"}}' })).message).toContain(
      'field "cedar_ember.eligible" changed: ',
    );
  });

  it("keeps an ineligible reason and a cooldown, and drops a null reason", () => {
    const cooling = unwrap(
      parseResetStatus({
        bodyText: JSON.stringify({
          cedar_ember: { cooldown_until: "2026-09-30T09:00:00Z", eligible: false, ineligible_reason: "team_plan" },
        }),
      }),
    );
    const noReason = unwrap(
      parseResetStatus({ bodyText: '{"cedar_ember":{"eligible":false,"ineligible_reason":null}}' }),
    );

    expect(cooling.block.ineligibleReason).toBe("team_plan");
    expect(cooling.block.cooldownUntilIso).toBe("2026-09-30T09:00:00Z");
    expect(noReason.block.ineligibleReason).toBeUndefined();
  });
});

describe("the claim request", () => {
  it("builds the organisation's claim URL and the provider's own body", () => {
    expect(unwrap(resetClaimUrl({ organizationId: ORG }))).toBe(
      `https://api.anthropic.com/api/organizations/${ORG}/reset_rate_limits`,
    );
    expect(JSON.parse(unwrap(resetClaimBody({ grantId: "welcome-1", requestId: "req-1" })))).toEqual({
      grant_id: "welcome-1",
      program: "cedar_ember",
      request_id: "req-1",
    });
  });

  it("refuses an organisation id that is not a UUID, and a request id the provider would refuse", () => {
    expect(unwrapErr(resetClaimUrl({ organizationId: "../x" })).code).toBe("STATUS_UNREADABLE");
    expect(unwrapErr(resetClaimBody({ grantId: "g", requestId: "has space" })).code).toBe("STATUS_UNREADABLE");
  });
});

describe("readClaimAnswer", () => {
  it("reads a reset, converting its time fields", () => {
    const bodyText = JSON.stringify({
      cleared: ["seven_day"],
      cooldown_until: 1790000000,
      resets_left: 1,
      result: "reset",
    });

    expect(unwrap(readClaimAnswer({ bodyText, requestId: "req-1", status: 200 }))).toEqual({
      cleared: ["seven_day"],
      cooldownUntilIso: "2026-09-21T14:13:20.000Z",
      resetsLeft: 1,
      result: "reset",
    });
  });

  it("reads a 401 or 403 as a refused call, which spent nothing", () => {
    expect(unwrapErr(readClaimAnswer({ bodyText: "", requestId: "req-1", status: 403 }))).toEqual(
      ClaudeResetErrors.claimRefused({ status: 403 }),
    );
  });

  it("reads a throttle, a 5xx or an unknown result as an unknown outcome carrying the request id", () => {
    expect(unwrapErr(readClaimAnswer({ bodyText: "", requestId: "req-1", status: 429 }))).toEqual(
      ClaudeResetErrors.outcomeUnknown({ reason: "HTTP 429", requestId: "req-1" }),
    );
    expect(unwrapErr(readClaimAnswer({ bodyText: '{"result":"maybe"}', requestId: "req-1", status: 200 })).code).toBe(
      "OUTCOME_UNKNOWN",
    );
  });

  it("reads a 2xx whose body is not JSON as an unknown outcome, never as a reset", () => {
    expect(unwrapErr(readClaimAnswer({ bodyText: "<html>", requestId: "req-1", status: 200 }))).toEqual(
      ClaudeResetErrors.outcomeUnknown({
        reason: "POST /api/organizations/<org>/reset_rate_limits answered a body that is not JSON",
        requestId: "req-1",
      }),
    );
  });

  it("reads a reset carrying a field this version does not declare as an unknown outcome naming it", () => {
    const bodyText = JSON.stringify({ cleared: ["seven_day"], result: "reset", spent_at: "2026-09-30T08:00:00Z" });

    expect(unwrapErr(readClaimAnswer({ bodyText, requestId: "req-1", status: 200 }))).toEqual(
      ClaudeResetErrors.outcomeUnknown({
        reason:
          'POST /api/organizations/<org>/reset_rate_limits answered a shape this version does not read — refused, not guessed: new field "spent_at"',
        requestId: "req-1",
      }),
    );
  });
});

describe("chooseResetGrant", () => {
  it("takes the provider's next grant", () => {
    expect(unwrap(chooseResetGrant({ block: AT_LIMIT, requestedGrant: undefined })).id).toBe("welcome-1");
  });

  it("takes the first usable grant with a reset left when no next grant is named", () => {
    const spent = { ...GRANT, id: "spent", resetsLeft: 0 };
    const block = { atLimit: true, eligible: true, exhausted: [], grants: [spent, { ...GRANT, id: "g2" }] };

    expect(unwrap(chooseResetGrant({ block, requestedGrant: undefined })).id).toBe("g2");
  });

  it("refuses an ineligible account, and a --grant the read does not list", () => {
    const ineligible = { ...AT_LIMIT, eligible: false, ineligibleReason: "team_plan" };

    expect(unwrapErr(chooseResetGrant({ block: ineligible, requestedGrant: undefined })).message).toBe(
      "the account is not eligible for a free reset (team_plan)",
    );
    expect(unwrapErr(chooseResetGrant({ block: AT_LIMIT, requestedGrant: "nope" })).code).toBe("GRANT_NOT_HELD");
  });

  it("refuses when no grant is usable now with a reset left", () => {
    const block = { atLimit: true, eligible: true, exhausted: [], grants: [{ ...GRANT, resetsLeft: 0 }] };

    expect(unwrapErr(chooseResetGrant({ block, requestedGrant: undefined })).code).toBe("NO_USABLE_GRANT");
  });
});

describe("freshClaimRefusal", () => {
  it("honours a usable grant at a limit", () => {
    expect(freshClaimRefusal({ block: AT_LIMIT, grant: GRANT, nowIso: NOW })).toBeUndefined();
  });

  it("refuses during a running cooldown", () => {
    const block = { ...AT_LIMIT, cooldownUntilIso: "2026-09-30T09:00:00.000Z" };

    expect(freshClaimRefusal({ block, grant: GRANT, nowIso: NOW })).toEqual(
      ClaudeResetErrors.cooldown({ untilIso: "2026-09-30T09:00:00.000Z" }),
    );
  });

  it("refuses a limit-only grant when no window is at its limit", () => {
    const block = { ...AT_LIMIT, atLimit: false };

    expect(freshClaimRefusal({ block, grant: GRANT, nowIso: NOW })!.message).toBe(
      "no reset can be claimed now — grant welcome-1 is honoured only at a limit, and no window is at one",
    );
  });

  it("refuses a paused, spent or not-usable grant", () => {
    expect(freshClaimRefusal({ block: AT_LIMIT, grant: { ...GRANT, paused: true }, nowIso: NOW })!.code).toBe(
      "NO_USABLE_GRANT",
    );
    expect(freshClaimRefusal({ block: AT_LIMIT, grant: { ...GRANT, resetsLeft: 0 }, nowIso: NOW })!.code).toBe(
      "NO_USABLE_GRANT",
    );
    expect(freshClaimRefusal({ block: AT_LIMIT, grant: { ...GRANT, usableNow: false }, nowIso: NOW })!.code).toBe(
      "NO_USABLE_GRANT",
    );
  });
});

describe("the attempt a resend settles", () => {
  it("hands back the newest unsettled intent for the plan", () => {
    const rows: ClaudeResetJournalRow[] = [
      { ...INTENT, requestId: "old" },
      { alias: "plan-five", atIso: NOW, kind: "outcome", requestId: "old", result: "reset", v: 1 },
      INTENT,
      { ...INTENT, alias: "plan-one", requestId: "other-plan" },
    ];

    expect(openClaimAttempt({ alias: "plan-five", rows })).toEqual(INTENT);
  });

  it("finds none once the intent is closed", () => {
    const rows: ClaudeResetJournalRow[] = [
      INTENT,
      { alias: "plan-five", atIso: NOW, kind: "closed", reason: "r", requestId: "req-1", v: 1 },
    ];

    expect(openClaimAttempt({ alias: "plan-five", rows })).toBeUndefined();
  });

  it("resends while the status shows the attempt unsettled", () => {
    expect(claimAttemptOverReason({ attempt: INTENT, block: AT_LIMIT, nowIso: NOW })).toBeUndefined();
  });

  it("closes the attempt once its grant holds fewer resets, the limit is gone, or the grant is unlisted", () => {
    const spent = { ...AT_LIMIT, grants: [{ ...GRANT, resetsLeft: 1 }] };

    expect(claimAttemptOverReason({ attempt: INTENT, block: spent, nowIso: NOW })).toBe(
      "grant welcome-1 holds 1 reset(s), down from 2",
    );
    expect(claimAttemptOverReason({ attempt: INTENT, block: { ...AT_LIMIT, atLimit: false }, nowIso: NOW })).toBe(
      "no window is at its limit any more",
    );
    expect(claimAttemptOverReason({ attempt: INTENT, block: { ...AT_LIMIT, grants: [] }, nowIso: NOW })).toBe(
      "grant welcome-1 is no longer listed",
    );
  });

  it("closes the attempt while a cooldown runs, and resends once it has passed", () => {
    const cooling = { ...AT_LIMIT, cooldownUntilIso: "2026-09-30T09:00:00.000Z" };

    expect(claimAttemptOverReason({ attempt: INTENT, block: cooling, nowIso: NOW })).toBe(
      "a cooldown runs until 2026-09-30T09:00:00.000Z (read as a reset's mark, which is unmeasured)",
    );
    expect(
      claimAttemptOverReason({ attempt: INTENT, block: cooling, nowIso: "2026-09-30T10:00:00.000Z" }),
    ).toBeUndefined();
  });

  it("round-trips a journal line and refuses one that is not a row", () => {
    expect(unwrap(parseClaudeResetJournalLine({ line: JSON.stringify(INTENT) }))).toEqual(INTENT);
    expect(unwrapErr(parseClaudeResetJournalLine({ line: "{not json" })).message).toBe(
      "a claims journal line is not JSON",
    );
    expect(unwrapErr(parseClaudeResetJournalLine({ line: '{"kind":"intent"}' })).message).toContain(
      "a claims journal line is not a row:",
    );
  });
});
