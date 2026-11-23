/**
 * The help-truth tables' rows for `gcp`, `alias`, `secrets` and `onepassword` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import {
  ALIAS_CATCH_ALL_FLAG_NAMES,
  ALIAS_LIST_FLAG_NAMES,
  ALIAS_PROVISION_FLAG_NAMES,
  parseAliasCatchAllArgs,
  parseAliasListArgs,
  parseAliasProvisionArgs,
} from "../../../../cli/commands/alias/core.js";
import { type GcpFamily, gcpFlagNames, parseGcpInvocation } from "../../../../cli/commands/gcp/gcpCore.js";
import {
  ONEPASSWORD_RESET_FLAG_NAMES,
  ONEPASSWORD_SYNC_FLAG_NAMES,
  parseOnepasswordResetOptions,
  parseOnepasswordSyncOptions,
} from "../../../../cli/commands/onepassword/core.js";
import { parseSecretsStatusArgs, SECRETS_STATUS_FLAG_NAMES } from "../../../../cli/commands/secrets/statusCore.js";
import { type Result } from "../../../../lib/result.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

/** The home every alias probe resolves against — never touched, since a parse is pure. */
const ALIAS_PROBE_HOME = "/tmp/slopweaver-alias-probe-home";

/** A complete `alias provision` invocation: all five flags are required, so every probe carries them. */
const ALIAS_PROVISION_BASE: readonly string[] = [
  "--domain",
  "acme.com",
  "--identity",
  "ada-lovelace",
  "--provider",
  "claude",
  "--label",
  "five",
  "--destination",
  "ops@acme.com",
];

/** The coordinates each `gcp` probe names, so a probe for one flag is a valid invocation of its action. */
const GCP_RUN_BASE: readonly string[] = [
  "--project",
  "my-project-01",
  "--region",
  "australia-southeast1",
  "--service",
  "desktop-api",
];

const GCP_RUN_DEPLOY_BASE: readonly string[] = [
  ...GCP_RUN_BASE,
  "--image",
  "australia-southeast1-docker.pkg.dev/my-project-01/desktop/api:a881f5e4",
];

const GCP_SECRET_BASE: readonly string[] = ["--project", "my-project-01", "--secret", "desktop_client_id"];

const GCP_SERVICES_BASE: readonly string[] = ["--project", "my-project-01", "--service", "run.googleapis.com"];

const GCP_REPOSITORY_BASE: readonly string[] = [
  "--project",
  "my-project-01",
  "--region",
  "australia-southeast1",
  "--repository",
  "desktop",
];

/** Parse a `gcp` probe through the family's real parser. */
function gcpParse({ family, fragment }: { family: GcpFamily; fragment: readonly string[] }): Result<unknown> {
  return parseGcpInvocation({ family, rest: [...fragment] }).mapErr((error) => [error.message]);
}

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "alias catch-all": ALIAS_CATCH_ALL_FLAG_NAMES,
  "alias list": ALIAS_LIST_FLAG_NAMES,
  "alias provision": ALIAS_PROVISION_FLAG_NAMES,
  "onepassword reset": ONEPASSWORD_RESET_FLAG_NAMES,
  "onepassword sync": ONEPASSWORD_SYNC_FLAG_NAMES,
  "gcp artifacts": gcpFlagNames({ family: "artifacts" }),
  "gcp run": gcpFlagNames({ family: "run" }),
  "gcp secret": gcpFlagNames({ family: "secret" }),
  "gcp service-account": gcpFlagNames({ family: "service-account" }),
  "gcp services": gcpFlagNames({ family: "services" }),
  "secrets status": SECRETS_STATUS_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  // `--domain` is required on all three, so every fragment carries it or each probe would report the same
  // missing-zone error instead of the flag it is about. `catch-all` needs one of `--enable`/`--disable` for
  // the same reason, and `--destination` is probed under `--enable`, which is the only shape that takes one.
  "alias catch-all": {
    "--destination": ["--domain", "acme.com", "--enable", "--destination", "ops@acme.com"],
    "--disable": ["--domain", "acme.com", "--disable"],
    "--domain": ["--domain", "acme.com", "--disable"],
    "--enable": ["--domain", "acme.com", "--enable", "--destination", "ops@acme.com"],
    "--home": ["--domain", "acme.com", "--disable", "--home", "/tmp/alias-probe-home"],
    "--json": ["--domain", "acme.com", "--disable", "--json"],
  },
  "alias list": {
    "--domain": ["--domain", "acme.com"],
    "--home": ["--domain", "acme.com", "--home", "/tmp/alias-probe-home"],
    "--json": ["--domain", "acme.com", "--json"],
  },
  "alias provision": {
    "--destination": [...ALIAS_PROVISION_BASE],
    "--domain": [...ALIAS_PROVISION_BASE],
    "--home": [...ALIAS_PROVISION_BASE, "--home", "/tmp/alias-probe-home"],
    "--identity": [...ALIAS_PROVISION_BASE],
    "--json": [...ALIAS_PROVISION_BASE, "--json"],
    "--label": [...ALIAS_PROVISION_BASE],
    "--provider": [...ALIAS_PROVISION_BASE],
  },
  "onepassword sync": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--since": ["--since", "2026-08-01T00:00:00Z"],
  },
  "onepassword reset": {
    "--confirm": ["--confirm", "archive"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "gcp artifacts": {
    "--approve": ["create", ...GCP_REPOSITORY_BASE, "--approve", "gcp-0123456789abcdef"],
    "--description": ["create", ...GCP_REPOSITORY_BASE, "--description", "desktop images"],
    "--home": ["create", ...GCP_REPOSITORY_BASE, "--home", "/tmp"],
    "--json": ["describe", ...GCP_REPOSITORY_BASE, "--json"],
    "--project": ["describe", ...GCP_REPOSITORY_BASE],
    "--region": ["describe", ...GCP_REPOSITORY_BASE],
    "--repository": ["describe", ...GCP_REPOSITORY_BASE],
  },
  "gcp run": {
    "--allow-unauthenticated": ["deploy", ...GCP_RUN_DEPLOY_BASE, "--allow-unauthenticated"],
    "--approve": ["deploy", ...GCP_RUN_DEPLOY_BASE, "--approve", "gcp-0123456789abcdef"],
    "--edit-existing": ["deploy", ...GCP_RUN_DEPLOY_BASE, "--edit-existing", "the owner asked for this rollout"],
    "--home": ["deploy", ...GCP_RUN_DEPLOY_BASE, "--home", "/tmp"],
    "--image": ["deploy", ...GCP_RUN_DEPLOY_BASE],
    "--json": ["describe", ...GCP_RUN_BASE, "--json"],
    "--project": ["describe", ...GCP_RUN_BASE],
    "--region": ["describe", ...GCP_RUN_BASE],
    "--remove-env": ["deploy", ...GCP_RUN_DEPLOY_BASE, "--remove-env", "OLD_FLAG,LEGACY_URL"],
    "--service": ["describe", ...GCP_RUN_BASE],
    "--service-account": [
      "deploy",
      ...GCP_RUN_DEPLOY_BASE,
      "--service-account",
      "desktop-api@my-project-01.iam.gserviceaccount.com",
    ],
  },
  "gcp secret": {
    "--approve": ["disable-version", ...GCP_SECRET_BASE, "--version", "2", "--approve", "gcp-0123456789abcdef"],
    "--data-file": ["add-version", ...GCP_SECRET_BASE, "--data-file", "/tmp/payload"],
    "--edit-existing": ["disable-version", ...GCP_SECRET_BASE, "--version", "2", "--edit-existing", "rotated"],
    "--home": ["create", ...GCP_SECRET_BASE, "--home", "/tmp"],
    "--json": ["describe", ...GCP_SECRET_BASE, "--json"],
    "--member": [
      "add-iam-policy-binding",
      ...GCP_SECRET_BASE,
      "--role",
      "roles/secretmanager.secretAccessor",
      "--member",
      "serviceAccount:desktop-api@my-project-01.iam.gserviceaccount.com",
    ],
    "--project": ["describe", ...GCP_SECRET_BASE],
    "--role": [
      "add-iam-policy-binding",
      ...GCP_SECRET_BASE,
      "--role",
      "roles/secretmanager.secretAccessor",
      "--member",
      "user:someone@example.com",
    ],
    "--secret": ["describe", ...GCP_SECRET_BASE],
    "--to-file": ["access", ...GCP_SECRET_BASE, "--to-file", "/tmp/new-secret-file"],
    "--version": ["access", ...GCP_SECRET_BASE, "--version", "latest"],
  },
  "gcp service-account": {
    "--account-id": ["create", "--project", "my-project-01", "--account-id", "desktop-api"],
    "--approve": [
      "create",
      "--project",
      "my-project-01",
      "--account-id",
      "desktop-api",
      "--approve",
      "gcp-0123456789abcdef",
    ],
    "--description": [
      "create",
      "--project",
      "my-project-01",
      "--account-id",
      "desktop-api",
      "--description",
      "runs the API",
    ],
    "--display-name": ["create", "--project", "my-project-01", "--account-id", "desktop-api", "--display-name", "API"],
    "--email": [
      "describe",
      "--project",
      "my-project-01",
      "--email",
      "desktop-api@my-project-01.iam.gserviceaccount.com",
    ],
    "--home": ["create", "--project", "my-project-01", "--account-id", "desktop-api", "--home", "/tmp"],
    "--json": [
      "describe",
      "--project",
      "my-project-01",
      "--email",
      "desktop-api@my-project-01.iam.gserviceaccount.com",
      "--json",
    ],
    "--project": ["create", "--project", "my-project-01", "--account-id", "desktop-api"],
  },
  "gcp services": {
    "--approve": ["enable", ...GCP_SERVICES_BASE, "--approve", "gcp-0123456789abcdef"],
    "--home": ["enable", ...GCP_SERVICES_BASE, "--home", "/tmp"],
    "--json": ["describe", ...GCP_SERVICES_BASE, "--json"],
    "--project": ["describe", ...GCP_SERVICES_BASE],
    "--service": ["describe", ...GCP_SERVICES_BASE],
  },
  "secrets status": {
    "--all": ["--all"],
    "--home": ["--home", "/tmp/a-home"],
    "--json": ["--json"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "alias catch-all": ({ fragment }) => parseAliasCatchAllArgs({ defaultHome: ALIAS_PROBE_HOME, rest: fragment }),
  "alias list": ({ fragment }) => parseAliasListArgs({ defaultHome: ALIAS_PROBE_HOME, rest: fragment }),
  "alias provision": ({ fragment }) => parseAliasProvisionArgs({ defaultHome: ALIAS_PROBE_HOME, rest: fragment }),
  "onepassword sync": ({ fragment }) => parseOnepasswordSyncOptions({ defaultHome: "/tmp/home", rest: [...fragment] }),
  "onepassword reset": ({ fragment }) =>
    parseOnepasswordResetOptions({ defaultHome: "/tmp/home", rest: [...fragment] }),
  "gcp artifacts": ({ fragment }) => gcpParse({ family: "artifacts", fragment }),
  "gcp run": ({ fragment }) => gcpParse({ family: "run", fragment }),
  "gcp secret": ({ fragment }) => gcpParse({ family: "secret", fragment }),
  "gcp service-account": ({ fragment }) => gcpParse({ family: "service-account", fragment }),
  "gcp services": ({ fragment }) => gcpParse({ family: "services", fragment }),
  "secrets status": ({ fragment }) => parseSecretsStatusArgs({ rest: [...fragment] }),
};

/** The rows for `gcp`, `alias`, `secrets` and `onepassword`. */
export const cloudAndSecretsSlice: HelpTruthSlice = { guarded, probes, parsers };
