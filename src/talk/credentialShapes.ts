/**
 * The shapes `./fileRedaction.ts` masks: what a credential looks like, as patterns. Kept apart from the engine
 * that applies them because this list is what every adversarial review pass has grown, and each growth is a
 * row here rather than a change to how masking works.
 *
 * ## Every pattern is linear
 *
 * Every key name is BOUNDED (`{0,80}`), every value is a single character class or a disjoint alternation
 * that nothing follows — so a value that fails to close still matches, to its line's end, and never
 * backtracks — and every pass that could start inside a run of its own characters is anchored by a
 * lookbehind. Unbounded, `secret-config` took 11.3 s on one 261 KB `keykey…` line (r2 review) and
 * `url-password` 40.5 s on one 256 KiB `a.a.…` line (r3 review), against the voice's 20 s tool timeout.
 * As written, the slowest of 95 such 256 KiB lines — JSON-escaped, line-numbered and grep-prefixed ones included,
 * each matched at every escape level and prefix view — takes 0.21–0.24 s across runs (`a-1-a-1-…`); every key name opens on a
 * lookbehind, and without it on `SECRET_KEY` the `tokentoken…` line took 2.15 s once names were bounded at 80.
 * Repro: write that line to a file and time `slopweaver talk file read --path <it> --budget 262144 --json`.
 *
 * ## A value is masked to its END
 *
 * A value pass once stopped at 4096 characters, and a 6000-character base64 keystore sent its last 1904 (r4
 * review). A value runs to its closing quote, or to the whitespace or line end that closes it, however long.
 */

/** One masking pass: what it matches, and the label its replacement names. */
export interface MaskPass {
  readonly label: string;
  readonly re: RegExp;
}

/** Whole-match passes. Where two overlap, the earlier-starting one names the merged mask. */
export const TOKEN_PASSES: readonly MaskPass[] = [
  {
    label: "private-key",
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/gu,
  },
  { label: "slack-token", re: /xox[a-z]-[A-Za-z0-9%-]{10,}/gu },
  { label: "slack-webhook", re: /hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9/_-]{10,}/gu },
  { label: "slack-app-token", re: /xapp-[0-9]+-[A-Za-z0-9-]{10,}/gu },
  { label: "linear-api-key", re: /lin_(?:api|oauth)_[A-Za-z0-9]{20,}/gu },
  { label: "github-token", re: /gh[pousr]_[A-Za-z0-9]{20,}/gu },
  { label: "github-pat", re: /github_pat_[A-Za-z0-9_]{20,}/gu },
  { label: "client-secret", re: /secret_[A-Za-z0-9]{16,}/gu },
  { label: "notion-token", re: /ntn_[A-Za-z0-9]{30,}/gu },
  { label: "gitlab-token", re: /gl(?:pat|rt|dt|ptt|ft|imt|soat|cbt|oas)-[A-Za-z0-9_-]{20,}/gu },
  { label: "huggingface-token", re: /hf_[A-Za-z0-9]{30,}/gu },
  { label: "pulumi-token", re: /pul-[a-f0-9]{40}/giu },
  { label: "supabase-token", re: /sbp_[a-f0-9]{40}|sb_secret_[A-Za-z0-9_-]{20,}/giu },
  { label: "anthropic-key", re: /sk-ant-[A-Za-z0-9_-]{20,}/gu },
  { label: "openai-style-key", re: /sk-(?:proj|svcacct|admin|None)-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}/gu },
  { label: "stripe-key", re: /[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/gu },
  { label: "webhook-secret", re: /whsec_[A-Za-z0-9+/=]{20,}/gu },
  { label: "aws-key-id", re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu },
  { label: "aws-bedrock-key", re: /\bABSK[A-Za-z0-9+/=]{20,}|bedrock-api-key-[A-Za-z0-9+/=_-]{20,}/gu },
  {
    label: "google-key",
    re: /AIza[A-Za-z0-9_-]{35}|ya29\.[A-Za-z0-9_-]{20,}|1\/\/0[A-Za-z0-9_-]{30,}|GOCSPX-[A-Za-z0-9_-]{20,}/gu,
  },
  { label: "jwt", re: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/gu },
  { label: "npm-token", re: /npm_[A-Za-z0-9]{36}/gu },
  { label: "1password-token", re: /ops_[A-Za-z0-9_-]{40,}/gu },
  { label: "age-key", re: /AGE-SECRET-KEY-(?:PQ-)?1[0-9A-Z]{50,}/gu },
  { label: "vault-token", re: /(?<![A-Za-z0-9])hv[sbr]\.[A-Za-z0-9_-]{20,}/gu },
  { label: "sendgrid-key", re: /(?<![A-Za-z0-9])SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/gu },
  { label: "tailscale-key", re: /tskey-[A-Za-z0-9-]{20,}/gu },
  { label: "digitalocean-token", re: /do[por]_v1_[a-f0-9]{64}/gu },
  { label: "sentry-token", re: /sntr(?:y[su]|[ysu])_[A-Za-z0-9_=+/-]{20,}/gu },
  { label: "atlassian-token", re: /ATATT[A-Za-z0-9_=+/-]{20,}/gu },
  { label: "telegram-token", re: /(?<![0-9])[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}/gu },
  { label: "bearer-token", re: /Bearer\s+[A-Za-z0-9._~+/-]{12,}=*/gu },
  { label: "hex-key", re: /(?<![A-Za-z0-9])(?:SK|AC|dapi)?[a-f0-9]{32}(?![A-Za-z0-9])/giu },
];

/** The words that make a key name a secret's, as a pattern fragment. */
const SECRET_WORD =
  "(?:pass(?:wd|word|phrase)?|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credentials?|auth(?!or))";

/**
 * A key name carrying a secret word, bounded either side and opening where a name does: without the
 * lookbehind every position inside a long run of name characters is a fresh 80-by-80 search.
 */
const SECRET_KEY = String.raw`(?<![A-Za-z0-9_.-])[A-Za-z0-9_.-]{0,80}${SECRET_WORD}[A-Za-z0-9_.-]{0,80}`;

/**
 * An UPPER_CASE environment name carrying a secret word or a bare `KEY` (`DD_APP_KEY`, `SIGNING_KEY`). Every
 * name is bounded at 80 either side: at 40, `MY_COMPANY_PRODUCTION_ENVIRONMENT_DATABASE_PASSWORD` was no key.
 */
const ENV_KEY = String.raw`(?<![A-Za-z0-9_])[A-Z0-9_]{0,80}(?:${SECRET_WORD.toUpperCase()}|KEY)[A-Z0-9_]{0,80}`;

/** What joins a key to its value: `:`, `=`, Go's `:=`, PHP's `=>`. */
const JOIN = String.raw`[ \t]*(?::=|=>|[:=])[ \t]*`;

/** A double-quoted value to its closing quote or line end, a backslash-escaped quote inside it included. */
const DOUBLE_QUOTED = String.raw`((?:[^"\\\n]|\\.)+)`;

/**
 * A single-quoted value to its closing quote or line end, a backslash-escaped quote and YAML's doubled `''`
 * inside it included.
 */
const SINGLE_QUOTED = String.raw`((?:[^'\\\n]|\\.|'')+)`;

/** A backtick-quoted value to its closing backtick or line end. */
const BACKTICK_QUOTED = String.raw`([^\x60\n]+)`;

/**
 * What an unquoted `key: value` line holds when it is SOURCE rather than config: a type word
 * (`token: string`), a name closing a member or an argument (`password: Password;`, `token: pw,`), or a call or
 * a generic (`token: getToken()`, `keys: Map<…>`). Only a source file gets this exemption: in a `.yml`,
 * `password: Welcome1;` is a password (r4 review).
 */
const CODE_VALUE = String.raw`(?:string|number|boolean|bigint|unknown|any|never|null|undefined|object|void|readonly)(?![\w$])|[A-Za-z_$][\w$.]{0,80}(?:\[\])?[;,][ \t]*$|[A-Za-z_$][\w$.]{0,80}[(<]`;

/**
 * Commands whose password flag is a short one: `docker login -p`, `redis-cli -a`, `sqlcmd -P`, `zip -P`,
 * `ssh-keygen -P|-N`. Their option parsers take the value joined too (`-wWelcome1`, r11), so the separator is
 * optional; `openssl -k` is not here, because joined it is `-keyform`, `-kdf`, `-key`.
 */
const COMMAND_FLAG = String.raw`\bdocker[ \t]+login\b[^\n]{0,200}?[ \t]-p|\bredis-cli\b[^\n]{0,200}?[ \t]-a|\bsqlcmd\b[^\n]{0,200}?[ \t]-P|\baz[ \t]+login\b[^\n]{0,200}?[ \t]-p|\bmongo(?:sh)?\b[^\n]{0,200}?[ \t]-p|\bldap\w{0,20}\b[^\n]{0,200}?[ \t]-w|\b(?:un)?zip\b[^\n]{0,200}?[ \t]-P|\bssh-keygen\b[^\n]{0,200}?[ \t]-P`;

/** A secret-named XML element's open tag, a namespace prefix (`<wsse:Password>`, r12) and attributes included. */
const XML_OPEN = String.raw`<(?:[A-Za-z0-9_.-]{1,40}:)?${SECRET_KEY}(?:[ \t\n][^<>]{0,256})?>`;

/**
 * Passes whose group 1 is the context that marks a secret and group 2 the secret itself, so only the value is
 * masked and the key still reads.
 *
 * - `secret-env` is an UPPER_CASE environment assignment anywhere on a line — an `.env` file, `export`, a
 *   zsh history line, `DB_PASS=x ./run` — where the whole unspaced value is the secret, parentheses and a
 *   stray `'` included; a quoted one to its closing quote.
 * - `basic-auth` and `auth-header` are an `Authorization:` header's credentials under any scheme (`ApiKey`,
 *   Okta's `SSWS`, r9) or none (a bare key, r16; followed by another word, only when it holds a digit, since a
 *   letters-only first word reads as a scheme, r17), never the words in prose.
 * - `secret-quoted` is a quoted value after a secret-named key, JSON or YAML or source, Go's `:=` and PHP's
 *   `=>` included: the whole quoted text, spaces and escaped quotes included. A quoted UPPER_CASE key ending in
 *   a bare `KEY` counts too — an MCP config's `"DD_APP_KEY": "…"`, `"SIGNING_KEY": "…"` (r5 review) — and unquoted, docker-compose's `SIGNING_KEY: "…"`,
 *   TOML's and Python's `FERNET_KEY = "…"` (r6).
 * - `secret-assignment` is mid-line and source-shaped, so it masks only a value with a digit in it and no call
 *   or member syntax: `const token = await fetchToken()` and `process.env.SLACK_TOKEN` keep their meaning.
 * - `secret-config` is an unquoted `key: value` wherever the key opens (YAML, a list item, a flow map, a grep
 *   hit), where the whole unspaced value is the secret, `#`, `;`, `,`, `}` and `()` included — in a source
 *   file, unless it reads as source ({@link CODE_VALUE}) or names a variable.
 * - `secret-param` is a `name=value` with no spaces, mid-line, named by the same secret words as every other
 *   key (`db_pass=`, `credentials=`, `client_auth=`, r9): a shell history's `db_password=x`,
 *   libpq's `password=x` inside `psql "…"`, a URL query's `?token=x`, Azure's `AccountKey=x;`, a SAS `sig=`.
 * - `secret-flag` is a command line's `--token <value>`, `mysql -p<password>`, `sshpass -p`, the commands in
 *   {@link COMMAND_FLAG}, `openssl -passin pass:`, `keytool -storepass`, `sqlplus user/password@db` and
 *   `curl -u user:password`, `-uuser:password` too.
 * - `secret-prose` is "the password is X".
 * - `secret-xml` is `<password>x</password>`, attributes included (FileZilla's `<Pass encoding="base64">`, r10),
 *   and .NET's `<add key="ApiPassword" value="x">`.
 * - `url-password` is the password half of `scheme://user:password@host`, with or without a user, a user holding `@` included (r12), to the
 *   LAST `@` so a password holding one is masked whole.
 *
 * @param source whether the file is source code, which keeps a `key: value` line that reads as source
 * @returns the passes, in order
 */
export function valuePasses({ source }: { source: boolean }): readonly MaskPass[] {
  return source ? SOURCE_VALUE_PASSES : CONFIG_VALUE_PASSES;
}

/**
 * A flag's value three ways, since a quoted one runs to its closing quote, spaces included (r10): `-p"…"`,
 * `--passphrase '…'`, or bare to the next space.
 *
 * @param prefix the command and flag, separator included, ending where the value opens
 * @param flags the RegExp flags, `i` where the command's case does not matter
 * @param bare an unquoted value's pattern, when it needs a minimum length
 * @returns the double-quoted, single-quoted and bare passes
 */
function flagPasses({
  bare = String.raw`[^\s"'\x60]+`,
  flags,
  prefix,
}: {
  bare?: string;
  flags: string;
  prefix: string;
}): readonly MaskPass[] {
  return [
    { label: "secret-flag", re: new RegExp(String.raw`(${prefix}")${DOUBLE_QUOTED}`, flags) },
    { label: "secret-flag", re: new RegExp(String.raw`(${prefix}\$?')${SINGLE_QUOTED}`, flags) },
    { label: "secret-flag", re: new RegExp(String.raw`(${prefix})(?!\$')(${bare})`, flags) },
  ];
}

/** What may open a quoted string before its quote: Python's `b`/`r`/`u`/`f` (r12), bash's `$'…'`. */
const STRING_PREFIX = String.raw`(?:[bBrRuUfF]{1,2}|\$)?`;

/**
 * A secret-named key's quoted value, whole: double, single, backtick and triple quotes (TOML, Python), each
 * behind an optional string prefix, so `password=b"…"` and `"""…"""` mask the value rather than a `b` (r12).
 *
 * @param key the key-name pattern the value follows
 * @param flags the RegExp flags, `i` where the key's case does not matter
 * @returns the quoted-value passes for that key
 */
function quotedPasses({ flags, key }: { flags: string; key: string }): readonly MaskPass[] {
  const head = String.raw`${key}["']?${JOIN}${STRING_PREFIX}`;
  return [
    { label: "secret-quoted", re: new RegExp(String.raw`(${head}""")((?:[^"\n]|"(?!""))+)`, flags) },
    { label: "secret-quoted", re: new RegExp(String.raw`(${head}''')((?:[^'\n]|'(?!''))+)`, flags) },
    { label: "secret-quoted", re: new RegExp(String.raw`(${head}")${DOUBLE_QUOTED}`, flags) },
    { label: "secret-quoted", re: new RegExp(String.raw`(${head}')${SINGLE_QUOTED}`, flags) },
    { label: "secret-quoted", re: new RegExp(String.raw`(${head}\x60)${BACKTICK_QUOTED}`, flags) },
  ];
}

/** The value passes every file gets, `secret-config` aside. */
const SHARED_VALUE_PASSES: readonly MaskPass[] = [
  { label: "secret-env", re: new RegExp(String.raw`(${ENV_KEY}=)(?!\$?["'])([^\s"\x60]+)`, "gu") },
  { label: "secret-env", re: new RegExp(String.raw`(${ENV_KEY}=\$?")${DOUBLE_QUOTED}`, "gu") },
  { label: "secret-env", re: new RegExp(String.raw`(${ENV_KEY}=\$?')([^'\n]+)`, "gu") },
  { label: "basic-auth", re: /(Authorization["']?[ \t]*[:=][ \t]*["']?Basic[ \t]+)([A-Za-z0-9+/]{8,}=*)/giu },
  { label: "auth-header", re: /(Authorization["']?[ \t]*[:=][ \t]*["']?(?:Token|Bot)[ \t]+)([^\s"',]+)/giu },
  {
    label: "auth-header",
    re: /(Authorization["']?[ \t]*[:=][ \t]*["']?(?!Basic\b)[A-Za-z][A-Za-z0-9_-]{1,30}[ \t]+)([^\s"',]{8,})/giu,
  },
  {
    label: "auth-header",
    re: /(Authorization["']?[ \t]*[:=][ \t]*["']?)(?![A-Za-z][A-Za-z0-9_-]{0,30}[ \t]+\S)([^\s"',]{8,})/giu,
  },
  {
    label: "auth-header",
    re: /(Authorization["']?[ \t]*[:=][ \t]*["']?)(?=[A-Za-z_-]{0,30}[0-9])([A-Za-z][A-Za-z0-9_-]{7,30})(?=[ \t])/giu,
  },
  ...quotedPasses({ flags: "giu", key: SECRET_KEY }),
  ...quotedPasses({ flags: "gu", key: ENV_KEY }),
  {
    label: "auth-header",
    re: /("(?:name|key)"[ \t]*:[ \t]*"(?:Proxy-)?Authorization"[ \t]*,[ \t]*"value"[ \t]*:[ \t]*"(?:[A-Za-z][\w-]{0,30}[ \t]+)?)([^"\s]{8,})/giu,
  },
  {
    label: "secret-assignment",
    re: /((?:api[_-]?key|secret|token|passw(?:or)?d|private[_-]?key|access[_-]?key|auth)[A-Za-z0-9_.-]{0,40}["']?[ \t]*[:=][ \t]*["']?)((?=[A-Za-z0-9_+/=~.!@$%^&*-]{0,512}\d)[A-Za-z0-9_+/=~.!@$%^&*-]{16,})/giu,
  },
  {
    label: "secret-param",
    re: new RegExp(
      String.raw`((?<![A-Za-z0-9_])[A-Za-z0-9_.-]{0,80}(?:${SECRET_WORD}|account[_-]?key|shared[_-]?access[_-]?key)[A-Za-z0-9_.-]{0,80}=)(?![=>\s"'])([^\s"'\x60&;,)]+)`,
      "giu",
    ),
  },
  { label: "secret-param", re: /([?&;]sig=)([^\s&"'#]+)/gu },
  ...flagPasses({
    bare: String.raw`[^\s"'\x60]{4,}`,
    flags: "giu",
    prefix: String.raw`--?(?:token|pass(?:wd|word|phrase)?|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)(?:=|[ \t]+)`,
  }),
  ...flagPasses({ flags: "giu", prefix: String.raw`\b(?:mysql|mariadb)\w{0,20}\b[^\n]{0,200}?[ \t]-p` }),
  ...flagPasses({ flags: "giu", prefix: String.raw`\bsshpass\b[^\n]{0,200}?[ \t]-p[ \t]*` }),
  ...flagPasses({ flags: "gu", prefix: String.raw`(?:${COMMAND_FLAG})(?:=|[ \t]+)?` }),
  // A pass of its own, since `ssh-keygen -p -P old -N new` carries two and a match consumes the command.
  ...flagPasses({ flags: "gu", prefix: String.raw`\bssh-keygen\b[^\n]{0,200}?[ \t]-N(?:=|[ \t]+)?` }),
  ...flagPasses({ flags: "gu", prefix: String.raw`\bopenssl\b[^\n]{0,200}?[ \t]-k(?:=|[ \t]+)` }),
  { label: "secret-flag", re: /(-pass(?:in|out)[ \t]+pass:)([^\s"'`]+)/gu },
  { label: "secret-flag", re: new RegExp(String.raw`(-pass(?:in|out)[ \t]+"pass:)${DOUBLE_QUOTED}`, "gu") },
  { label: "secret-flag", re: new RegExp(String.raw`(-pass(?:in|out)[ \t]+'pass:)${SINGLE_QUOTED}`, "gu") },
  ...flagPasses({ flags: "giu", prefix: String.raw`-(?:src|dest|new)?(?:store|key)pass[ \t]+` }),
  { label: "secret-flag", re: /(\bsqlplus\b[ \t]+(?:-[A-Za-z]+[ \t]+){0,4}["']?[^\s/@"']{1,64}\/)([^\s@"']+)/giu },
  { label: "secret-flag", re: /(\bsqlplus\b[ \t]+(?:-[A-Za-z]+[ \t]+){0,4}[^\s/@"']{1,64}\/")([^"\n]+)/giu },
  // An empty user is Azure DevOps' personal-access-token idiom, `curl -u :<token>` (r12).
  { label: "secret-flag", re: /([ \t](?:-u|--user)(?:[ \t]{1,8}|=|(?=[^\s-]))["']?[^\s:"']{0,64}:)([^\s"']+)/gu },
  {
    label: "secret-flag",
    re: new RegExp(String.raw`([ \t](?:-u|--user)(?:[ \t]{1,8}|=)?"[^\s:"]{0,64}:)${DOUBLE_QUOTED}`, "gu"),
  },
  {
    label: "secret-flag",
    re: new RegExp(String.raw`([ \t](?:-u|--user)(?:[ \t]{1,8}|=)?'[^\s:']{0,64}:)${SINGLE_QUOTED}`, "gu"),
  },
  { label: "secret-prose", re: /(\b(?:passw(?:or)?d|passphrase)[ \t]+(?:is|was)[ \t]+["']?)([^\s"']{4,})/giu },
  { label: "secret-xml", re: new RegExp(String.raw`(${XML_OPEN}[ \t\n]{0,256})([^<\s][^<]*)`, "giu") },
  {
    label: "secret-xml",
    re: new RegExp(String.raw`(${XML_OPEN}[ \t\n]{0,256}<!\[CDATA\[)((?:[^\]]|\](?!\]>))+)`, "giu"),
  },
  {
    label: "secret-xml",
    re: new RegExp(String.raw`(${XML_OPEN}[ \t\n]{0,256}<Value(?:[ \t\n][^<>]{0,256})?>)([^<]+)`, "giu"),
  },
  {
    label: "secret-xml",
    re: new RegExp(String.raw`(\bkey[ \t]*=[ \t]*"${SECRET_KEY}"[ \t]+value[ \t]*=[ \t]*")([^"\n]+)`, "giu"),
  },
  {
    label: "url-password",
    re: /((?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,30}:\/\/[^\s/:]{0,256}:)([^\s/]{1,256})(?=@)/giu,
  },
];

/**
 * Where a quoted file's first line opens inside a transcript row: straight after the row's `"content":"`,
 * with no line break before it (r6, r8), behind a numbered Read copy's `1\t` or a grep hit's `path:3:`, a
 * reply's `>` or a diff's `+` too (r9) — the prefixes `stripLinePrefixes` takes off every other line.
 */
const ROW_START = String.raw`(?<=":[ \t]?"(?:[ \t]{0,16}[0-9]{1,9}(?:\t|→)|(?:[^\s:"]{1,256}[:-])?[0-9]{1,9}[:-])?(?:>[ \t]?){0,8}(?:[+-]{1,2}(?![+-]))?)`;

/** Where a file's line opens: a line's start, or a quoted file's first line inside a transcript row. */
const LINE_START = String.raw`(?:^|${ROW_START})`;

/** A config key: a secret word or a bare `key` inside a bounded name, optionally quoted. */
const CONFIG_KEY = String.raw`["']?[A-Za-z0-9_.-]{0,80}?(?:key|${SECRET_WORD})[A-Za-z0-9_.-]{0,80}["']?[ \t]*`;

/**
 * `secret-config`'s line key: a secret-named `key:` or spaced `key = ` OPENING a line (YAML, a list item,
 * INI, `my.cnf`), whose value is the rest of the line, spaces included — `passphrase: correct horse battery
 * staple` is one value, and masking its first word sent the other three (r7 review). An unspaced `key=value`
 * is a shell's, where a space ends the value, so it is {@link ANY_HEAD}'s. A `|` or `>` alone is a block
 * scalar's indicator, whose body {@link BLOCK_HEAD} masks.
 */
const LINE_KEY = String.raw`([ \t]*(?:-[ \t]+)?(?:export[ \t]+)?${CONFIG_KEY}(?::(?![=:])[ \t]*|=(?![=>])[ \t]+))`;

/** A line value opening a line: the rest of it. */
const LINE_VALUE = String.raw`([^\s][^\n]{3,})`;

/**
 * A line value opening a row's quoted file: the rest of its line as the row ESCAPES it, so up to the escaped
 * line break or the string's closing quote — to the physical line's end it would take the whole row with it.
 * A value holding an escaped quote runs on through it, and the unescaped copy of the row masks the same value
 * again to its real end.
 */
const ROW_VALUE = String.raw`((?:[^\s"\\]|\\[^nr])(?:[^\n"\\]|\\[^nr]){3,})`;

/**
 * `secret-config`'s mid-line head: a secret-named `key:` WHEREVER it opens, or a `key=` opening a line, whose
 * value is one unspaced run. Anchored to a line's start alone, every prefix that moved a key off one leaked
 * it — a numbered Read copy, a patch's `+`, a flow map (r5), `grep -n`'s `path:3:`, a combined diff's `++`, a
 * reply's `>`, a file's first line straight after a transcript row's `"content":"` (r6). The lookbehind is
 * what keeps it linear; `:=` and `::` are operators. A mid-line `=` has its own narrower passes (`secret-env`,
 * `secret-param`, `secret-assignment`): matched here, `const token = await x` would lose its code.
 */
const ANY_HEAD = String.raw`((?<![A-Za-z0-9_.-])${CONFIG_KEY}:(?![=:])[ \t]*|^[ \t]*(?:export[ \t]+)?${CONFIG_KEY}=(?![=>])[ \t]*)`;

/** What a line value may not open with: a quote (its own pass), a closing tag, a block scalar's indicator. */
const NOT_LINE_VALUE = String.raw`["'\x60]|<\/|[|>][-+0-9]{0,2}[ \t]*$`;

/** In source, a value that is a bare name closing its entry or line (`{ password: pw }`) is a reference. */
const REFERENCE = String.raw`[A-Za-z_$][\w$.]{0,80}[ \t]*(?:[,})]|$)`;

/**
 * `secret-config`'s three passes — a line's key, a row's first line's key, a key anywhere — with what a value
 * may not open with.
 *
 * @param notValue the lookahead alternatives a value may not start with
 * @returns the passes, in order
 */
function configPasses({ notValue }: { notValue: string }): readonly MaskPass[] {
  return [
    { label: "secret-config", re: new RegExp(String.raw`^${LINE_KEY}(?!${notValue})${LINE_VALUE}`, "gimu") },
    { label: "secret-config", re: new RegExp(String.raw`${ROW_START}${LINE_KEY}(?!${notValue})${ROW_VALUE}`, "giu") },
    { label: "secret-config", re: new RegExp(String.raw`${ANY_HEAD}(?!${notValue})([^\s]{4,})`, "gimu") },
  ];
}

/** The passes for a file that is not source: every config value masked. */
const CONFIG_VALUE_PASSES: readonly MaskPass[] = [
  ...SHARED_VALUE_PASSES,
  ...configPasses({ notValue: NOT_LINE_VALUE }),
];

/** The passes for a source file: a config value that reads as source is kept. */
const SOURCE_VALUE_PASSES: readonly MaskPass[] = [
  ...SHARED_VALUE_PASSES,
  ...configPasses({ notValue: `${NOT_LINE_VALUE}|${CODE_VALUE}|${REFERENCE}` }),
];

/**
 * A YAML block scalar under a secret-named key (`password: |`), or a plain value moved to the next line
 * (`password:` then an indented `Welcome1`, r8 review), whose value is the indented lines below it rather than
 * anything on the key's own line; `./fileRedaction.ts` walks its body.
 */
export const BLOCK_HEAD = new RegExp(
  String.raw`${LINE_START}([ \t]*)(?:-[ \t]+)?["']?${SECRET_KEY}["']?[ \t]*:[ \t]*(?:[&!][^\s]{1,80}[ \t]*){0,2}(?:[|>][-+0-9]{0,2})?[ \t]*(?:#[^\n]*)?$`,
  "gimu",
);
