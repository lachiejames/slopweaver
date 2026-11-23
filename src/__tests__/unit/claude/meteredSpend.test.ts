/**
 * The metered-spend judgement over real telemetry: the four events a Console `/login` produced,
 * among the plan events the same chair made before and after it, frozen from Datadog with the plan
 * organisation ids replaced by synthetics.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  type ApiRequestSpend,
  absenceSinceIso,
  applyIdentityBaseline,
  baselineInRead,
  identityBaselineQuery,
  judgeMeteredSpend,
  newestApiRequestSpend,
  projectApiRequest,
  promptScopedQuery,
  renderDollars,
} from "../../../claude/meteredSpend.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** The frozen logs-events page. */
const PAGE = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../fixtures/claude/api-request-283-15.json"), "utf8"),
) as { data: unknown[] };

/** Every event in the fixture, projected. */
const ALL = PAGE.data.map((event) => unwrap(projectApiRequest({ event })));

/** The chair's two metered prompts. */
const METERED_PROMPTS = new Set(["5cb9b4ed-4ff6-4381-8a40-03acff6ec113", "2931f80b-d014-4768-8e30-82fe534b3c60"]);

/** Everything the chair had made up to the end of the incident, before its next prompt went out on a plan. */
const THROUGH_INCIDENT = ALL.filter((spend) => Date.parse(spend.tsIso) <= Date.parse("2026-09-17T13:41:00Z"));

describe("projectApiRequest", () => {
  it("projects all fourteen frozen events, four of them metered — exactly the incident's prompts", () => {
    expect(ALL.length).toBe(14);
    expect(ALL.filter((spend) => spend.metered).map((spend) => spend.promptId)).toStrictEqual([
      "2931f80b-d014-4768-8e30-82fe534b3c60",
      "2931f80b-d014-4768-8e30-82fe534b3c60",
      "5cb9b4ed-4ff6-4381-8a40-03acff6ec113",
      "5cb9b4ed-4ff6-4381-8a40-03acff6ec113",
    ]);
    expect(ALL.filter((spend) => METERED_PROMPTS.has(spend.promptId)).every((spend) => spend.metered)).toBe(true);
  });

  it("keeps a plan request's organisation — what names the plan a chair spends — and gives a metered one none", () => {
    expect(ALL[0]!).toStrictEqual({
      costUsd: 0.165016,
      metered: false,
      organizationId: "00000000-0000-4000-8000-000000000004",
      promptId: "37fef00a-5e69-4617-9c40-4be910e155d1",
      tsIso: "2026-09-17T13:47:39.139Z",
    });
    expect(ALL.filter((spend) => spend.metered).map((spend) => spend.organizationId)).toStrictEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("picks the newest request, a metered one winning a same-instant tie", () => {
    const at = "2026-09-17T13:41:00.000Z";
    const plan: ApiRequestSpend = { costUsd: 1, metered: false, organizationId: "o", promptId: "p", tsIso: at };
    const metered: ApiRequestSpend = { costUsd: 1, metered: true, promptId: "p", tsIso: at };

    expect(newestApiRequestSpend({ events: [plan, metered] })).toBe(metered);
    expect(newestApiRequestSpend({ events: [] })).toBe(undefined);
  });

  it("refuses an event with no prompt id, naming the path", () => {
    const projected = projectApiRequest({
      event: { attributes: { attributes: { cost_usd: 1 }, timestamp: "2026-09-17T13:39:02.089Z" } },
    });

    expect(unwrapErr(projected)).toStrictEqual([
      "attributes.attributes.prompt: Invalid input: expected object, received undefined",
    ]);
  });

  it("reads an empty or null organisation as metered, so an older plan event cannot become the newest", () => {
    const at = "2026-09-17T13:41:00.000Z";
    const empty = unwrap(
      projectApiRequest({
        event: {
          attributes: { attributes: { cost_usd: 1, organization: { id: "" }, prompt: { id: "p" } }, timestamp: at },
        },
      }),
    );
    const nulled = unwrap(
      projectApiRequest({
        event: { attributes: { attributes: { cost_usd: 1, organization: null, prompt: { id: "p" } }, timestamp: at } },
      }),
    );
    const olderPlan: ApiRequestSpend = { costUsd: 1, metered: false, promptId: "p", tsIso: "2026-09-17T13:40:30.000Z" };

    const idless = unwrap(
      projectApiRequest({
        event: { attributes: { attributes: { cost_usd: 1, organization: {}, prompt: { id: "p" } }, timestamp: at } },
      }),
    );

    expect(empty.metered).toBe(true);
    expect(idless.metered).toBe(true);
    expect(nulled.metered).toBe(true);
    expect(judgeMeteredSpend({ events: [olderPlan, empty] }).kind).toBe("metered-now");
  });

  it("refuses an event whose timestamp is not an instant", () => {
    const projected = projectApiRequest({
      event: { attributes: { attributes: { cost_usd: 1, prompt: { id: "p" } }, timestamp: "yesterday" } },
    });

    expect(unwrapErr(projected)[0]!).toContain("attributes.timestamp");
  });
});

describe("judgeMeteredSpend", () => {
  it("calls the chair metered NOW at the end of the incident, $7.38 across four requests", () => {
    const verdict = judgeMeteredSpend({ events: THROUGH_INCIDENT });

    expect(verdict.kind).toBe("metered-now");
    expect(verdict).toMatchObject({
      firstIso: "2026-09-17T13:39:02.089Z",
      lastIso: "2026-09-17T13:40:58.040Z",
      requests: 4,
    });
    expect(renderDollars({ dollars: (verdict as { dollars: number }).dollars })).toBe("$7.38");
  });

  it("calls it metered EARLIER once its next prompt went out on a plan again", () => {
    const verdict = judgeMeteredSpend({ events: ALL });

    expect(verdict).toMatchObject({
      firstIso: "2026-09-17T13:39:02.089Z",
      kind: "metered-earlier",
      lastIso: "2026-09-17T13:40:58.040Z",
      newestIso: "2026-09-17T13:47:39.139Z",
      requests: 4,
    });
  });

  it("calls plan-only telemetry a plan, dated by its newest request", () => {
    const verdict = judgeMeteredSpend({ events: ALL.filter((spend) => !spend.metered) });

    expect(verdict).toStrictEqual({ kind: "plan", newestIso: "2026-09-17T13:47:39.139Z" });
  });

  it("calls no events at all no-telemetry, never a plan", () => {
    expect(judgeMeteredSpend({ events: [] })).toStrictEqual({ kind: "no-telemetry" });
  });

  it("lets a metered request win a same-instant tie", () => {
    const at = "2026-09-17T13:39:02.089Z";
    const plan: ApiRequestSpend = { costUsd: 1, metered: false, promptId: "p", tsIso: at };
    const metered: ApiRequestSpend = { costUsd: 2, metered: true, promptId: "p", tsIso: at };

    expect(judgeMeteredSpend({ events: [plan, metered] }).kind).toBe("metered-now");
    expect(judgeMeteredSpend({ events: [metered, plan] }).kind).toBe("metered-now");
  });
});

describe("promptScopedQuery", () => {
  it("scopes the api_request query to the given prompts, deduplicated", () => {
    expect(
      promptScopedQuery({
        promptIds: [
          "5cb9b4ed-4ff6-4381-8a40-03acff6ec113",
          "2931f80b-d014-4768-8e30-82fe534b3c60",
          "5cb9b4ed-4ff6-4381-8a40-03acff6ec113",
        ],
      }),
    ).toBe(
      "service:claude-code @event.name:api_request " +
        "@prompt.id:(5cb9b4ed-4ff6-4381-8a40-03acff6ec113 OR 2931f80b-d014-4768-8e30-82fe534b3c60)",
    );
  });

  it("drops an id that is not a UUID, and asks nothing when none survives", () => {
    expect(promptScopedQuery({ promptIds: ["x) OR service:*", ""] })).toBe(undefined);
  });
});

/** A device id in the shape Claude Code mints, a SHA-256 hex digest. */
const DEVICE = "3c722295fc702ce4700a6e0e31508923988ee6729364ee83902ea4abce55b296";

/**
 * A request at an instant, identified or not.
 *
 * @returns the projected spend
 */
function spendAt({ tsIso, metered }: { tsIso: string; metered: boolean }): ApiRequestSpend {
  if (metered) {
    return { costUsd: 1, metered, promptId: "p", tsIso };
  }
  return { costUsd: 1, metered, organizationId: "o", promptId: "p", tsIso };
}

describe("the device baseline", () => {
  it("projects a well-formed user.id as the device, and drops a malformed one", () => {
    const at = "2026-10-01T18:32:33.313Z";
    const event = ({ id }: { id: string }): unknown => ({
      attributes: { attributes: { cost_usd: 1, prompt: { id: "p" }, user: { id } }, timestamp: at },
    });

    expect(unwrap(projectApiRequest({ event: event({ id: DEVICE }) }))).toStrictEqual({
      costUsd: 1,
      deviceId: DEVICE,
      metered: true,
      promptId: "p",
      tsIso: at,
    });
    expect(Object.keys(unwrap(projectApiRequest({ event: event({ id: "x) OR *" }) }))).toSorted()).toStrictEqual([
      "costUsd",
      "metered",
      "promptId",
      "tsIso",
    ]);
  });

  it("asks for identified requests from the session's devices, unscoped when none is well-formed", () => {
    expect(identityBaselineQuery({ deviceIds: [DEVICE, DEVICE, "nope"] })).toBe(
      `service:claude-code @event.name:api_request @organization.id:* @user.id:(${DEVICE})`,
    );
    expect(identityBaselineQuery({ deviceIds: ["nope"] })).toBe(
      "service:claude-code @event.name:api_request @organization.id:*",
    );
  });

  it("starts the absence at the CURRENT run, so a restart's earlier identified requests never stand as baseline", () => {
    // Identified before the restart, none after; an older metered spell before that.
    const events = [
      spendAt({ metered: true, tsIso: "2026-10-01T16:00:00.000Z" }),
      spendAt({ metered: false, tsIso: "2026-10-01T17:06:56.700Z" }),
      spendAt({ metered: true, tsIso: "2026-10-01T18:20:00.000Z" }),
      spendAt({ metered: true, tsIso: "2026-10-01T18:32:33.313Z" }),
    ];

    expect(absenceSinceIso({ events })).toBe("2026-10-01T18:20:00.000Z");
    expect(baselineInRead({ sinceIso: "2026-10-01T18:20:00.000Z", spends: events })).toBe(false);
  });

  it("has no absence when the newest request named an organisation", () => {
    const events = [
      spendAt({ metered: true, tsIso: "2026-09-17T13:39:02.089Z" }),
      spendAt({ metered: false, tsIso: "2026-09-17T13:42:25.951Z" }),
    ];

    expect(absenceSinceIso({ events })).toBe(undefined);
    expect(absenceSinceIso({ events: [] })).toBe(undefined);
  });

  it("finds the baseline in the read itself — identified requests at or after the absence", () => {
    const sinceIso = absenceSinceIso({ events: THROUGH_INCIDENT })!;

    expect(sinceIso).toBe("2026-09-17T13:39:02.089Z");
    expect(baselineInRead({ sinceIso, spends: ALL })).toBe(true);
    expect(baselineInRead({ sinceIso, spends: THROUGH_INCIDENT })).toBe(false);
    expect(baselineInRead({ sinceIso, spends: [spendAt({ metered: false, tsIso: sinceIso })] })).toBe(true);
  });

  it("leaves metered-now standing on an established baseline, and every other verdict untouched", () => {
    const verdict = judgeMeteredSpend({ events: THROUGH_INCIDENT });
    const plan = judgeMeteredSpend({ events: [spendAt({ metered: false, tsIso: "2026-10-01T17:00:00.000Z" })] });

    expect(applyIdentityBaseline({ baseline: { kind: "established" }, verdict })).toBe(verdict);
    expect(applyIdentityBaseline({ baseline: { kind: "absent" }, verdict: plan })).toBe(plan);
  });

  it("reads a device-wide absence as UNMEASURED, naming the shared oauthAccount", () => {
    const verdict = judgeMeteredSpend({ events: THROUGH_INCIDENT });
    expect(applyIdentityBaseline({ baseline: { kind: "absent" }, verdict })).toStrictEqual({
      kind: "unmeasured",
      why: expect.stringContaining("~/.claude.json's shared oauthAccount") as string,
    });
  });

  it("reads an unreadable baseline as UNMEASURED, carrying why", () => {
    const verdict = judgeMeteredSpend({ events: THROUGH_INCIDENT });

    expect(applyIdentityBaseline({ baseline: { kind: "unread", why: "HTTP 503" }, verdict })).toStrictEqual({
      kind: "unmeasured",
      why: "its requests name no organisation and the device baseline could not be read (HTTP 503)",
    });
  });
});
