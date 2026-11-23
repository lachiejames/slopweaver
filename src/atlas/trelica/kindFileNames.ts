/**
 * The file each Trelica kind is stored in, under the platform's atlas root. A leaf, so `atlasHome.ts` can name
 * it the way it names `GITHUB_KIND_FILES` without loading the atlas, and keyed by the closed kind union so a
 * kind added to `TRELICA_ATLAS_KINDS` does not compile until it has a file.
 */
import type { TrelicaAtlasKind } from "./model.js";

/** Each kind's file name. */
export const TRELICA_KIND_FILES: Readonly<Record<TrelicaAtlasKind, string>> = {
  "access-review": "access-reviews.jsonl",
  "ai-alert": "ai-alerts.jsonl",
  "ai-usage": "ai-usage.jsonl",
  app: "apps.jsonl",
  assessment: "assessments.jsonl",
  contract: "contracts.jsonl",
  device: "devices.jsonl",
  integration: "integrations.jsonl",
  method: "methods.jsonl",
  page: "pages.jsonl",
  person: "people.jsonl",
  role: "roles.jsonl",
  team: "teams.jsonl",
  workflow: "workflows.jsonl",
  "workflow-run": "workflow-runs.jsonl",
};
