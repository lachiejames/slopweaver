/**
 * The help-truth tables' rows for `atlas`, `hex` and `notion` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { ATLAS_BACKLOG_FLAG_NAMES, parseAtlasBacklogArgs } from "../../../../cli/commands/atlas/backlogCore.js";
import { ATLAS_DOCTOR_FLAG_NAMES, parseAtlasDoctorArgs } from "../../../../cli/commands/atlas/doctorCore.js";
import { atlasCommandErrorLines } from "../../../../cli/commands/atlas/errors.js";
import { ATLAS_FRESHNESS_FLAG_NAMES, parseAtlasFreshnessArgs } from "../../../../cli/commands/atlas/freshnessCore.js";
import { ATLAS_PROBE_FLAG_NAMES, parseAtlasProbeArgs } from "../../../../cli/commands/atlas/probeCore.js";
import { ATLAS_SLACK_API_FLAG_NAMES, parseAtlasSlackApiArgs } from "../../../../cli/commands/atlas/slackApiCore.js";
import { parseAtlasSlackArgs } from "../../../../cli/commands/atlas/slackCore.js";
import {
  ATLAS_SLACK_DRIVE_FLAG_NAMES,
  parseAtlasSlackDriveArgs,
} from "../../../../cli/commands/atlas/slackDriveCore.js";
import {
  HEX_CELLS_FLAG_NAMES,
  HEX_CONNECTIONS_FLAG_NAMES,
  HEX_OUTPUT_FLAG_NAMES,
  HEX_PROJECT_FLAG_NAMES,
  HEX_PROJECTS_FLAG_NAMES,
  HEX_RAW_FLAG_NAMES,
  HEX_RUNS_FLAG_NAMES,
  HEX_VERIFY_FLAG_NAMES,
  parseHexObjectOptions,
  parseHexOutputOptions,
  parseHexProjectsOptions,
  parseHexRawOptions,
  parseHexVerifyOptions,
} from "../../../../cli/commands/hex/core.js";
import { NOTION_ATTACH_FLAG_NAMES, parseNotionAttachArgs } from "../../../../cli/commands/notion/mediaCore.js";
import { NOTION_PAGE_FLAG_NAMES, parseNotionPageArgs } from "../../../../cli/commands/notion/pageCore.js";
import { NOTION_VERIFY_FLAG_NAMES, parseNotionVerifyArgs } from "../../../../cli/commands/notion/verifyCore.js";
import { PROVIDER_READ_FLAG_NAMES, parseProviderReadArgs } from "../../../../cli/commands/providerRead/core.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags } from "./sharedProbes.js";

/** A real-shaped Notion page id, used as both a `--parent` and a `--to` in the probes below. */
const NOTION_PARENT = "39100000-0000-8102-a2f7-d1d8ef1fe6b0";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "hex cells": HEX_CELLS_FLAG_NAMES,
  "hex connections": HEX_CONNECTIONS_FLAG_NAMES,
  "hex output": HEX_OUTPUT_FLAG_NAMES,
  "hex project": HEX_PROJECT_FLAG_NAMES,
  "hex projects": HEX_PROJECTS_FLAG_NAMES,
  "hex raw": HEX_RAW_FLAG_NAMES,
  "hex runs": HEX_RUNS_FLAG_NAMES,
  "hex verify": HEX_VERIFY_FLAG_NAMES,
  "atlas backlog": ATLAS_BACKLOG_FLAG_NAMES,
  "atlas doctor": ATLAS_DOCTOR_FLAG_NAMES,
  "atlas freshness": ATLAS_FRESHNESS_FLAG_NAMES,
  "atlas probe": ATLAS_PROBE_FLAG_NAMES,
  "atlas slack-api": ATLAS_SLACK_API_FLAG_NAMES,
  "atlas slack-drive": ATLAS_SLACK_DRIVE_FLAG_NAMES,
  "notion attach": NOTION_ATTACH_FLAG_NAMES,
  "notion page": NOTION_PAGE_FLAG_NAMES,
  "notion read": PROVIDER_READ_FLAG_NAMES["notion"],
  "notion verify": NOTION_VERIFY_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "hex cells": {
    "--json": ["--project", "p1", "--json"],
    "--limit": ["--project", "p1", "--limit", "10"],
    "--project": ["--project", "p1"],
    "--sql-only": ["--project", "p1", "--sql-only"],
  },
  "hex connections": { "--json": ["--json"], "--limit": ["--limit", "10"] },
  "hex output": {
    "--cell": ["--cell", "c1"],
    "--column": ["--column", "created_at"],
    "--date-column": ["--date-column", "created_at"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--now": ["--now", "2026-09-16T00:00:00Z"],
  },
  "hex project": {
    "--json": ["--project", "p1", "--json"],
    "--project": ["--project", "p1"],
    "--tables": ["--project", "p1", "--tables"],
  },
  "hex projects": {
    "--include-archived": ["--include-archived"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--owner": ["--owner", "a@example.invalid"],
    "--query": ["--query", "booking"],
  },
  "hex raw": { "--json": ["--json"], "--path": ["--path", "/v1/users/me"] },
  "hex runs": {
    "--json": ["--project", "p1", "--json"],
    "--limit": ["--project", "p1", "--limit", "10"],
    "--project": ["--project", "p1"],
  },
  "hex verify": { "--json": ["--json"] },
  "atlas backlog": {
    "--deferred": ["--deferred"],
    "--ground": ["--ground", "not-fetched"],
    "--json": ["--json"],
    "--named-only": ["--named-only"],
    "--platform": ["--platform", "datadog"],
  },
  "atlas doctor": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--repair": ["--repair"],
  },
  "atlas freshness": {
    "--behind-only": ["--behind-only"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--window": ["--window", "4h"],
  },
  "atlas probe": {
    "--cells": ["--cells", "8"],
    "--json": ["--json"],
    "--platform": ["--platform", "jumpcloud"],
  },
  "atlas slack": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--never-read": ["--never-read"],
    "--unreadable": ["--unreadable"],
  },
  "atlas slack-api": {
    "--browser": ["--browser"],
    "--field": ["--field", "reply_count"],
    "--from-har": ["--from-har", "/tmp/capture.har"],
    "--json": ["--json"],
    "--method": ["--method", "conversations.history"],
  },
  "atlas slack-drive": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--session": ["--session", "/tmp/walk.json"],
  },
  "notion attach": {
    "--dry-run": ["--dry-run"],
    "--from": [],
    "--home": ["--home", "/tmp"],
    "--media-base": ["--media-base", "/tmp/shots"],
    "--json": ["--json"],
    "--overwrite-external-edit": ["--overwrite-external-edit", "syncing gold on their behalf"],
    "--page": [],
  },
  "notion page": {
    "--adopt": ["--adopt"],
    "--media-base": ["--media-base", "/tmp/shots"],
    "--body": [],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--icon": ["--icon", "🧭"],
    "--json": ["--json"],
    "--overwrite-external-edit": ["--overwrite-external-edit", "syncing gold on their behalf"],
    "--page": ["--page", "3c300000-0000-817c-a1d1-da9a9b003e05"],
    "--parent": [],
    "--title": [],
    // `--to` belongs to `move` alone, and `move` refuses without `--page` beside it — so this probe carries
    // its own sub-command, which the `notion page` parser wrapper above honours.
    "--to": ["move", "--page", "3c300000-0000-817c-a1d1-da9a9b003e05", "--to", NOTION_PARENT],
  },
  "notion read": {
    "--after": ["--after", "21f00000-0000-81f7-bbb6-c1da76056619"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--kind": ["--kind", "database"],
    "--limit": ["--limit", "10"],
    "--nested-calls": ["--nested-calls", "800"],
    "--pdf": ["--pdf"],
  },
  "notion verify": {
    "--cell-lines": ["--cell-lines", "9"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--observation": ["--observation", "/tmp/observation.json"],
    "--out": ["--out", "/tmp/shots"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "hex cells": ({ fragment }) =>
    parseHexObjectOptions({ extraFlag: "sql-only", idFlag: "project", rest: fragment, usageHint: "--project p1" }),
  "hex connections": ({ fragment }) => parseHexProjectsOptions({ rest: fragment }),
  "hex output": ({ fragment }) => parseHexOutputOptions({ rest: dedupeFlags({ base: ["--cell", "c1"], fragment }) }),
  "hex project": ({ fragment }) =>
    parseHexObjectOptions({ extraFlag: "tables", idFlag: "project", rest: fragment, usageHint: "--project p1" }),
  "hex projects": ({ fragment }) => parseHexProjectsOptions({ rest: fragment }),
  "hex raw": ({ fragment }) =>
    parseHexRawOptions({ rest: dedupeFlags({ base: ["--path", "/v1/users/me"], fragment }) }),
  "hex runs": ({ fragment }) =>
    parseHexObjectOptions({ extraFlag: null, idFlag: "project", rest: fragment, usageHint: "--project p1" }),
  "hex verify": ({ fragment }) => parseHexVerifyOptions({ rest: fragment }),
  "atlas backlog": ({ fragment }) =>
    parseAtlasBacklogArgs({ rest: [...fragment] }).mapErr((error) => atlasCommandErrorLines({ error })),
  "atlas doctor": ({ fragment }) =>
    parseAtlasDoctorArgs({ rest: [...fragment] }).mapErr((error) => atlasCommandErrorLines({ error })),
  "atlas freshness": ({ fragment }) => parseAtlasFreshnessArgs({ rest: [...fragment] }),
  "atlas probe": ({ fragment }) => parseAtlasProbeArgs({ rest: ["airtable", ...fragment] }),
  "atlas slack": ({ fragment }) => parseAtlasSlackArgs({ rest: [...fragment] }),
  "atlas slack-api": ({ fragment }) =>
    parseAtlasSlackApiArgs({ rest: [...fragment] }).mapErr((error) => atlasCommandErrorLines({ error })),
  "atlas slack-drive": ({ fragment }) =>
    parseAtlasSlackDriveArgs({ rest: ["report", ...fragment] }).mapErr((error) => atlasCommandErrorLines({ error })),
  "notion attach": ({ fragment }) =>
    parseNotionAttachArgs({
      argv: ["attach", "--page", "3c300000-0000-817c-a1d1-da9a9b003e05", "--from", "draft.md", ...fragment],
    }).mapErr((error) => [error.message]),
  // `--to` belongs to the `move` sub-command alone, and `move` requires a different argument set from
  // `create` — so a fragment naming its own sub-command replaces the default preamble rather than being
  // appended to it, the same adaptation `datadog submit` makes for its required `--series`.
  "notion page": ({ fragment }) =>
    parseNotionPageArgs({
      argv:
        fragment[0] === "move"
          ? [...fragment]
          : ["create", "--parent", NOTION_PARENT, "--title", "T", "--body", "-", ...fragment],
    }).mapErr((error) => [error.message]),
  "notion read": ({ fragment }) =>
    parseProviderReadArgs({
      provider: "notion",
      rest: ["00000000-0000-0000-0000-000000000001", ...fragment],
    }).mapErr((error) => [error.message]),
  "notion verify": ({ fragment }) =>
    parseNotionVerifyArgs({ argv: ["00000000-0000-0000-0000-000000000001", ...fragment] }).mapErr((error) => [
      error.message,
    ]),
};

/** The rows for `atlas`, `hex` and `notion`. */
export const atlasHexAndNotionSlice: HelpTruthSlice = { guarded, probes, parsers };
