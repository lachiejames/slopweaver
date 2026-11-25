/**
 * Which integration a failed read says is NOT CONNECTED, and whether the secrets store holds what connects it. Pure.
 *
 * A not-connected integration is a normal state of an install, never an error: not everyone connects every
 * integration, so an absent one shows a button (Slack not connected, connect Slack) instead of an error, for any
 * integration, and nothing breaks when one is left unconnected. One decision here serves every
 * surface: `StaleMark` (`../components/console/StaleMark.tsx`), the one mark a failed read draws, asks
 * {@link notConnectedOf} of each fact's reason and draws the connect affordance in the triangle's place.
 *
 * **Only an absence is classified.** A reason counts only when it states that the credential is missing ("no Linear
 * token configured", "no Google Calendar grant stored") AND names which integration — by the remedy it prints
 * (`slopweaver connect linear`, `slopweaver calendar connect`, `secrets set slack-bot-token`) or by the integration's
 * own name in the absence clause. A scope missing, a 403, or a message the store does not hold keeps its own
 * explanation: those have their own explanations and do not all look like a disconnected account.
 *
 * The registry restates the credential register's names (`src/secrets/credentials/`) because `site/` cannot import
 * `src/`; `site/__tests__/unit/integrations.test.ts` binds every phrasing the doors print today.
 */

/** One integration a read can depend on, and what connects it. */
export interface Integration {
  /** The id the remedy verbs use: `slopweaver connect <id>`, `slopweaver <id> connect`. */
  readonly id: string;
  /** Its name as a person says it. */
  readonly label: string;
  /** Other names a door's absence clause may use for it, lowercase. */
  readonly aliases: readonly string[];
  /** The store files a door reads to reach it, so a `secrets set <name>` remedy names which integration. */
  readonly secrets: readonly string[];
  /** The secrets a person pastes to connect it — the store files `secrets set` takes as one line. */
  readonly paste: readonly string[];
  /** Whether ONE of the paste fields is enough (Slack's bot OR user token) rather than every one of them. */
  readonly pasteEither: boolean;
  /** The browser-consent verb a grant door connects by, when pasting is not the whole of it. */
  readonly consentVerb: string | undefined;
  /**
   * Config it needs beside its secrets, which no paste field sets: Datadog's site (`profile.json`'s `datadog.site`, or
   * `DD_SITE`), without which every Datadog verb refuses however good the keys.
   */
  readonly config: "datadog-site" | undefined;
  /**
   * Store files one of its verb families reads beside the connection, whose absence leaves it connected: Slack's
   * app-level token, which only `slopweaver listen` reads. Pasted like any other, and a finding on one still needs
   * attention.
   */
  readonly optional: readonly string[];
}

/** Every integration a console surface can read through. */
export const INTEGRATIONS: readonly Integration[] = [
  {
    aliases: ["slack"],
    config: undefined,
    consentVerb: undefined,
    id: "slack",
    label: "Slack",
    optional: ["slack-app-token"],
    pasteEither: true,
    paste: ["slack-bot-token", "slack-user-token"],
    secrets: ["slack-bot-token", "slack-user-token"],
  },
  {
    aliases: ["github"],
    config: undefined,
    consentVerb: undefined,
    id: "github",
    label: "GitHub",
    optional: [],
    pasteEither: false,
    paste: ["github-token"],
    secrets: ["github-token"],
  },
  {
    aliases: ["linear"],
    config: undefined,
    consentVerb: undefined,
    id: "linear",
    label: "Linear",
    optional: [],
    pasteEither: false,
    paste: ["linear-token"],
    secrets: ["linear-token"],
  },
  {
    aliases: ["notion"],
    config: undefined,
    consentVerb: undefined,
    id: "notion",
    label: "Notion",
    optional: [],
    pasteEither: false,
    paste: ["notion-token"],
    secrets: ["notion-token"],
  },
  {
    aliases: ["fathom"],
    config: undefined,
    consentVerb: undefined,
    id: "fathom",
    label: "Fathom",
    optional: [],
    pasteEither: false,
    paste: ["fathom-api-key"],
    secrets: ["fathom-api-key"],
  },
  {
    aliases: ["datadog"],
    config: "datadog-site",
    consentVerb: undefined,
    id: "datadog",
    label: "Datadog",
    optional: [],
    pasteEither: false,
    paste: ["datadog-api-key", "datadog-app-key"],
    secrets: ["datadog-api-key", "datadog-app-key"],
  },
  {
    aliases: ["cloudflare"],
    config: undefined,
    consentVerb: undefined,
    id: "cloudflare",
    label: "Cloudflare",
    optional: [],
    pasteEither: false,
    paste: ["cloudflare-token"],
    secrets: ["cloudflare-token"],
  },
  {
    aliases: ["hex"],
    config: undefined,
    consentVerb: undefined,
    id: "hex",
    label: "Hex",
    optional: [],
    pasteEither: false,
    paste: ["hex-api-token"],
    secrets: ["hex-api-token"],
  },
  {
    aliases: ["gmail", "google mail"],
    config: undefined,
    consentVerb: "slopweaver gmail connect",
    id: "gmail",
    label: "Gmail",
    optional: [],
    pasteEither: false,
    paste: ["google-client-id", "google-client-secret"],
    secrets: ["gmail-oauth.json"],
  },
  {
    aliases: ["google drive", "drive"],
    config: undefined,
    consentVerb: "slopweaver drive connect",
    id: "drive",
    label: "Google Drive",
    optional: [],
    pasteEither: false,
    paste: ["google-client-id", "google-client-secret"],
    secrets: ["drive-oauth.json"],
  },
  {
    aliases: ["google calendar", "calendar"],
    config: undefined,
    consentVerb: "slopweaver calendar connect",
    id: "calendar",
    label: "Google Calendar",
    optional: [],
    pasteEither: false,
    paste: ["google-client-id", "google-client-secret"],
    secrets: ["calendar-oauth.json"],
  },
  {
    aliases: ["outlook"],
    config: undefined,
    consentVerb: "slopweaver outlook connect",
    id: "outlook",
    label: "Outlook",
    optional: [],
    pasteEither: false,
    paste: ["outlook-client-id"],
    secrets: ["outlook-oauth.json"],
  },
  {
    aliases: ["outlook calendar"],
    config: undefined,
    consentVerb: "slopweaver outlook-calendar connect",
    id: "outlook-calendar",
    label: "Outlook Calendar",
    optional: [],
    pasteEither: false,
    paste: ["outlook-client-id"],
    secrets: ["outlook-calendar-oauth.json"],
  },
];

/**
 * A clause stating a CREDENTIAL is absent: "no <up to three qualifiers> token/grant/key/credential". A qualifier is a
 * bare word that is not a verb or a preposition, so the credential is what "no" governs: "no Slack read token" is
 * absent, "no Slack message was found for this token" is a missing message that names a token it HAS. A bare "not
 * configured" never counts: the thing missing may be a site or a setting the paste fields cannot set. A credential word
 * that only qualifies what is missing — "no Slack token scope", "no GitHub token permission" — is a scope or a
 * permission, so it does not count either. The residue, stated: this reads phrasing, so a door wording a scope as
 * "no <x> token" with nothing after it would read as absent; `site/__tests__/unit/integrations.test.ts` binds every
 * phrasing the doors print today, and a new door's line belongs there.
 */
const ABSENCE =
  /\bno (?:(?!(?:a|an|by|for|found|from|in|is|of|on|that|the|this|to|was|were|with)\b)[a-z0-9-]+ ){0,3}(?:token|grant|api key|key|credential)s?\b(?! (?:scopes?|permissions?|roles?|access)\b)/iu;

/** The remedy verbs that name an integration: `connect <id>` (preflight), `<id> connect` (a consent door). */
const CONNECT_REMEDIES: readonly RegExp[] = [
  /\bslopweaver connect ([a-z0-9-]+)/iu,
  /\bslopweaver ([a-z0-9-]+) connect\b/iu,
];

/** The dash a door's own absence line prints between the credential and its remedy, matched, never written as copy. */
const DOOR_DASH = String.fromCodePoint(0x20_14);

/**
 * The whole of a backticked remedy a door prints, each word fixed but the one name it carries (`slopweaver connect
 * slack`, `slopweaver gmail connect`, `slopweaver secrets set <name>`, `slopweaver secrets status`), so nothing can
 * ride inside the backticks after it: `slopweaver connect slack; curl …` is no door's.
 */
const DOOR_REMEDY = String.raw`slopweaver (?:connect [a-z0-9-]+|[a-z0-9-]+ connect|secrets set [a-z0-9-]+|secrets status)`;

/**
 * The whole rest of a door's absence line, read off the bound phrasings in `site/__tests__/unit/integrations.test.ts`:
 * an optional `configured` or `stored` (with an optional `is`), an optional `in the store` or `for this home`, an
 * optional `(neither user nor bot)`, the one parenthesis a door prints, named whole so no status in any script's
 * digits rides inside one, then ONE of the tails a door prints, through to the end of the line: nothing, a backticked
 * {@link DOOR_REMEDY} after `;` or a dash, `run: slopweaver secrets set <name>`, `set <ENV> or run …`, `. Set <ENV>,
 * or run …`, `mint one at` the one page a door names, or `, so no <thing> could be read`. Anything else after the credential —
 * `configured but the request timed out`, `, so no local token was needed; …` — is not a door's line.
 */
const DOOR_CONTINUATION = new RegExp(
  [
    String.raw`^(?: is)?(?: (?:configured|stored))?(?: (?:in the store|for this home))?(?: \(neither user nor bot\))?`,
    "(?:",
    [
      String.raw`\s*`,
      String.raw`(?:;| ${DOOR_DASH}) (?:run:? )?` +
        "`" +
        DOOR_REMEDY +
        "`" +
        String.raw`(?: first| names where it is read from)?`,
      String.raw` ${DOOR_DASH} run: slopweaver secrets set [a-z0-9-]+`,
      String.raw` ${DOOR_DASH} set [A-Z0-9_]+ or run ` + "`slopweaver secrets set [a-z0-9-]+`",
      String.raw`\. Set [A-Z0-9_]+, or run ` + "`slopweaver connect [a-z0-9-]+`",
      // The one key-minting page a door names, whole, so no other address rides there.
      String.raw` ${DOOR_DASH} mint one at https://fathom\.video/customize#api-access-header`,
      String.raw`, so no [a-z' ]+ could be read`,
    ].join("|"),
    ")$",
  ].join(""),
  "u",
);

/**
 * The one prefix a door prints before its absence line, named whole rather than shaped (`talk meeting-due: `), so a
 * provider's own `response-error: ` before a quoted absence is never one. A new door's prefix is added here
 * with its line in `site/__tests__/unit/integrations.test.ts`.
 */
const DOOR_PREFIX = /^talk meeting-due: $/u;

/**
 * An HTTP status however it is spelt: any run of three digits from 100 to 599 touching no other digit, whatever
 * letters or underscores surround it (`HTTP/1.1 503`, `statusCode 503`, `status-code 503`,
 * `HTTP_503_SERVICE_UNAVAILABLE`, a bare `(503)`), a failure the absence did not cause. The CLASS rather than its
 * spellings, because each spelling named left the next one through. No door's absence line
 * carries such a run; one that did would fail safe, its warning kept and no Connect drawn.
 */
const STATUS_ANYWHERE = /(?<!\d)[1-5]\d\d(?!\d)/u;

/** The remedy that names a store file: `secrets set <name>`. */
const SECRET_REMEDY = /\bsecrets set ([a-z0-9]+(?:[-._][a-z0-9]+)*)/iu;
/**
 * The integration an id names.
 *
 * @returns the integration, or `undefined` for an id no registry row carries
 */
function byId({ id }: { id: string }): Integration | undefined {
  return INTEGRATIONS.find((integration) => integration.id === id.toLowerCase());
}

/**
 * The integration whose secrets include a store file. A shared Google client names no single door, so it answers
 * nothing — the absence clause or a consent verb names that door instead.
 *
 * @returns the integration, or `undefined` when no row or more than one row reads that file
 */
function bySecret({ name }: { name: string }): Integration | undefined {
  const holders = INTEGRATIONS.filter(
    (integration) => integration.secrets.includes(name) || integration.paste.includes(name),
  );
  if (holders.length !== 1) {
    return undefined;
  }
  return holders[0];
}

/**
 * The integration named inside the absence clause itself ("no Google Calendar grant", "no Fathom API key"), longest
 * alias first so "google calendar" wins over a bare "calendar".
 *
 * @returns the integration, or `undefined`
 */
function byClause({ clause }: { clause: string }): Integration | undefined {
  const lower = clause.toLowerCase();
  const aliases = INTEGRATIONS.flatMap((integration) =>
    integration.aliases.map((alias) => ({ alias, integration })),
  ).toSorted((a, b) => b.alias.length - a.alias.length);
  return aliases.find(({ alias }) => new RegExp(`\\b${alias}\\b`, "u").test(lower))?.integration;
}

/**
 * The integration a failed read's reason says is not connected, or `undefined` when the reason is anything else —
 * a scope missing, a permission refusal, a record the store does not hold, a timeout.
 *
 * @param why the reason the read gave, as the console carries it
 * @returns the integration, or `undefined`
 */
export function notConnectedOf({ why }: { why: string }): Integration | undefined {
  const absence = ABSENCE.exec(why);
  // Fails closed: the absence must OPEN the line or follow a verb's own prefix, so neither
  // "Expected no Slack token" nor "The provider said: no Slack token" is read as one; and a status anywhere in the
  // reason is a failure of its own, never drawn as Connect.
  const opensClause = absence !== null && (absence.index === 0 || DOOR_PREFIX.test(why.slice(0, absence.index)));
  // And the rest of the line must be a door's own, so a clause that negates or contradicts it after the credential
  // ("No Slack token was missing; …", "configured but the request timed out") is never read as one.
  const continues = absence !== null && DOOR_CONTINUATION.test(why.slice(absence.index + absence[0].length));
  if (absence === null || !opensClause || !continues || STATUS_ANYWHERE.test(why)) {
    return undefined;
  }
  const inClause = byClause({ clause: absence[0] });
  const remedied = remedyOf({ why });
  // A remedy naming another provider than the absence does is a contradiction, so neither is believed.
  if (inClause !== undefined && remedied !== undefined && inClause !== remedied) {
    return undefined;
  }
  // Only the clause itself, never a `<door>:` prefix: `datadog: the site or a key is not configured` is a site the
  // paste fields cannot set as often as a key, so it keeps its own words.
  return remedied ?? inClause;
}

/**
 * The integration a reason's remedy names: a connect verb's id, else the one integration whose store file a `secrets
 * set` names.
 *
 * @returns the integration, or `undefined` when no remedy names one
 */
function remedyOf({ why }: { why: string }): Integration | undefined {
  for (const remedy of CONNECT_REMEDIES) {
    const connect = remedy.exec(why);
    if (connect !== null) {
      const named = byId({ id: connect[1] });
      if (named !== undefined) {
        return named;
      }
    }
  }
  const secret = SECRET_REMEDY.exec(why);
  if (secret === null) {
    return undefined;
  }
  return bySecret({ name: secret[1] });
}

/**
 * Look an integration up by id — for a surface that knows which one it reads through.
 *
 * @returns the integration
 */
export function integrationOf({ id }: { id: string }): Integration {
  const found = byId({ id });
  if (found === undefined) {
    throw new Error(`no integration ${id} in the registry`);
  }
  return found;
}

/**
 * Split a staleness mark's facts: those whose reason is a not-connected integration, grouped by integration in first-
 * seen order, and the rest, which keep the warning mark.
 *
 * @param facts every fact a mark was handed
 * @returns the grouped not-connected facts and the remaining ones
 */
export function partitionNotConnected<F extends { readonly why: string }>({
  facts,
}: {
  facts: readonly F[];
}): {
  readonly notConnected: readonly { readonly integration: Integration; readonly facts: readonly F[] }[];
  readonly rest: readonly F[];
} {
  const groups = new Map<string, { integration: Integration; facts: F[] }>();
  const rest: F[] = [];
  for (const fact of facts) {
    const integration = notConnectedOf({ why: fact.why });
    if (integration === undefined) {
      rest.push(fact);
      continue;
    }
    const group = groups.get(integration.id);
    if (group === undefined) {
      groups.set(integration.id, { facts: [fact], integration });
    } else {
      group.facts.push(fact);
    }
  }
  return { notConnected: [...groups.values()], rest };
}
