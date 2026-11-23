/**
 * `runAlertSummaryRow` / `runAlertDigestRow` — the card runners `automation run-due` dispatches to, called
 * directly: where the card posts, what refuses it before a read, and where a posted card is recorded.
 */
import { afterEach, describe, expect, it } from "vitest";

import { runAlertDigestRow, runAlertSummaryRow } from "../../../../../../cli/commands/automation/cardRowRunners.js";
import type { RecipeRunDueDeps } from "../../../../../../cli/commands/automation/rowRunners.js";
import { unwrap } from "../../../../../../lib/result.js";
import {
  RECIPE_DEFINITION_SCHEMA_VERSION,
  type RecipeDefinition,
} from "../../../../../../live/automation/definition.js";
import { readFiringPosting } from "../../../../../../live/automation/postingLedger.js";
import { slotDeliveryKey } from "../../../../../../live/automation/slotLedger.js";
import { keyedDuplicateKey } from "../../../../../../outbound/slack/fingerprint.js";
import { confirmSend } from "../../../../../../outbound/slack/sendReservation.js";
import { PROMPT_CHANNEL } from "./fixtures.js";
import { deps, freshHome, removeHomes } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("runAlertSummaryRow / runAlertDigestRow — the card runners, called directly", () => {
  /** A parsed `alert-summary` row, overridable field by field. */
  function parsedAlertRow(over: Partial<RecipeDefinition> = {}): RecipeDefinition {
    return {
      cadence: "0 * * * *",
      destination: { kind: "slack" },
      effect: "read-write",
      enabled: true,
      kind: "alert-summary",
      onMissed: "skip",
      params: { channel: "C0ALERTS", label: "Knock alerts", window: "24h" },
      recipeId: "knock-alerts",
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
      ...over,
    };
  }

  /** The not-yet-run outcome fields `runOneRow` spreads over every arm. */
  const BASE = { detail: [], exitCode: null, failed: false, ran: false, recipeId: "knock-alerts" } as const;

  it("posts the card into the owner's DM and never into the channel it read", async () => {
    const edges = deps();
    const outcome = await runAlertSummaryRow({
      base: BASE,
      definition: parsedAlertRow(),
      deps: edges,
      dryRun: false,
      home: "/tmp/home",
      media: [],
      priorRun: undefined,
      slotIso: "2026-09-08T12:00:00.000Z",
    });
    expect(outcome.failed).toBe(false);
    expect(edges.dispatched[0]!.join(" ")).toContain(`--channel ${PROMPT_CHANNEL}`);
    expect(edges.dispatched[0]!.join(" ")).not.toContain("--channel C0ALERTS");
    expect(edges.reads[0]!.join(" ")).toContain("--channel C0ALERTS");
  });

  it("refuses the row before spending a read when it aims its card at an unapproved channel", async () => {
    const edges = deps();
    const outcome = await runAlertSummaryRow({
      base: BASE,
      definition: parsedAlertRow({ params: { channel: "C0ALERTS", postTo: "C0TEAM", window: "24h" } }),
      deps: edges,
      dryRun: false,
      home: "/tmp/home",
      media: [],
      priorRun: undefined,
      slotIso: "2026-09-08T12:00:00.000Z",
    });
    expect(outcome.failed).toBe(true);
    expect(outcome.line).toContain("nothing was posted");
    expect(edges.reads.length).toBe(0);
    expect(edges.dispatched.length).toBe(0);
  });

  it("refuses a digest row handed captures it never asked for, and posts nothing", async () => {
    const edges = deps();
    const outcome = await runAlertDigestRow({
      base: { ...BASE, recipeId: "knock" },
      definition: {
        cadence: "30 12 * * *",
        destination: { kind: "slack" },
        effect: "read-write",
        enabled: true,
        kind: "datadog-alert-digest",
        onMissed: "skip",
        params: {
          channel: PROMPT_CHANNEL,
          label: "Knock",
          probes: [
            {
              id: "sends",
              kind: "logs-count",
              query: "service:example-api status:error",
              severityWhenFiring: "orange",
              title: "send failures",
              why: "the outer send catch",
            },
          ],
          window: "24h",
        },
        recipeId: "knock",
        schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
      },
      deps: edges,
      dryRun: false,
      home: "/tmp/home",
      media: ["/tmp/a.png"],
      priorRun: undefined,
      slotIso: "2026-09-08T12:30:00.000Z",
    });
    expect(outcome.failed).toBe(true);
    expect(outcome.line).toContain("nothing here asked for a picture");
    expect(edges.dispatched.length).toBe(0);
  });

  /**
   * Edges whose post confirms on the send ledger exactly as a real `slack post --as bot --idempotency-key` does,
   * so the runner reads its ts back the way it does in production.
   */
  function confirmingEdges({ home, recipeId, slotIso }: { home: string; recipeId: string; slotIso: string }) {
    const edges = deps();
    const runVerbKeepingDiagnostics: RecipeRunDueDeps["runVerbKeepingDiagnostics"] = (argv) => {
      confirmSend({
        duplicateKey: keyedDuplicateKey({
          actor: "bot",
          channel: PROMPT_CHANNEL,
          idempotencyKey: slotDeliveryKey({ recipeId, slotIso }),
        }),
        home,
        nowIso: "2026-09-08T12:05:00.000Z",
        sentTs: "1790.0002",
      });
      return edges.runVerbKeepingDiagnostics(argv);
    };
    return { ...edges, runVerbKeepingDiagnostics };
  }

  it("records where an alert-summary card posted, read off the send ledger its post confirmed", async () => {
    const home = freshHome();
    const slotIso = "2026-09-08T12:00:00.000Z";
    const edges = confirmingEdges({ home, recipeId: "knock-alerts", slotIso });

    await runAlertSummaryRow({
      base: BASE,
      definition: parsedAlertRow(),
      deps: edges,
      dryRun: false,
      home,
      media: [],
      priorRun: undefined,
      slotIso,
    });

    expect(unwrap(readFiringPosting({ home, recipeId: "knock-alerts", slotIso }))).toEqual({
      channel: PROMPT_CHANNEL,
      postedAtIso: "2026-09-08T12:05:00.000Z",
      recipeId: "knock-alerts",
      slotIso,
      ts: "1790.0002",
    });
    expect(edges.diag).toEqual([]);
  });

  it("records where a datadog-alert-digest card posted, read off the send ledger its post confirmed", async () => {
    const home = freshHome();
    const slotIso = "2026-09-08T12:30:00.000Z";
    const edges = confirmingEdges({ home, recipeId: "knock", slotIso });

    await runAlertDigestRow({
      base: { ...BASE, recipeId: "knock" },
      definition: {
        cadence: "30 12 * * *",
        destination: { kind: "slack" },
        effect: "read-write",
        enabled: true,
        kind: "datadog-alert-digest",
        onMissed: "skip",
        params: {
          channel: PROMPT_CHANNEL,
          label: "Knock",
          probes: [
            {
              id: "sends",
              kind: "logs-count",
              query: "service:example-api status:error",
              severityWhenFiring: "orange",
              title: "send failures",
              why: "the outer send catch",
            },
          ],
          window: "24h",
        },
        recipeId: "knock",
        schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
      },
      deps: edges,
      dryRun: false,
      home,
      media: [],
      priorRun: undefined,
      slotIso,
    });

    expect(unwrap(readFiringPosting({ home, recipeId: "knock", slotIso }))!.ts).toBe("1790.0002");
  });

  it("says a card whose post left no ts on the send ledger, rather than recording a guess", async () => {
    const home = freshHome();
    const slotIso = "2026-09-08T12:00:00.000Z";
    const edges = deps();

    await runAlertSummaryRow({
      base: BASE,
      definition: parsedAlertRow(),
      deps: edges,
      dryRun: false,
      home,
      media: [],
      priorRun: undefined,
      slotIso,
    });

    expect(unwrap(readFiringPosting({ home, recipeId: "knock-alerts", slotIso }))).toBeUndefined();
    expect(edges.diag).toEqual([
      "recipe knock-alerts · the card posted but its send ledger carries no message ts — " +
        "the Automations page will not show where this firing posted",
    ]);
  });

  it("records no card posting on a dry run, and says nothing about it", async () => {
    const home = freshHome();
    const slotIso = "2026-09-08T12:00:00.000Z";
    const edges = confirmingEdges({ home, recipeId: "knock-alerts", slotIso });

    await runAlertSummaryRow({
      base: BASE,
      definition: parsedAlertRow(),
      deps: edges,
      dryRun: true,
      home,
      media: [],
      priorRun: undefined,
      slotIso,
    });

    expect(unwrap(readFiringPosting({ home, recipeId: "knock-alerts", slotIso }))).toBeUndefined();
    expect(edges.diag).toEqual([]);
  });
});
