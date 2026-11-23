/**
 * The help-truth tables' rows for `linear`'s write verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { LINEAR_ATTACH_FLAG_NAMES, parseLinearAttachArgs } from "../../../../cli/commands/linear/attachCore.js";
import { LINEAR_COMMENT_FLAG_NAMES, parseLinearCommentArgs } from "../../../../cli/commands/linear/commentCore.js";
import { LINEAR_ISSUE_FLAG_NAMES, parseLinearIssueArgs } from "../../../../cli/commands/linear/core.js";
import { LINEAR_DOCUMENT_FLAG_NAMES, parseLinearDocumentArgs } from "../../../../cli/commands/linear/documentCore.js";
import { linearVerbErrorLines } from "../../../../cli/commands/linear/errors.js";
import {
  LINEAR_INITIATIVE_FLAG_NAMES,
  parseLinearInitiativeArgs,
} from "../../../../cli/commands/linear/initiativeCore.js";
import {
  LINEAR_INITIATIVE_UPDATE_FLAG_NAMES,
  parseLinearInitiativeUpdateArgs,
} from "../../../../cli/commands/linear/initiativeUpdateCore.js";
import { LINEAR_LABEL_FLAG_NAMES, parseLinearLabelArgs } from "../../../../cli/commands/linear/labelCore.js";
import {
  LINEAR_MILESTONE_FLAG_NAMES,
  parseLinearMilestoneArgs,
} from "../../../../cli/commands/linear/milestoneCore.js";
import {
  LINEAR_MOVE_ISSUES_FLAG_NAMES,
  parseLinearMoveIssuesArgs,
} from "../../../../cli/commands/linear/moveIssuesCore.js";
import { LINEAR_PROJECT_FLAG_NAMES, parseLinearProjectArgs } from "../../../../cli/commands/linear/projectCore.js";
import {
  LINEAR_PROJECT_UPDATE_FLAG_NAMES,
  parseLinearProjectUpdateArgs,
} from "../../../../cli/commands/linear/projectUpdateCore.js";
import { LINEAR_RELATION_FLAG_NAMES, parseLinearRelationArgs } from "../../../../cli/commands/linear/relationCore.js";
import {
  LINEAR_TEAM_MEMBERSHIP_FLAG_NAMES,
  parseTeamMembershipArgs,
} from "../../../../cli/commands/linear/teamMembershipCore.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

/** `linear issue --unasked` and its three accounts, which only stand together. */
const LINEAR_UNASKED_PROBE: readonly string[] = [
  "--unasked",
  "--why",
  "it was obvious",
  "--said",
  "Moved it to In Progress.",
  "--by-session",
  "s",
];

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "linear attach": LINEAR_ATTACH_FLAG_NAMES,
  "linear comment": LINEAR_COMMENT_FLAG_NAMES,
  "linear document": LINEAR_DOCUMENT_FLAG_NAMES,
  "linear initiative": LINEAR_INITIATIVE_FLAG_NAMES,
  "linear initiative-update": LINEAR_INITIATIVE_UPDATE_FLAG_NAMES,
  "linear project-update": LINEAR_PROJECT_UPDATE_FLAG_NAMES,
  "linear issue": LINEAR_ISSUE_FLAG_NAMES,
  "linear label": LINEAR_LABEL_FLAG_NAMES,
  "linear move-issues": LINEAR_MOVE_ISSUES_FLAG_NAMES,
  "linear milestone": LINEAR_MILESTONE_FLAG_NAMES,
  "linear project": LINEAR_PROJECT_FLAG_NAMES,
  "linear relation": LINEAR_RELATION_FLAG_NAMES,
  "linear team-membership": LINEAR_TEAM_MEMBERSHIP_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "linear attach": {
    "--acknowledge": ["--acknowledge", "the staging dashboard was down all morning"],
    "--alt": ["--alt", "the failing panel"],
    "--dry-run": ["--dry-run"],
    "--file": [],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "linear comment": {
    "--dry-run": ["--dry-run"],
    "--form": [],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--mention-id": ["--mention-id", "cj=3f2504e0-4f89-41d3-9a0c-0305e82c3301"],
  },
  "linear initiative": {
    "--dry-run": ["--dry-run"],
    "--form": [],
    "--home": ["--home", "/tmp"],
    "--initiative-id": ["--initiative-id", "3f2504e0-4f89-41d3-9a0c-0305e82c3301"],
    "--json": ["--json"],
  },
  "linear initiative-update": {
    "--dry-run": ["--dry-run"],
    "--form": [],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "linear project-update": {
    "--dry-run": ["--dry-run"],
    "--form": [],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "linear issue": {
    "--dry-run": ["--dry-run"],
    "--fields-only": ["--fields-only"],
    "--form": [],
    "--home": ["--home", "/tmp"],
    "--issue-id": ["--issue-id", "3f2504e0-4f89-41d3-9a0c-0305e82c3301"],
    "--json": ["--json"],
    "--mention-id": ["--mention-id", "cj=3f2504e0-4f89-41d3-9a0c-0305e82c3301"],
    "--move-team": ["--issue-id", "3f2504e0-4f89-41d3-9a0c-0305e82c3301", "--move-team"],
    "--rewrite-filed": [
      "--issue-id",
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      "--rewrite-filed",
      "--expect-updated-at",
      "2026-10-01T09:00:00.000Z",
    ],
    "--expect-updated-at": [
      "--issue-id",
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      "--rewrite-filed",
      "--expect-updated-at",
      "2026-10-01T09:00:00.000Z",
    ],
    "--unasked": LINEAR_UNASKED_PROBE,
    "--why": LINEAR_UNASKED_PROBE,
    "--said": LINEAR_UNASKED_PROBE,
    "--by-session": LINEAR_UNASKED_PROBE,
  },
  "linear milestone": {
    "--dry-run": ["--dry-run"],
    "--form": [],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "linear project": {
    "--dry-run": ["--dry-run"],
    "--form": [],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--project-id": ["--project-id", "3f2504e0-4f89-41d3-9a0c-0305e82c3301"],
  },
  "linear document": {
    "--document-id": ["--document-id", "3f2504e0-4f89-41d3-9a0c-0305e82c3301"],
    "--dry-run": ["--dry-run"],
    "--form": [],
    "--home": ["--home", "/tmp"],
    "--mention-id": ["--mention-id", "cj=3f2504e0-4f89-41d3-9a0c-0305e82c3301"],
  },
  "linear relation": {
    "--dry-run": ["--dry-run"],
    "--form": [],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "linear label": {
    "--dry-run": ["--dry-run"],
    "--form": [],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "linear move-issues": {
    "--apply": ["--apply"],
    "--home": ["--home", "/tmp"],
    "--identifier": ["--identifier", "SUP-1,SUP-2"],
    "--json": ["--json"],
    "--to": ["--to", "SOPS"],
  },
  "linear team-membership": {
    "--apply": ["--apply"],
    "--by-session": LINEAR_UNASKED_PROBE,
    "--home": ["--home", "/tmp"],
    "--said": LINEAR_UNASKED_PROBE,
    "--team": [],
    "--unasked": LINEAR_UNASKED_PROBE,
    "--why": LINEAR_UNASKED_PROBE,
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "linear attach": ({ fragment }) =>
    parseLinearAttachArgs({ rest: ["upload", "--file", "a.png", ...fragment] }).mapErr((error) =>
      linearVerbErrorLines({ error }),
    ),
  "linear comment": ({ fragment }) =>
    parseLinearCommentArgs({ argv: ["create", "--form", "-", ...fragment] }).mapErr((error) =>
      linearVerbErrorLines({ error }),
    ),
  "linear initiative": ({ fragment }) =>
    parseLinearInitiativeArgs({ argv: ["create", "--form", "-", ...fragment] }).mapErr((error) =>
      linearVerbErrorLines({ error }),
    ),
  "linear initiative-update": ({ fragment }) =>
    parseLinearInitiativeUpdateArgs({ argv: ["create", "--form", "-", ...fragment] }).mapErr((error) =>
      linearVerbErrorLines({ error }),
    ),
  "linear project-update": ({ fragment }) =>
    parseLinearProjectUpdateArgs({ argv: ["create", "--form", "-", ...fragment] }).mapErr((error) =>
      linearVerbErrorLines({ error }),
    ),
  // A fragment naming an issue probes `update`: `--move-team` and `--rewrite-filed` are update-only.
  "linear issue": ({ fragment }) =>
    parseLinearIssueArgs({
      argv: [fragment.includes("--issue-id") ? "update" : "create", "--form", "-", ...fragment],
    }).mapErr((error) => linearVerbErrorLines({ error })),
  "linear milestone": ({ fragment }) =>
    parseLinearMilestoneArgs({ argv: ["create", "--form", "-", ...fragment] }).mapErr((error) =>
      linearVerbErrorLines({ error }),
    ),
  "linear project": ({ fragment }) =>
    parseLinearProjectArgs({ argv: ["create", "--form", "-", ...fragment] }).mapErr((error) =>
      linearVerbErrorLines({ error }),
    ),
  // A fragment naming a document probes `update`: `--document-id` is refused on a create.
  "linear document": ({ fragment }) =>
    parseLinearDocumentArgs({
      argv: [fragment.includes("--document-id") ? "update" : "create", "--form", "-", ...fragment],
    }).mapErr((error) => linearVerbErrorLines({ error })),
  "linear relation": ({ fragment }) =>
    parseLinearRelationArgs({ argv: ["create", "--form", "-", ...fragment] }).mapErr((error) =>
      linearVerbErrorLines({ error }),
    ),
  "linear label": ({ fragment }) =>
    parseLinearLabelArgs({ argv: ["create", "--form", "-", ...fragment] }).mapErr((error) =>
      linearVerbErrorLines({ error }),
    ),
  // Both value flags are required and a repeat is refused, so the base supplies whichever the fragment does not.
  "linear move-issues": ({ fragment }) =>
    parseLinearMoveIssuesArgs({
      rest: [
        ...(fragment.includes("--to") ? [] : ["--to", "SOPS"]),
        ...(fragment.includes("--identifier") ? [] : ["--identifier", "SUP-1"]),
        ...fragment,
      ],
    }).mapErr((error) => linearVerbErrorLines({ error })),
  "linear team-membership": ({ fragment }) =>
    parseTeamMembershipArgs({ argv: ["join", "--team", "ENG", ...fragment] }).mapErr((error) =>
      linearVerbErrorLines({ error }),
    ),
};

/** The rows for `linear`'s write verbs. */
export const linearWritesSlice: HelpTruthSlice = { guarded, probes, parsers };
