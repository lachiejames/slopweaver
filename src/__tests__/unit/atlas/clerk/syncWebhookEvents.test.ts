/*
 * The `webhook-event` kind's next file — `src/atlas/clerk/syncWebhookEvents.ts`.
 *
 * The compiled channel is merged on, only the compiled surface's coverage cell is replaced, and the standing
 * credential gap is open on every successful run.
 */
import { describe, expect, it } from "vitest";

import { succeededClerkCoverageCell } from "../../../../atlas/clerk/coverage.js";
import { CLERK_WEBHOOK_EVENT_KIND, emptyClerkKindFile } from "../../../../atlas/clerk/model.js";
import type { ClerkWebhookEventRow } from "../../../../atlas/clerk/specRead.js";
import { CLERK_API_SURFACE, CLERK_SPEC_SURFACE } from "../../../../atlas/clerk/surfaceFill.js";
import { webhookEventKindFile } from "../../../../atlas/clerk/syncWebhookEvents.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-05T11:00:00.000Z";
const EARLIER = "2026-09-01T09:00:00.000Z";

/** One webhook event, as the compiled channel hands it over. */
const ROW: ClerkWebhookEventRow = {
  description: "A user was created",
  event: "user.created",
  payloadFields: ["id"],
  payloadSchema: "UserCreated",
};

describe("webhookEventKindFile", () => {
  it("merges the compiled events on, stamps the run, and opens the standing credential gap", () => {
    const stored = emptyClerkKindFile({ kind: CLERK_WEBHOOK_EVENT_KIND, updatedAt: EARLIER });
    const file = unwrap(webhookEventKindFile({ at: AT, rows: [ROW], stored }));
    expect(file.entities.length).toBe(1);
    expect(file.updatedAt).toBe(AT);
    expect(file.gaps.map((gap) => [gap.condition, gap.scope])).toEqual([
      ["clerk-credential-absent", CLERK_WEBHOOK_EVENT_KIND],
    ]);
  });

  it("replaces only the compiled surface's cell and keeps every other surface's as stored", () => {
    const cell = ({ surface, scope }: { surface: string; scope: string }) =>
      succeededClerkCoverageCell({
        artifacts: [],
        at: EARLIER,
        channel: "compiled",
        reason: "an earlier run",
        role: "authoritative",
        scope,
        state: "synced",
        surface,
      });
    const stored = {
      ...emptyClerkKindFile({ kind: CLERK_WEBHOOK_EVENT_KIND, updatedAt: EARLIER }),
      coverage: [
        cell({ scope: "instance-entities", surface: CLERK_API_SURFACE }),
        cell({ scope: "stale-catalogue", surface: CLERK_SPEC_SURFACE }),
      ],
    };
    const file = unwrap(webhookEventKindFile({ at: AT, rows: [ROW], stored }));
    expect(file.coverage.map((kept) => [kept.surface, kept.scope])).toEqual([
      [CLERK_API_SURFACE, "instance-entities"],
      [CLERK_SPEC_SURFACE, "webhook-event-catalogue"],
    ]);
    expect(file.coverage[1]!.reason).toContain("1 webhook event(s) compiled");
  });
});
