/**
 * `google audit-log`'s usage text — a leaf, so the manifest barrel can quote it without loading the command.
 */

/** The one usage line the manifest and the verb both print. */
export const GOOGLE_AUDIT_LOG_USAGE_LINE =
  "usage: slopweaver google audit-log pull --org <n> --quota-project <id> --since <RFC3339> (--principal <email>... | --all-principals) [--role <name>...] [--home <dir>] | summary [--generation <id>] [--plan <file>] [--json] [--home <dir>]";

/** The whole usage, printed on `--help` and on a parse error. */
export const GOOGLE_AUDIT_LOG_USAGE =
  `${GOOGLE_AUDIT_LOG_USAGE_LINE}\n` +
  "  READ-ONLY. Read Cloud Audit Logs across a GCP organisation through the owner's Application Default Credential and\n" +
  "  keep them as a local generation under $SLOPWEAVER_HOME/atlas/gcp-audit/ (0700/0600, never git).\n" +
  "  pull     discover the organisation's folders and projects, record every logging bucket's retention and\n" +
  "           every sink, then page every audit entry (activity, data_access, policy, system_event) since\n" +
  "           --since made by the named principals. --role caches a role's permissions for a later --plan.\n" +
  "           Quota and billing land on --quota-project. The only calls it can express are list/get reads.\n" +
  "  summary  count the newest (or --generation) pull: per principal, service and method, with first and last\n" +
  "           seen, caller IPs, user-agent families and the permissions Google recorded as granted. --plan\n" +
  "           reads a least-privilege plan (JSON) and lists every exercised permission it would remove.\n" +
  "  What it counts is what Cloud Logging STILL HOLDS: _Required keeps admin activity 400 days, _Default keeps\n" +
  "  data access 30 days by default, and data-access logging is off for most services — absence is not proof.\n" +
  "  Exits 0 complete, 3 partial coverage (the gaps are printed), 2 usage, 1 failure.";
