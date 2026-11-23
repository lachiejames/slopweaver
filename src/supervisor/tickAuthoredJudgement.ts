/**
 * One judgement as the chair AUTHORS it in `tick.json`, read by both doors that read a draft: `tick close`
 * (`./tickInput.ts`) and the next tick's digest (`./digestPriorHolds.ts`). Its own module, beside the ledger schema
 * rather than inside `./tickInput.ts`, so the pure digest does not import the briefing and outbound graph that file
 * carries.
 */
import type { z } from "zod";

import { judgementSchema } from "./tickSchema.js";

/**
 * The ledger's own judgement shape less `recordedIso`, which `tick close` stamps. Derived rather than restated, so a
 * draft reader accepts exactly what the ledger would, and refuses an authored `recordedIso` as an unknown key.
 */
export const authoredJudgementSchema = judgementSchema.omit({ recordedIso: true }).strict();

/** One judgement as the chair authors it, before the close stamps its instant. */
export type AuthoredJudgement = z.output<typeof authoredJudgementSchema>;
