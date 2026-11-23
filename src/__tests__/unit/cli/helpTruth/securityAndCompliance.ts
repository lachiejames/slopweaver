/**
 * The help-truth tables' rows for `crowdstrike`, `identity`, `access-review`, `policy`, `audit`, `responders` and `incident` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { ACCESS_REVIEW_FLAG_NAMES, parseAccessReviewArgs } from "../../../../cli/commands/accessReview/options.js";
import { auditArgsErrorLines } from "../../../../cli/commands/audit/errors.js";
import { AUDIT_HYGIENE_FLAG_NAMES, parseAuditHygieneArgs } from "../../../../cli/commands/audit/hygieneRun.js";
import {
  AUDIT_PUBLICATIONS_FLAG_NAMES,
  parseAuditPublicationsArgs,
} from "../../../../cli/commands/audit/publicationsArgs.js";
import { AUDIT_REFERENCES_FLAG_NAMES, parseAuditReferencesArgs } from "../../../../cli/commands/audit/referencesRun.js";
import {
  CROWDSTRIKE_RECONCILE_FLAG_NAMES,
  CROWDSTRIKE_RESET_FLAG_NAMES,
  CROWDSTRIKE_SYNC_FLAG_NAMES,
  CROWDSTRIKE_WALK_FLAG_NAMES,
  parseCrowdstrikeReconcileOptions,
  parseCrowdstrikeResetOptions,
  parseCrowdstrikeSyncOptions,
  parseCrowdstrikeWalkOptions,
} from "../../../../cli/commands/crowdstrike/core.js";
import {
  IDENTITY_AVATARS_FLAG_NAMES,
  parseIdentityAvatarsArgs,
} from "../../../../cli/commands/identity/identityAvatars.js";
import {
  IDENTITY_NARROW_FLAG_NAMES,
  parseIdentityNarrowArgs,
} from "../../../../cli/commands/identity/identityNarrow.js";
import {
  IDENTITY_ORG_DOMAINS_FLAG_NAMES,
  parseIdentityOrgDomainsArgs,
} from "../../../../cli/commands/identity/identityOrgDomains.js";
import {
  IDENTITY_ROSTER_FLAG_NAMES,
  parseIdentityRosterArgs,
} from "../../../../cli/commands/identity/identityRoster.js";
import { INCIDENT_DETECT_FLAG_SPEC } from "../../../../cli/commands/incident/detect.js";
import { INCIDENT_NOTE_FLAG_SPEC } from "../../../../cli/commands/incident/note.js";
import { INCIDENT_POSTMORTEM_FLAG_SPEC } from "../../../../cli/commands/incident/postmortem.js";
import { INCIDENT_POSTMORTEMS_FLAG_SPEC } from "../../../../cli/commands/incident/postmortems.js";
import { POLICY_RENDER_FLAGS, parsePolicyRender } from "../../../../cli/commands/policy/core.js";
import { POLICY_DIFF_FLAGS, parsePolicyDiff } from "../../../../cli/commands/policy/diffCore.js";
import { parseRespondersListArgs, RESPONDERS_LIST_FLAG_NAMES } from "../../../../cli/commands/responders/list.js";
import { parseRespondersArgs, RESPONDERS_FLAG_NAMES } from "../../../../cli/commands/responders/run.js";
import { parseFlags } from "../../../../cli/parseFlags.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags, flagNamesOf, parseFlagsNamesOf } from "./sharedProbes.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "access-review former": ACCESS_REVIEW_FLAG_NAMES,
  "access-review platform": ACCESS_REVIEW_FLAG_NAMES,
  "access-review privileged": ACCESS_REVIEW_FLAG_NAMES,
  "policy diff": flagNamesOf({ spec: POLICY_DIFF_FLAGS }),
  "policy render": flagNamesOf({ spec: POLICY_RENDER_FLAGS }),
  "crowdstrike reconcile": CROWDSTRIKE_RECONCILE_FLAG_NAMES,
  "crowdstrike reset": CROWDSTRIKE_RESET_FLAG_NAMES,
  "crowdstrike sync": CROWDSTRIKE_SYNC_FLAG_NAMES,
  "crowdstrike walk": CROWDSTRIKE_WALK_FLAG_NAMES,
  "audit hygiene": AUDIT_HYGIENE_FLAG_NAMES,
  "audit publications": AUDIT_PUBLICATIONS_FLAG_NAMES,
  "audit references": AUDIT_REFERENCES_FLAG_NAMES,
  "identity avatars": IDENTITY_AVATARS_FLAG_NAMES,
  "identity narrow": IDENTITY_NARROW_FLAG_NAMES,
  "identity roster": IDENTITY_ROSTER_FLAG_NAMES,
  "identity org-domains": IDENTITY_ORG_DOMAINS_FLAG_NAMES,
  "incident detect": parseFlagsNamesOf({ spec: INCIDENT_DETECT_FLAG_SPEC }),
  "incident note": parseFlagsNamesOf({ spec: INCIDENT_NOTE_FLAG_SPEC }),
  "incident postmortem": parseFlagsNamesOf({ spec: INCIDENT_POSTMORTEM_FLAG_SPEC }),
  "incident postmortems": parseFlagsNamesOf({ spec: INCIDENT_POSTMORTEMS_FLAG_SPEC }),
  "responders add": RESPONDERS_FLAG_NAMES,
  "responders list": RESPONDERS_LIST_FLAG_NAMES,
  "responders remove": RESPONDERS_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "access-review former": { "--home": ["--home", "/tmp"], "--json": ["--json"] },
  "access-review platform": { "--home": ["jumpcloud", "--home", "/tmp"], "--json": ["jumpcloud", "--json"] },
  "access-review privileged": { "--home": ["--home", "/tmp"], "--json": ["--json"] },
  "policy diff": {
    "--home": ["--home", "/tmp/policy-probe-home"],
    "--json": ["--json"],
    "--out": ["--out", "/tmp/evidence-diff"],
    "--record": ["--record", "evidence-diff.json"],
  },
  "policy render": {
    "--file": ["--file", "policies/ai-acceptable-use-policy.md"],
    "--json": ["--json"],
    "--out": ["--out", "/tmp/ai.pdf"],
  },
  "crowdstrike sync": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "crowdstrike reconcile": {
    "--fleet": ["--fleet", "/tmp/fleet.json"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "crowdstrike walk": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "5"],
  },
  "crowdstrike reset": {
    "--confirm": ["--confirm", "archive"],
    "--home": ["--confirm", "archive", "--home", "/tmp"],
    "--json": ["--confirm", "archive", "--json"],
  },
  "audit hygiene": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--scrub": ["--scrub"],
    "--source": ["--source", "gmail"],
  },
  "audit publications": {
    // The two travel together: either alone is refused by name.
    "--by-session": ["--by-session", "recipe:x", "--fire"],
    "--expect": ["--expect", "github:private-term/money:https://github.com/acme/widgets/pull/1"],
    "--fire": ["--fire", "--by-session", "recipe:x"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--repo": ["--repo", "acme/widgets"],
  },
  "audit references": {
    "--home": ["--home", "/tmp"],
    "--indirect": ["--indirect"],
    "--json": ["--json"],
    "--list": ["--list"],
    "--map": ["--map", "/tmp/map.tsv"],
    "--no-page": ["--no-page"],
    "--ref": ["--ref", "main"],
  },
  "identity avatars": {
    "--home": ["--home", "/tmp"],
    "--ids": ["--ids", "U1,U2"],
    "--json": ["--json"],
    "--source": ["--source", "github"],
  },
  "identity narrow": {
    "--answer": ["--answer", "PICK none"],
    "--asked-by": ["--asked-by", "a colleague"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--question": ["--question", "who is this"],
  },
  "identity roster": {
    "--expect-revision": ["replace", "--file", "/tmp/roster.json", "--expect-revision", "3"],
    "--file": ["replace", "--file", "/tmp/roster.json", "--expect-revision", "none"],
    "--home": ["show", "--home", "/tmp"],
    "--json": ["show", "--json"],
  },
  "identity org-domains": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "responders add": {
    "--home": ["--home", "/tmp"],
    "--reason": ["--reason", "owner asked live in Slack"],
    "--user": ["--user", "U0NEW"],
  },
  "responders list": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "responders remove": {
    "--home": ["--home", "/tmp"],
    "--reason": ["--reason", "no longer needed"],
    "--user": ["--user", "U0NEW"],
  },
  "incident detect": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-10-04T05:00:00.000Z"],
    "--since": ["--since", "2026-10-01T00:00:00.000Z"],
  },
  "incident note": {
    "--by-session": ["--form", "/tmp/form.json", "--by-session", "a-seat"],
    "--dry-run": ["--form", "/tmp/form.json", "--dry-run"],
    "--form": ["--form", "/tmp/form.json"],
    "--home": ["--form", "/tmp/form.json", "--home", "/tmp"],
    "--json": ["--form", "/tmp/form.json", "--json"],
    "--quiet": ["--form", "/tmp/form.json", "--quiet"],
  },
  "incident postmortem": {
    "--by-session": ["--form", "/tmp/form.json", "--by-session", "a-seat"],
    "--dry-run": ["--form", "/tmp/form.json", "--dry-run"],
    "--form": ["--form", "/tmp/form.json"],
    "--home": ["--form", "/tmp/form.json", "--home", "/tmp"],
    "--json": ["--form", "/tmp/form.json", "--json"],
    "--quiet": ["--form", "/tmp/form.json", "--quiet"],
  },
  "incident postmortems": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "access-review former": ({ fragment }) => parseAccessReviewArgs({ rest: fragment, takesPlatform: false }),
  "access-review platform": ({ fragment }) => parseAccessReviewArgs({ rest: fragment, takesPlatform: true }),
  "access-review privileged": ({ fragment }) => parseAccessReviewArgs({ rest: fragment, takesPlatform: false }),
  // `diff` requires both `--record` and `--out`, so each probe rides on a base carrying them.
  "policy diff": ({ fragment }) =>
    parsePolicyDiff({
      defaultHome: "/tmp/policy-probe-home",
      rest: dedupeFlags({ base: ["--record", "r.json", "--out", "/tmp/evidence-diff"], fragment }),
    }),
  // `render` requires `--file` and `--out`, so its probe rides on a base carrying them — `dedupeFlags`
  // drops the base's copy of whichever one the probe itself names.
  "policy render": ({ fragment }) =>
    parsePolicyRender({ rest: dedupeFlags({ base: ["--file", "a.md", "--out", "/tmp/a.pdf"], fragment }) }),
  "crowdstrike sync": ({ fragment }) => parseCrowdstrikeSyncOptions({ defaultHome: "/tmp/home", rest: [...fragment] }),
  "crowdstrike reconcile": ({ fragment }) =>
    parseCrowdstrikeReconcileOptions({ defaultHome: "/tmp/home", rest: [...fragment] }),
  "crowdstrike walk": ({ fragment }) =>
    parseCrowdstrikeWalkOptions({ defaultHome: "/tmp/home", rest: [...fragment] }).mapErr((error) => [error.message]),
  // `--confirm archive` is required, so a fragment probing any OTHER flag carries it too — otherwise every
  // probe reports the missing confirmation instead of the flag it was meant to test.
  "crowdstrike reset": ({ fragment }) =>
    parseCrowdstrikeResetOptions({ defaultHome: "/tmp/home", rest: [...fragment] }).mapErr((error) => [error.message]),
  "audit hygiene": ({ fragment }) =>
    parseAuditHygieneArgs({ rest: [...fragment] }).mapErr((error) => auditArgsErrorLines({ error })),
  "audit publications": ({ fragment }) => parseAuditPublicationsArgs({ rest: [...fragment] }),
  "audit references": ({ fragment }) =>
    parseAuditReferencesArgs({ rest: [...fragment] }).mapErr((error) => auditArgsErrorLines({ error })),
  "identity narrow": ({ fragment }) => parseIdentityNarrowArgs({ rest: ["a-token", ...fragment] }),
  "identity avatars": ({ fragment }) => parseIdentityAvatarsArgs({ rest: [...fragment] }),
  "identity org-domains": ({ fragment }) => parseIdentityOrgDomainsArgs({ rest: [...fragment] }),
  "identity roster": ({ fragment }) =>
    parseIdentityRosterArgs({ rest: [...fragment] }).mapErr((error) => [error.message]),
  "incident detect": ({ fragment }) => parseFlags({ args: fragment, spec: INCIDENT_DETECT_FLAG_SPEC }),
  "incident note": ({ fragment }) => parseFlags({ args: fragment, spec: INCIDENT_NOTE_FLAG_SPEC }),
  "incident postmortem": ({ fragment }) => parseFlags({ args: fragment, spec: INCIDENT_POSTMORTEM_FLAG_SPEC }),
  "incident postmortems": ({ fragment }) => parseFlags({ args: fragment, spec: INCIDENT_POSTMORTEMS_FLAG_SPEC }),
  "responders add": ({ fragment }) => parseRespondersArgs({ rest: [...fragment] }),
  "responders list": ({ fragment }) => parseRespondersListArgs({ rest: [...fragment] }),
  "responders remove": ({ fragment }) => parseRespondersArgs({ rest: [...fragment] }),
};

/** The rows for `crowdstrike`, `identity`, `access-review`, `policy`, `audit`, `responders` and `incident`. */
export const securityAndComplianceSlice: HelpTruthSlice = { guarded, probes, parsers };
