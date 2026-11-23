/**
 * The strict wire shape of a {@link CeilingsReading} (`./ceilings.ts`) — what `machine capacity --json` carries under
 * `ceilings`, what the tick draft maps, and what the ledger's strict schema re-reads. The builder lives beside the
 * types; this is only the door a recorded reading comes back through, with every contradiction the builder cannot
 * emit refused rather than judged.
 */
import { z } from "zod";

import type { Ceiling, CeilingsReading } from "./ceilings.js";

/** The strict wire shape of one window. */
const ceilingWindowSchema = z
  .object({
    available: z.number(),
    resetAtIso: z.string().nullable(),
    used: z.number(),
    window: z.string().min(1),
  })
  .strict();

/** The strict wire shape of one route. */
const ceilingRouteSchema = z
  .object({
    driver: z.enum(["claude", "codex"]),
    headroom: z.number(),
    limitingCeilingId: z.string().min(1),
    planCeilingId: z.string().min(1),
  })
  .strict();

/** The strict wire shape of a paused plan's pause. */
const claudePauseSchema = z
  .object({
    sinceIso: z.string().min(1),
    weekAtPause: z.discriminatedUnion("kind", [
      z
        .object({
          available: z.number(),
          kind: z.literal("read"),
          readAtIso: z.string().min(1),
          resetAtIso: z.string().nullable(),
          used: z.number(),
        })
        .strict(),
      z.object({ kind: z.literal("unavailable"), why: z.string().min(1) }).strict(),
    ]),
  })
  .strict();

/**
 * Every way a ceiling's status and headroom disagree, where `buildCeilingsReading` can emit neither: a status is
 * `unreadable` exactly when headroom is null, `held`/`paused`/`at-usage-limit`/`refusing` is zero, a number lies in 0..1, and only
 * the machine holds. A capture carrying one is malformed, never judged (an `unreadable` plan
 * at headroom 0 once read as measured exhaustion and capped the fleet).
 */
function ceilingContradictions({
  ceiling,
}: {
  ceiling: Pick<Ceiling, "headroom" | "kind" | "status" | "pause">;
}): readonly string[] {
  const found: string[] = [];
  if ((ceiling.status === "unreadable") !== (ceiling.headroom === null)) {
    found.push(`status ${ceiling.status} with headroom ${String(ceiling.headroom)}`);
  }
  const spent =
    ceiling.status === "held" ||
    ceiling.status === "paused" ||
    ceiling.status === "at-usage-limit" ||
    ceiling.status === "refusing";
  if (spent && ceiling.headroom !== 0) {
    found.push(`status ${ceiling.status} must carry headroom 0`);
  }
  if (ceiling.headroom !== null && (ceiling.headroom < 0 || ceiling.headroom > 1)) {
    found.push(`headroom ${String(ceiling.headroom)} is outside 0..1`);
  }
  if (ceiling.status === "held" && ceiling.kind !== "machine") {
    found.push("only the machine holds");
  }
  if (ceiling.pause !== undefined && (ceiling.kind !== "claude" || ceiling.status !== "paused")) {
    found.push("only a paused Claude plan carries a pause");
  }
  return found;
}

/** The strict wire shape of {@link CeilingsReading}. */
export const ceilingsReadingSchema = z
  .object({
    ceilings: z.array(
      z
        .object({
          // Optional, never defaulted: a ledger row recorded before either field must re-read as it was written.
          account: z.string().min(1).nullable().optional(),
          freeResets: z.number().int().min(0).nullable().optional(),
          headroom: z.number().nullable(),
          id: z.string().min(1),
          kind: z.enum(["machine", "claude", "codex"]),
          pause: claudePauseSchema.optional(),
          reason: z.string().nullable(),
          status: z.enum(["open", "held", "paused", "at-usage-limit", "refusing", "unreadable"]),
          windows: z.array(ceilingWindowSchema),
        })
        .strict()
        .superRefine((ceiling, ctx) => {
          for (const message of ceilingContradictions({ ceiling })) {
            ctx.addIssue({ code: "custom", message: `${ceiling.id}: ${message}` });
          }
        }),
    ),
    lowest: z.string().nullable(),
    observedAtIso: z.string().min(1),
    problems: z.array(z.string()),
    routes: z.array(ceilingRouteSchema),
    selectedRoute: ceilingRouteSchema.nullable(),
  })
  .strict()
  .superRefine((reading, ctx) => {
    // The builder emits exactly one machine and one ceiling per id; a capture with two machines was read by
    // `find` in one place and `some` in another.
    const machines = reading.ceilings.filter((ceiling) => ceiling.kind === "machine").length;
    if (machines !== 1) {
      ctx.addIssue({ code: "custom", message: `${String(machines)} machine ceilings, where exactly one is read` });
    }
    const ids = reading.ceilings.map((ceiling) => ceiling.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "two ceilings share an id" });
    }
  }) satisfies z.ZodType<CeilingsReading>;
