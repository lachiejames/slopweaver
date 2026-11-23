/**
 * What the atlas keeps of each Make entity — one schema per kind, used twice: to cut an answer down at the
 * fill, and to read a stored detail back for the page.
 *
 * Every schema is a plain `z.object`, which STRIPS any key it does not declare, so the allowlist and the
 * validation are one declaration: a kept field that is missing or mistyped fails loudly, and a field nobody
 * named never reaches the store. What is left out on purpose — names, never values — is the descriptor's
 * `excludes`. Why these are not yet `defineBoundary` strict objects is `fill/project.ts`'s header.
 */
import { z } from "zod";

import type { MakeAtlasKind } from "./model.js";

const id = z.number().int();

/** A person Make names on a scenario. The SDK types `name`/`email` as numbers; Make's API schema says strings. */
const userRef = z.object({ email: z.string().nullable().optional(), id, name: z.string().nullable().optional() });

/** @internal */
export const organizationDetail = z.object({
  id,
  license: z
    .object({
      auditLogsDays: z.number().optional(),
      operations: z.number().optional(),
      retention: z.number().optional(),
      teams: z.number().optional(),
      users: z.number().optional(),
    })
    .optional(),
  name: z.string(),
  timezoneId: id.optional(),
  zone: z.string(),
});

/** @internal */
export const teamDetail = z.object({
  activeScenarios: z.number().int().optional(),
  id,
  name: z.string(),
  organizationId: id,
  type: z.string().optional(),
});

/** @internal */
export const folderDetail = z.object({ id, name: z.string(), path: z.string(), teamId: id });

/** @internal */
export const schedulingDetail = z.object({
  between: z.array(z.string()).optional(),
  date: z.string().optional(),
  days: z.array(z.number()).optional(),
  interval: z.number().optional(),
  months: z.array(z.number()).optional(),
  restrict: z.object({ days: z.array(z.number()).optional(), months: z.array(z.number()).optional() }).optional(),
  time: z.string().optional(),
  type: z.string(),
});

/** A scenario's blueprint reduced to names: module identifiers in flow order, and the apps they belong to. */
export const blueprintOutlineDetail = z.object({
  appPrefixes: z.array(z.string()),
  moduleCount: z.number().int(),
  modules: z.array(z.string()),
});

export type MakeBlueprintOutline = z.infer<typeof blueprintOutlineDetail>;

/** @internal */
export const scenarioDetail = z.object({
  created: z.string(),
  createdByUser: userRef.nullable().optional(),
  description: z.string().nullable(),
  dlqCount: z.number().int().optional(),
  folderId: id.nullable(),
  id,
  isActive: z.boolean(),
  isPaused: z.boolean(),
  isinvalid: z.boolean(),
  lastEdit: z.string(),
  name: z.string(),
  scheduling: schedulingDetail,
  teamId: id,
  updatedByUser: userRef.nullable().optional(),
  usedPackages: z.array(z.string()),
});

/** A stored scenario: what the list kept, plus its blueprint outline. */
export const storedScenarioDetail = scenarioDetail.extend({ blueprintOutline: blueprintOutlineDetail });

export type MakeScenarioDetail = z.infer<typeof storedScenarioDetail>;

/** @internal */
export const connectionDetail = z.object({
  accountLabel: z.string(),
  accountName: z.string(),
  accountType: z.string().optional(),
  expire: z.string().nullable(),
  id,
  name: z.string(),
  packageName: z.string().nullable(),
  scenarioUsages: z.array(z.object({ id, name: z.string() })).optional(),
  teamId: id,
});

/** @internal */
export const hookDetail = z.object({
  enabled: z.boolean(),
  gone: z.boolean().optional(),
  id,
  name: z.string(),
  packageName: z.string().nullable(),
  queueCount: z.number().int(),
  scenarioId: id.nullable().optional(),
  teamId: id,
  type: z.string(),
  typeName: z.string().optional(),
});

/** One row of a scenario's execution list — never its detail or outputs. */
export const executionDetail = z.object({
  authorName: z.string().nullable().optional(),
  duration: z.number(),
  eventType: z.string().nullable().optional(),
  id: z.string(),
  operations: z.number(),
  status: z.number().int(),
  timestamp: z.string(),
  type: z.string().optional(),
});

/** A stored execution: the list row, plus the scenario it was read for. */
export const storedExecutionDetail = executionDetail.extend({ scenarioId: id });

export type MakeExecutionDetail = z.infer<typeof storedExecutionDetail>;

/**
 * The schema each kind's stored detail is cut to when the generation is built — a second cut after the fill's
 * own, so a detail reaching the publish by any other path still loses every key no schema names.
 */
export const MAKE_STORED_DETAIL = {
  connection: connectionDetail,
  execution: storedExecutionDetail,
  folder: folderDetail,
  hook: hookDetail,
  organization: organizationDetail,
  scenario: storedScenarioDetail,
  team: teamDetail,
} as const satisfies Readonly<Record<MakeAtlasKind, z.ZodType>>;
