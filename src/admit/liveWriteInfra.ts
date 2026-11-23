/**
 * Which invocations of an infrastructure, deploy or database client CHANGE a live system — the second half of
 * the bot-turn live-write guard: the bot takes no actions on staging or prod, generally ever.
 *
 * ## Conservative, and not target-aware — say so rather than imply otherwise
 *
 * A command line rarely says which environment it reaches: a kube context, an AWS profile, a `DATABASE_URL`
 * all live outside it. So no rule here asks whether the target is staging or production. A mutation through
 * one of these tools is a write wherever it lands, and a bot turn has no local cluster or cloud account of
 * its own to be writing to. The cost is stated: a `vercel deploy` that would only cut a preview, a `kubectl
 * apply` at a kind cluster and a `psql` write to a throwaway database are refused too.
 *
 * ## Two shapes of rule, and which tools get which
 *
 * The cloud CLIs, `kubectl`, `helm`, `terraform`, `pulumi`, `bq` and every SQL client (`./liveWriteSql.ts`)
 * are read by ALLOWLIST: anything that is not a known read is a write, so a verb nobody listed refuses rather
 * than slipping through. The hosted-app CLIs (`fly`, `heroku`, `vercel`, `wrangler`, `netlify`, `firebase`,
 * `serverless`, `supabase`, `gsutil`) are still lists of WRITES — a write verb missing from one of those is
 * this file's residue, and the place to add the next one.
 *
 * ## The other residue: a read refused, on purpose
 *
 * An allowlist without each tool's whole option grammar mistakes some reads for writes: a subcommand flag
 * whose value it does not know shifts the words, an unusual SQL form opens with no listed read. Review found
 * one per round for four rounds (`SELECT 'update'`, `$$…$$`, MySQL's `\'`, `aws
 * --ca-bundle`, `EXPLAIN DELETE`), each now a test row, and the chase was stopped there: each was constructed,
 * and each FAILED SAFE — a hold that names the tool and operation, after which the turn posts the diagnosis it
 * was going to post anyway. A reach that matters gets a row here, never a looser rule.
 *
 * Pure: a program's name, its argument words and what its stdin reads in; a finding or nothing out.
 */
import {
  anyMatching,
  anyOf,
  commandWords,
  either,
  pairOf,
  readsOnly,
  ruleInput,
  unless,
  type WriteRule,
} from "./liveWriteRules.js";
import { type ClientStdin, sqlClientFinding, sqlWrites } from "./liveWriteSql.js";
import type { LiveWriteFinding } from "./liveWriteTypes.js";

/** A `group:verb` that changes a hosted app — `heroku config:set`, `firebase hosting:channel:deploy`. */
const COLON_WRITE =
  /^[\w-]+(?::[\w-]+)*:(?:set|unset|delete|destroy|create|deploy|rollback|reset|restart|scale|promote|remove|push|update|on|off|kill)$/;

/** The words a cloud CLI's READ commands end in; anything else under a non-local group is a write. */
const CLOUD_READS = new Set(
  ["list", "describe", "get", "read", "tail", "log", "logs", "show", "search", "query", "ls"].concat([
    "get-iam-policy",
    "get-value",
    "print-access-token",
    "print-identity-token",
    "help",
    "version",
  ]),
);

/** The verbs that mutate under a cloud CLI's groups — one ahead of a read word means the read word is a NAME. */
const CLOUD_WRITES = new Set(
  [
    "create",
    "delete",
    "update",
    "set",
    "add",
    "remove",
    "deploy",
    "start",
    "stop",
    "restart",
    "reset",
    "import",
  ].concat(
    ["patch", "apply", "attach", "detach", "resize", "move", "rollback", "enable", "disable", "grant", "revoke"],
    ["purge", "cancel", "run", "invoke", "execute", "ssh", "scp", "upload", "swap", "failover", "promote"],
  ),
);

/**
 * A cloud CLI's command words: every flag that has no `=` is taken to consume the next word, because nearly
 * every `gcloud`/`az` option carries a value. Dropping a word only ever removes a CANDIDATE read word, so a
 * boolean flag misread this way can make a read look like a write, never the reverse.
 */
function cloudWords({ args }: { args: readonly string[] }): readonly string[] {
  return args.filter((word, index) => {
    const previous = index > 0 ? args[index - 1]! : "";
    return !word.startsWith("-") && !(previous.startsWith("-") && !previous.includes("="));
  });
}

/**
 * A cloud CLI: a command reads when a read word stands in it with no mutating verb ahead of it — so
 * `az group create --name list` and `gcloud compute instances create list` are writes, not reads named `list`.
 * One whose first word is one of `local` touches only this machine's own config.
 */
function cloudControlPlane({ local }: { local: readonly string[] }): WriteRule {
  return ({ args }) => {
    const words = cloudWords({ args });
    if (words.length === 0 || local.includes(words[0]!) || args.includes("--help")) return undefined;
    const readAt = words.findIndex((word) => CLOUD_READS.has(word));
    const reads = readAt !== -1 && !words.slice(0, readAt).some((word) => CLOUD_WRITES.has(word));
    return reads ? undefined : words.slice(0, 3).join(" ");
  };
}

/**
 * `aws <service> <operation>`: read prefixes and local services pass, everything else changes the account. The
 * value flags are the CLI's whole global-option set (`aws help`), so no global option shifts the service word.
 */
const awsRule: WriteRule = ({ args }) => {
  const valueFlags = [
    "--region",
    "--profile",
    "--output",
    "--endpoint-url",
    "--query",
    "--color",
    "--ca-bundle",
  ].concat(["--cli-read-timeout", "--cli-connect-timeout", "--cli-binary-format"]);
  const [service, operation] = commandWords({ args, valueFlags });
  if (service === undefined || operation === undefined || ["configure", "sso", "help", "history"].includes(service)) {
    return undefined;
  }
  if (service === "s3") {
    return ["cp", "mv", "rm", "sync", "mb", "rb", "website"].includes(operation) ? `s3 ${operation}` : undefined;
  }
  const reads = /^(?:describe-|get-|list-|head-|lookup-|search-|batch-get-|filter-|validate-|estimate-|preview-)/;
  const readWords = ["scan", "query", "wait", "help", "tail"];
  return reads.test(operation) || readWords.includes(operation) ? undefined : `${service} ${operation}`;
};

/** A cluster's subcommands that only read, or only touch this machine's kubeconfig. */
const KUBECTL: WriteRule = unless({
  prefixes: ["--dry-run"],
  rule: readsOnly({
    reads: {
      "api-resources": true,
      "api-versions": true,
      auth: ["can-i", "whoami"],
      "cluster-info": true,
      completion: true,
      config: true,
      describe: true,
      diff: true,
      events: true,
      explain: true,
      get: true,
      help: true,
      kustomize: true,
      logs: true,
      options: true,
      plugin: true,
      "port-forward": true,
      proxy: true,
      rollout: ["status", "history"],
      top: true,
      version: true,
      wait: true,
    },
    valueFlags: ["-n", "--namespace", "--context", "--kubeconfig", "--cluster", "--user", "-l", "--selector"].concat(
      ["-o", "--output", "-c", "--container", "-f", "--filename", "--field-selector", "--tail", "--since", "-s"],
      ["--server", "--token", "--as", "--request-timeout"],
    ),
  }),
});

const HELM: WriteRule = unless({
  prefixes: ["--dry-run"],
  rule: readsOnly({
    reads: Object.fromEntries(
      ["list", "ls", "status", "get", "history", "hist", "show", "inspect", "search", "template", "lint", "version"]
        .concat(["env", "repo", "plugin", "dependency", "dep", "registry", "pull", "fetch", "verify", "help"])
        .concat(["completion", "package", "create"])
        .map((verb) => [verb, true as const]),
    ),
    valueFlags: ["-n", "--namespace", "--kube-context", "--kubeconfig", "-o", "--output", "-f", "--values"].concat([
      "--version",
      "--repo",
      "--set",
    ]),
  }),
});

const TERRAFORM: WriteRule = readsOnly({
  reads: {
    ...Object.fromEntries(
      ["plan", "show", "output", "validate", "fmt", "init", "providers", "graph", "version", "console", "get"]
        .concat(["login", "logout", "metadata", "help"])
        .map((verb) => [verb, true as const]),
    ),
    state: ["list", "show", "pull"],
    workspace: ["list", "show", "select"],
  },
  valueFlags: [],
});

const PULUMI: WriteRule = readsOnly({
  reads: {
    ...Object.fromEntries(
      ["preview", "logs", "whoami", "about", "version", "plugin", "login", "logout", "help"].map((verb) => [
        verb,
        true as const,
      ]),
    ),
    config: ["get"],
    stack: ["ls", "output", "select", "history", "export", "graph"],
  },
  valueFlags: ["-s", "--stack", "-C", "--cwd"],
});

/** `bq`: a query reads unless its SQL writes; every other subcommand but the listed reads changes the project. */
const BQ: WriteRule = (input) => {
  const words = commandWords({ args: input.args, valueFlags: ["--project_id", "--location", "--format"] });
  const sql = words.slice(1).join(" ");
  if (words[0] === "query") return sqlWrites({ escapes: "backslash", sql }) ? "query (a write)" : undefined;
  const reads = { head: true, help: true, ls: true, show: true, version: true, wait: true } as const;
  return readsOnly({ reads, valueFlags: ["--project_id", "--location", "--format"] })(input);
};

/** Every infrastructure or deploy tool this guard knows, keyed by the name its program runs under. */
const INFRA_RULES: Readonly<Record<string, WriteRule>> = {
  aws: awsRule,
  az: cloudControlPlane({ local: ["login", "logout", "account", "config", "configure", "extension", "upgrade"] }),
  bq: BQ,
  firebase: either(anyOf({ verbs: ["deploy"] }), anyMatching({ pattern: COLON_WRITE })),
  fly: either(
    anyOf({ verbs: ["deploy", "destroy", "restart", "scale", "ssh", "console", "launch", "rollback"] }),
    pairOf({ group: ["secrets"], verbs: ["set", "unset", "import"] }),
    pairOf({ group: ["machine", "machines"], verbs: ["start", "stop", "restart", "destroy", "update", "run", "kill"] }),
    pairOf({ group: ["postgres", "pg"], verbs: ["connect", "restart", "failover", "import"] }),
  ),
  gcloud: cloudControlPlane({ local: ["auth", "config", "components", "info", "init", "topic"] }),
  gsutil: either(
    anyOf({ verbs: ["cp", "mv", "rm", "rsync", "mb", "rb", "setmeta"] }),
    pairOf({ group: ["acl", "iam", "defacl", "lifecycle", "cors", "versioning", "label"], verbs: ["set", "ch"] }),
  ),
  helm: HELM,
  heroku: either(anyOf({ verbs: ["run", "restart", "rollback"] }), anyMatching({ pattern: COLON_WRITE })),
  kubectl: KUBECTL,
  netlify: either(anyOf({ verbs: ["deploy"] }), anyMatching({ pattern: COLON_WRITE })),
  pulumi: PULUMI,
  serverless: anyOf({ verbs: ["deploy", "remove", "rollback"] }),
  supabase: either(
    pairOf({ group: ["functions"], verbs: ["deploy", "delete"] }),
    pairOf({ group: ["secrets"], verbs: ["set", "unset"] }),
  ),
  terraform: TERRAFORM,
  vercel: ({ args, positional }) => {
    if (args.includes("--prod")) return "--prod";
    const quiet = args.some((word) => ["--help", "-h", "--version", "-v"].includes(word));
    if (positional.length === 0 && !quiet) return "deploy (a bare vercel deploys)";
    return either(
      anyOf({ verbs: ["deploy", "promote", "rollback", "redeploy", "remove", "rm"] }),
      pairOf({ group: ["env", "alias"], verbs: ["add", "rm", "remove", "set"] }),
    )({ args, positional });
  },
  wrangler: either(
    anyOf({ verbs: ["deploy", "publish", "rollback"] }),
    pairOf({ group: ["secret", "key", "kv:key", "object", "bulk", "kv:bulk"], verbs: ["put", "delete"] }),
    unless({ prefixes: ["--local"], rule: pairOf({ group: ["d1"], verbs: ["execute"] }) }),
  ),
};

/** The names a table entry also answers to — the same tool under a second binary name. */
const ALIASES: Readonly<Record<string, string>> = {
  flyctl: "fly",
  oc: "kubectl",
  sls: "serverless",
  tofu: "terraform",
};

/**
 * The live write one program invocation would make, if any.
 *
 * @param name the program's own name (`programName`'s answer)
 * @param args the words after the program, redirections removed
 * @param stdin what the segment's stdin reads, when it is a heredoc body or a file
 * @returns the finding, or `undefined` when the invocation writes to nothing live
 */
export function infraFinding({
  name,
  args,
  stdin,
}: {
  name: string;
  args: readonly string[];
  stdin: ClientStdin;
}): LiveWriteFinding | undefined {
  const client = sqlClientFinding({ args, name, stdin });
  if (client !== "not-a-client") return client;
  const alias = Object.hasOwn(ALIASES, name) ? ALIASES[name]! : name;
  const rule = Object.hasOwn(INFRA_RULES, alias) ? INFRA_RULES[alias] : undefined;
  const operation = rule?.(ruleInput({ args }));
  return operation === undefined ? undefined : { kind: "live-write", operation, tool: name };
}
