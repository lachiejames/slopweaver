/**
 * The help-truth tables' rows for `handover`'s board verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import {
  HANDOVER_REGISTER_FLAG_NAMES,
  parseHandoverRegisterArgs,
} from "../../../../cli/commands/handover/askRowArgs.js";
import { HANDOVER_LIFECYCLE_FLAG_NAMES, parseLifecycleArgs } from "../../../../cli/commands/handover/lifecycleRun.js";
import { listTagArgs } from "../../../../cli/commands/handover/listTagArgs.js";
import { HANDOVER_PRUNE_FLAG_NAMES, parseHandoverPruneArgs } from "../../../../cli/commands/handover/pruneRun.js";
import { HANDOVER_REAP_FLAG_NAMES, parseHandoverReapArgs } from "../../../../cli/commands/handover/reapRun.js";
import {
  HANDOVER_RECONCILE_FLAG_NAMES,
  parseHandoverReconcileArgs,
} from "../../../../cli/commands/handover/reconcileRun.js";
import { HANDOVER_RISK_FLAG_NAMES, parseHandoverRiskArgs } from "../../../../cli/commands/handover/riskRun.js";
import { HANDOVER_ROW_FLAG_NAMES, parseHandoverRowArgs } from "../../../../cli/commands/handover/rowRun.js";
import { HANDOVER_LIST_FLAG_NAMES, parseHandoverListArgs } from "../../../../cli/commands/handover/run.js";
import {
  HANDOVER_SET_PRIORITY_FLAG_NAMES,
  parseHandoverSetPriorityArgs,
} from "../../../../cli/commands/handover/setPriorityRun.js";
import {
  HANDOVER_SET_REPO_FLAG_NAMES,
  parseHandoverSetRepoArgs,
} from "../../../../cli/commands/handover/setRepoRun.js";
import {
  HANDOVER_SET_WORKSPACE_FLAG_NAMES,
  parseHandoverSetWorkspaceArgs,
} from "../../../../cli/commands/handover/setWorkspaceRun.js";
import { HANDOVER_TAG_FLAG_NAMES, parseHandoverTagArgs } from "../../../../cli/commands/handover/tagRun.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "handover amend": HANDOVER_LIFECYCLE_FLAG_NAMES["amend"]!,
  "handover answer": HANDOVER_LIFECYCLE_FLAG_NAMES["answer"]!,
  "handover ask": HANDOVER_LIFECYCLE_FLAG_NAMES["ask"]!,
  "handover offer": HANDOVER_LIFECYCLE_FLAG_NAMES["offer"]!,
  "handover reconfirm": HANDOVER_LIFECYCLE_FLAG_NAMES["reconfirm"]!,
  "handover withdraw": HANDOVER_LIFECYCLE_FLAG_NAMES["withdraw"]!,
  "handover correct": HANDOVER_LIFECYCLE_FLAG_NAMES["correct"]!,
  "handover list": HANDOVER_LIST_FLAG_NAMES,
  "handover prune": HANDOVER_PRUNE_FLAG_NAMES,
  "handover reap": HANDOVER_REAP_FLAG_NAMES,
  "handover reconcile": HANDOVER_RECONCILE_FLAG_NAMES,
  "handover register": HANDOVER_REGISTER_FLAG_NAMES,
  "handover risk": HANDOVER_RISK_FLAG_NAMES,
  "handover set-repo": HANDOVER_SET_REPO_FLAG_NAMES,
  "handover set-workspace": HANDOVER_SET_WORKSPACE_FLAG_NAMES,
  "handover set-priority": HANDOVER_SET_PRIORITY_FLAG_NAMES,
  "handover tag": HANDOVER_TAG_FLAG_NAMES,
  "handover row": HANDOVER_ROW_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "handover amend": {
    "--base": ["--base", "main"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--why": ["--why", "scope moved"],
  },
  "handover answer": {
    "--answer": ["--answer", "use main"],
    "--base": ["--base", "main"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
  },
  "handover ask": {
    // `--action` takes the JSON document itself, which is one of its three legal spellings — the other two
    // reach a file and stdin, neither of which a parse-only probe may touch.
    "--action": ["--action", '{"version":1,"actor":"me","body":"b","mentions":[],"destinations":[]}'],
    "--base": ["--base", "main"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--lean": ["--lean", "main — every other run is on it"],
    "--options": ["--options", "main :: nothing\nthe release branch :: one more rebase"],
    "--problem": ["--problem", "the doc names two base branches"],
    "--question": ["--question", "which base?"],
    "--risk": ["--risk", "a run starts on the wrong base"],
    "--blast-radius": ["--blast-radius", "this one doc"],
    "--still-real": ["--still-real", "the doc still names both"],
    "--example": ["--example", "You open the PR and it sits on the release branch. Should it be on main?"],
    "--example-gap": ["--example-gap", "the doc records no event a scene could be built from"],
    "--read-owner-words": ["--read-owner-words", "talk-000000000001,talk-000000000002"],
  },
  "handover offer": {
    "--action": ["--action", '{"version":1,"actor":"me","body":"b","mentions":[],"destinations":[]}'],
    "--base": ["--base", "main"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--lean": ["--lean", "post it — the room is waiting"],
    "--problem": ["--problem", "nobody has replied in the thread"],
    "--risk": ["--risk", "the thread moves on without us"],
    "--blast-radius": ["--blast-radius", "one thread"],
    "--still-real": ["--still-real", "the thread still has no reply"],
  },
  "handover reconfirm": {
    "--base": ["--base", "main"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--still-real": ["--still-real", "the doc still names both"],
  },
  "handover withdraw": {
    "--base": ["--base", "main"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--why": ["--why", "the last three runs are green"],
  },
  "handover correct": {
    "--base": ["--base", "main"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--question": ["--question", "which base, really?"],
    "--still-real": ["--still-real", "the doc still cites both branches"],
    "--why": ["--why", "overstated"],
  },
  "handover reap": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-09-01T00:00:00Z"],
  },
  "handover prune": {
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-09-01T00:00:00Z"],
    "--priority": ["--priority", "p0"],
    "--verdicts": ["--verdicts"],
  },
  "handover reconcile": {
    "--dir": ["--dir", "/tmp"],
    "--full": ["--full"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-09-01T00:00:00Z"],
  },
  "handover register": {
    "--anchor": ["--anchor", "https://example.invalid/p1"],
    "--ask": ["--ask", "account for every stuck chat"],
    "--asked-iso": ["--asked-iso", "2026-08-30T23:08:43Z"],
    "--asked-ts": ["--asked-ts", "1788220579.306599"],
    "--bears-on": ["--bears-on", "the owner already said the count belongs on listen status"],
    "--example": ["--example", "You open listen status and it says all clear. Would you rather it counted?"],
    "--example-gap": ["--example-gap", "the row records no event the owner saw"],
    "--branch": ["--branch", "feature/one"],
    "--dir": ["--dir", "/tmp"],
    "--dispatch": ["--dispatch"],
    "--evidence": ["--evidence", "owner/repo#1,owner/repo#2"],
    "--full": ["--full"],
    "--finding": ["--finding"],
    "--home": ["--home", "/tmp"],
    "--keep-lines": ["--dispatch", "--keep-lines"],
    "--lean": ["--lean", "count them — an unknown number is what the board is for"],
    "--observed-by": ["--observed-by", "session-1"],
    "--options": ["--options", "count them :: one more field\nleave it :: the number stays unknown"],
    "--priority": ["--priority", "p1"],
    "--problem": ["--problem", "nothing counts the stuck ones"],
    "--repo": ["--repo", "/tmp/repo"],
    "--risk": ["--risk", "a stuck chat goes unnoticed"],
    "--blast-radius": ["--blast-radius", "every open chat"],
    "--still-real": ["--still-real", "the board still has no count"],
    "--slug": ["--slug", "a-slug"],
    "--tag": ["--tag", "platform=slack,workstream=iso-certification"],
    "--new-value": ["--new-value", "workstream=iso-certification"],
    "--workspace": ["--workspace", "team", "--workspace-because", "a pull request in acme-admin"],
    "--workspace-because": ["--workspace", "self", "--workspace-because", "the installation's own state"],
  },
  "handover risk": {
    "--clear": ["--clear"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--why": ["--why", "the document verb has not landed"],
  },
  "handover set-repo": {
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--repo": ["--repo", "/tmp"],
  },
  "handover set-workspace": {
    "--because": ["--because", "the ISO audit is the organisation's"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--respell": ["--respell"],
    "--workspace": ["--workspace", "team"],
  },
  "handover set-priority": {
    "--apply": ["--apply"],
    "--backfill": ["--backfill"],
    "--because": ["--because", "the audit gate is Friday"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--priority": ["--priority", "p0"],
  },
  "handover tag": {
    "--drop": ["--drop", "impact,workstream=hiring"],
    "--home": ["--home", "/tmp"],
    "--new-value": ["--new-value", "workstream=iso-certification"],
    "--why": ["--why", "ISO certification work"],
  },
  "handover list": {
    "--all": ["--all"],
    "--base": ["--base", "main"],
    "--deadline": ["--deadline", "30"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--probe": ["--probe"],
    "--tag": ["--tag", "platform=slack,!impact"],
  },
  "handover row": {
    "--base": ["--base", "main"],
    "--dir": ["--dir", "/tmp"],
    "--full": ["--full"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--slug": ["--slug", "a-slug"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "handover amend": ({ fragment }) => parseLifecycleArgs({ rest: ["a-slug", ...fragment], verb: "amend" }),
  "handover answer": ({ fragment }) => parseLifecycleArgs({ rest: ["a-slug", ...fragment], verb: "answer" }),
  "handover ask": ({ fragment }) => parseLifecycleArgs({ rest: ["a-slug", ...fragment], verb: "ask" }),
  "handover offer": ({ fragment }) => parseLifecycleArgs({ rest: ["a-slug", ...fragment], verb: "offer" }),
  "handover reconfirm": ({ fragment }) => parseLifecycleArgs({ rest: ["a-slug", ...fragment], verb: "reconfirm" }),
  "handover withdraw": ({ fragment }) => parseLifecycleArgs({ rest: ["a-slug", ...fragment], verb: "withdraw" }),
  "handover correct": ({ fragment }) => parseLifecycleArgs({ rest: ["a-slug", ...fragment], verb: "correct" }),
  "handover prune": ({ fragment }) => parseHandoverPruneArgs({ rest: [...fragment] }),
  "handover reap": ({ fragment }) => parseHandoverReapArgs({ rest: [...fragment] }),
  "handover reconcile": ({ fragment }) => parseHandoverReconcileArgs({ rest: [...fragment] }),
  "handover register": ({ fragment }) => parseHandoverRegisterArgs({ rest: [...fragment] }),
  "handover risk": ({ fragment }) => parseHandoverRiskArgs({ rest: ["a-slug", ...fragment] }),
  "handover set-repo": ({ fragment }) => parseHandoverSetRepoArgs({ rest: ["a-slug", ...fragment] }),
  "handover set-workspace": ({ fragment }) => parseHandoverSetWorkspaceArgs({ rest: ["a-slug", ...fragment] }),
  "handover set-priority": ({ fragment }) => parseHandoverSetPriorityArgs({ rest: ["a-slug", ...fragment] }),
  "handover tag": ({ fragment }) => parseHandoverTagArgs({ rest: ["a-slug", "impact=high", ...fragment] }),
  "handover list": ({ fragment }) =>
    listTagArgs({ rest: [...fragment] }).andThen((args) => parseHandoverListArgs({ rest: args.rest })),
  "handover row": ({ fragment }) => parseHandoverRowArgs({ rest: [...fragment] }),
};

/** The rows for `handover`'s board verbs. */
export const handoverBoardSlice: HelpTruthSlice = { guarded, probes, parsers };
