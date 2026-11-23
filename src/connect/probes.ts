/**
 * PRODUCTION probe bags for `connect --check` — the only place a real connector SDK client is constructed
 * for a preflight. Each probe is the CHEAPEST 1-item call for its source, every SDK/GraphQL call wrapped in
 * {@link safeProviderCall} (so a throw becomes a typed error the classifier reads as "unreachable"/"absent",
 * never a crash) and `.map`ped to the small value-only shape the pure classifier consumes. This is the
 * effectful wiring layer (like `productionRefreshDeps`) — the logic it feeds is unit-tested via injected fakes.
 *
 * ## Why every probe here is `blockWait: false` + `retryMode: "never"` (PR5.2.1b)
 *
 * A probe's entire job is to answer FAST about whether a token works, before any seam trusts it. Two
 * exemptions follow, and both are deliberate:
 *
 *  - **It does not wait on the shared 429 block.** A `connect --check` that stalled thirty seconds behind a
 *    rate limit an unrelated crawl earned would read as "my token is broken" — the opposite of the
 *    diagnostic's purpose. The exemption is asymmetric: a probe still RECORDS any 429 it earns, so it
 *    protects the crawls it refuses to queue behind.
 *  - **It does not retry.** A preflight reports what it saw. Retrying would multiply the wait on exactly the
 *    unreachable-endpoint case the probe exists to detect quickly, and the classifier already models
 *    "unreachable" as a legitimate answer rather than a failure.
 */

import type { gmail_v1 } from "@googleapis/gmail";
import { LinearClient } from "@linear/sdk";
import { Client as NotionClient } from "@notionhq/client";
import { Octokit } from "@octokit/rest";
import { WebClient } from "@slack/web-api";
import { absentAs, absentAsEmpty, absentAsNumber } from "#lib/absent.js";
import { githubScopeId } from "../corpus/github/githubClient.js";
import { isRecord } from "../lib/parsers.js";
import { safeProviderCall, scopeIdForToken } from "../lib/providerCall.js";
import type { GithubConnectProbes } from "./github.js";
import type { GmailConnectProbes } from "./gmail.js";
import type { LinearConnectProbes } from "./linear.js";
import type { NotionConnectProbes } from "./notion.js";
import { classifyWriteToken, type SlackConnectProbes, type SlackWriteAuth, type SlackWriteLane } from "./slack.js";

/**
 * How many rows an email-scope/read probe samples. One row is too few to verify a scope (the first member
 * may be a bot with no email even when the scope is granted); a small page makes the human-member signal
 * reliable while staying a cheap, non-blocking single request.
 */
const PROBE_SAMPLE = 25;

/** Count `.nodes` under a top-level GraphQL field (Linear lanes), defensively 0 for any non-array shape. */
function nodeCount({ data, key }: { data: unknown; key: string }): number {
  if (!isRecord(data)) {
    return 0;
  }
  const field = data[key];
  if (isRecord(field) && Array.isArray(field["nodes"])) {
    return field["nodes"].length;
  }
  return 0;
}

/** Whether a Notion user row is a `person` carrying an email (the read-user-email capability signal). */
function notionRowHasEmail({ row }: { row: unknown }): boolean {
  return (
    isRecord(row) && row["type"] === "person" && isRecord(row["person"]) && typeof row["person"]["email"] === "string"
  );
}

/** The granted scope list the SDK lifted off `x-oauth-scopes`, defensively empty for any other shape. Pure. */
function slackGrantedScopes({ metadata }: { metadata: { scopes?: string[] } | undefined }): readonly string[] {
  return Array.isArray(metadata?.scopes) ? metadata.scopes.filter((scope) => typeof scope === "string") : [];
}

/** Whether a Slack member is a HUMAN (not a bot, not deleted) — the population whose emails prove the scope. */
function slackHumanMember({ member }: { member: { is_bot?: boolean; deleted?: boolean } }): boolean {
  return member.is_bot !== true && member.deleted !== true;
}

/**
 * The Slack production probe bag over a live `WebClient` (auth + a sampled member/channel read).
 *
 * @param token the token being preflighted — used directly, never resolved from the environment here, so
 *   the probes test exactly the credential the caller is asking about
 * @returns the probe bag
 */
export function makeSlackConnectProbes({ token }: { token: string }): SlackConnectProbes {
  // devlint: sdk-factory -- a connect probe tests a token before any seam trusts it
  const client = new WebClient(token);
  const scopeId = scopeIdForToken({ token });
  return {
    auth: async () =>
      safeProviderCall({
        blockWait: false,
        execute: () => client.auth.test(),
        operation: "slack.auth.test",
        provider: "slack",
        retryMode: "never",
        scopeId,
      }).map((r) => ({
        reachable: typeof r.url === "string" && r.url.length > 0,
        // The SDK lifts Slack's `x-oauth-scopes` response header onto `response_metadata.scopes`, so the
        // granted scope list comes back from the reachability call itself — no extra request, and crucially
        // no need to attempt a write to discover the token cannot write.
        scopes: slackGrantedScopes({ metadata: r.response_metadata }),
      })),
    channels: async () =>
      safeProviderCall({
        blockWait: false,
        execute: () => client.conversations.list({ limit: 1, types: "public_channel,private_channel" }),
        operation: "slack.conversations.list",
        provider: "slack",
        retryMode: "never",
        scopeId,
      }).map((r) => ({ sampled: absentAsEmpty({ value: r.channels }).length })),
    users: async () =>
      safeProviderCall({
        blockWait: false,
        execute: () => client.users.list({ limit: PROBE_SAMPLE }),
        operation: "slack.users.list",
        provider: "slack",
        retryMode: "never",
        scopeId,
      }).map((r) => {
        const members = absentAsEmpty({ value: r.members });
        const humans = members.filter((m) => slackHumanMember({ member: m }));
        return {
          anyHumanEmail: humans.some((m) => typeof m.profile?.email === "string" && m.profile.email.length > 0),
          humans: humans.length,
          sampled: members.length,
        };
      }),
  };
}

/**
 * One write lane's auth seam: the exact token `slopweaver slack post --as <lane>` will send with, probed on
 * its OWN `auth.test` rather than inferred from the read token's scopes.
 *
 * A wrong-kind or absent token is classified purely, with no client constructed and no call made — the
 * cheapest possible refusal for the commonest misconfiguration.
 *
 * @param token the resolved Slack token for this lane, if any
 * @param lane which identity the lane posts under (`bot` = `xoxb`, `user` = `xoxp`)
 * @returns the write auth seam the classifier consumes
 */
export function makeSlackWriteAuth({
  token,
  lane,
}: {
  token: string | undefined;
  lane: SlackWriteLane;
}): SlackWriteAuth {
  const kind = classifyWriteToken({ lane, token });
  if (kind !== "ok" || token === undefined) {
    return { kind: kind === "ok" ? "absent" : kind };
  }
  // devlint: sdk-factory -- a connect probe tests a token before any seam trusts it
  const client = new WebClient(token);
  return {
    auth: async () =>
      safeProviderCall({
        blockWait: false,
        execute: () => client.auth.test(),
        // Two STATIC literals rather than a `${lane}` template: an interpolated label cannot be checked
        // against OPERATION_ENDPOINT_CLASS by any static gate, and an unmapped Slack label falls back to
        // `tier1` — a 75-second interval the moment that class is ever paced.
        operation: lane === "bot" ? "slack.auth.test.write.bot" : "slack.auth.test.write.user",
        provider: "slack",
        retryMode: "never",
        scopeId: scopeIdForToken({ token }),
      }).map((r) => ({
        reachable: typeof r.url === "string" && r.url.length > 0,
        scopes: slackGrantedScopes({ metadata: r.response_metadata }),
      })),
    kind: "probe",
  };
}

/**
 * The Notion production probe bag (`users.list` = auth + email; a 1-item `search` = read probe).
 *
 * @param token the token being preflighted, used directly
 * @returns the probe bag; the read probe asks for ONE item, so a valid token is proven without a crawl
 */
export function makeNotionConnectProbes({ token }: { token: string }): NotionConnectProbes {
  const client = new NotionClient({ auth: token });
  const scopeId = scopeIdForToken({ token });
  return {
    pages: async () =>
      safeProviderCall({
        blockWait: false,
        execute: () => client.search({ page_size: 1 }),
        operation: "notion.search",
        provider: "notion",
        retryMode: "never",
        scopeId,
      }).map((r) => ({ sampled: r.results.length })),
    users: async () =>
      safeProviderCall({
        blockWait: false,
        execute: () => client.users.list({ page_size: PROBE_SAMPLE }),
        operation: "notion.users.list",
        provider: "notion",
        retryMode: "never",
        scopeId,
      }).map((r) => ({
        anyEmail: r.results.some((row) => notionRowHasEmail({ row })),
        anyPerson: r.results.some((row) => isRecord(row) && row["type"] === "person"),
        sampled: r.results.length,
      })),
  };
}

const LINEAR_VIEWER = "query { viewer { id } }";
const LINEAR_ACTIVITY = "query { users(first:1){nodes{id}} issues(first:1){nodes{id}} projects(first:1){nodes{id}} }";
const LINEAR_CURATED = "query { initiatives(first:1){nodes{id}} documents(first:1){nodes{id}} }";

/** The `data` field of a Linear GraphQL `rawRequest` response (unknown until narrowed by the classifier). */
function graphData({ response }: { response: unknown }): unknown {
  return isRecord(response) ? response["data"] : undefined;
}

/**
 * The Linear production probe bag over `rawRequest` (`viewer` auth + a core-lane + a curated-lane sample).
 *
 * @param token the token being preflighted, used directly
 * @returns the probe bag, sampling both lanes because a token can read one and not the other
 */
export function makeLinearConnectProbes({ token }: { token: string }): LinearConnectProbes {
  // devlint: sdk-factory -- a connect probe tests a Linear token before any seam trusts it
  const client = new LinearClient({ apiKey: token });
  const scopeId = scopeIdForToken({ token });
  // The one raw GraphQL boundary — wrapped in `safeProviderCall` (boundary-residue), mapped to its `data`.
  const raw = ({ query }: { query: string }) =>
    safeProviderCall({
      blockWait: false,
      execute: () => client.client.rawRequest(query),
      operation: "linear.rawRequest",
      provider: "linear",
      retryMode: "never",
      scopeId,
    }).map((response) => graphData({ response }));
  return {
    activity: async () =>
      raw({ query: LINEAR_ACTIVITY }).map((d) => ({
        issues: nodeCount({ data: d, key: "issues" }),
        projects: nodeCount({ data: d, key: "projects" }),
        users: nodeCount({ data: d, key: "users" }),
      })),
    curated: async () =>
      raw({ query: LINEAR_CURATED }).map((d) => ({
        documents: nodeCount({ data: d, key: "documents" }),
        initiatives: nodeCount({ data: d, key: "initiatives" }),
      })),
    viewer: async () =>
      raw({ query: LINEAR_VIEWER }).map((d) => ({
        reachable: isRecord(d) && isRecord(d["viewer"]) && typeof d["viewer"]["id"] === "string",
      })),
  };
}

// Probe the SAME field the ingest SSO-email lane reads (externalIdentities), not just that a provider exists
// — a token can see the provider but be unable to read external identities, so only a readable node counts.
const GITHUB_SAML =
  "query($org:String!){ organization(login:$org){ samlIdentityProvider { externalIdentities(first:1){ nodes { samlIdentity { nameId } } } } } }";

/** Whether the org's SAML `externalIdentities` are READABLE (the actual login→SSO-email join the ingest uses). */
function samlPresent({ data }: { data: unknown }): boolean {
  if (!isRecord(data) || !isRecord(data["organization"])) {
    return false;
  }
  const provider = data["organization"]["samlIdentityProvider"];
  return (
    isRecord(provider) &&
    isRecord(provider["externalIdentities"]) &&
    Array.isArray(provider["externalIdentities"]["nodes"])
  );
}

/**
 * The GitHub production probe bag (1-item repo list = auth + read; team read = read:org; SAML GraphQL).
 *
 * @param token the token being preflighted, or undefined to fall back to the `gh` CLI login
 * @param org the org the org-scoped probes run against
 * @returns the probe bag; each probe maps to one scope, so a failure names the missing scope rather than
 *   reporting a generic auth error
 */
export function makeGithubConnectProbes({
  token,
  org,
}: {
  token: string | undefined;
  org: string;
}): GithubConnectProbes {
  // devlint: sdk-factory -- a connect probe tests a GitHub token before any seam trusts it
  const client = new Octokit(token !== undefined ? { auth: token } : {});
  const scopeId = githubScopeId({ token });
  return {
    org: async () =>
      safeProviderCall({
        blockWait: false,
        execute: () => client.rest.teams.list({ org, per_page: 1 }),
        operation: "github.teams.list",
        provider: "github",
        retryMode: "never",
        scopeId,
      }).map(() => ({ teamsReadable: true })),
    repos: async () =>
      safeProviderCall({
        blockWait: false,
        execute: () => client.rest.repos.listForOrg({ org, per_page: 1, type: "all" }),
        operation: "github.repos.listForOrg",
        provider: "github",
        retryMode: "never",
        scopeId,
      }).map((r) => ({ sampled: r.data.length })),
    saml: async () =>
      safeProviderCall({
        blockWait: false,
        execute: () => client.graphql(GITHUB_SAML, { org }),
        operation: "github.graphql.saml",
        provider: "github",
        retryMode: "never",
        scopeId,
      }).map((d) => ({ present: samlPresent({ data: d }) })),
  };
}

/**
 * The Gmail production probe bag. One call: `users.getProfile` is the cheapest thing the API has, and it
 * answers both halves of the preflight at once — that the grant still reaches the mailbox, and which
 * mailbox that is. `blockWait: false` for the same reason the other four preflights use it: a check whose
 * whole value is answering fast about a credential must not queue behind an unrelated rate block.
 *
 * @param client the `@googleapis/gmail` surface from a resolved grant
 * @param account the mailbox the grant bound to, hashed into the shared rate scope
 * @returns the injectable probe bag
 */
export function makeGmailConnectProbes({
  client,
  account,
}: {
  client: gmail_v1.Gmail;
  account: string;
}): GmailConnectProbes {
  const scopeId = scopeIdForToken({ token: account });
  return {
    profile: async () =>
      safeProviderCall({
        blockWait: false,
        execute: () => client.users.getProfile({ userId: "me" }),
        operation: "gmail.users.getProfile",
        provider: "gmail",
        retryMode: "never",
        scopeId,
      }).map((response) => ({
        account: absentAs({ value: response.data.emailAddress, whenAbsent: account }),
        messagesTotal: absentAsNumber({ value: response.data.messagesTotal, whenAbsent: 0 }),
      })),
  };
}
