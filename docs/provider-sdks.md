# Provider SDKs — lean on the official client, and check that it IS the official client

The owner's ruling, as a general rule: lean on a library's TypeScript SDK client, especially an official one, to
do as much of the work as it can, rather than reinventing an SDK for little value — and never fall for an
unofficial SDK, because there are plenty of those around.

The memory `slopweaver-prefer-libraries` is the precedent; this is the same instinct applied to the one
category where getting it wrong is a supply-chain problem rather than a taste problem.

## The rule

**Reach a provider through its official TypeScript SDK — its client, its types and its operations — never
hand-rolled transport around it.** An official client already holds authentication, token refresh, retry,
pagination, rate-limit backoff and the wire shapes, and every one of those is a class of mistake it makes
_structurally impossible_ rather than merely easy to avoid. Re-deriving one is not incremental work; it is
re-opening a closed defect class.

`src/live/slack/download.ts` calls it "the house rule", and `src/atlas/cloudflare/descriptor.ts` and
`model.ts` both say "through the official SDK"; it is written down here because a rule that lives only in a
module header is a rule the next session re-argues.

## "Official" is a registry check, not a guess from the name

The audit that produced this rule found **four** near-miss packages sitting exactly where a hurried session
would install one. Each was rejected on registry evidence:

| Package                             | What it actually is                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `vanta`                             | A 3D animated-background library by `tengbao`. Not the compliance vendor at all.        |
| `@vanta-dev/node` (and four others) | A newly minted namespace with one maintainer, **no `repository` field**, no provenance. |
| `hibob`                             | `speakeasy-sdks/hibob` — a third-party generator's output, not HiBob's.                 |
| `jumpcloud`                         | `trueaccord/jumpcloud-node`, last published **2016**, 18 downloads a month.             |

Alongside them, **216** `vanta-dep-<digits>` packages, every one published by the same account on the
same day with no repository — the shape of a dependency-confusion sweep against a private
`vanta-*` name (count reproduced by paging
`registry.npmjs.org/-/v1/search?text=vanta-dep&size=100&from=<n>` and matching `/^vanta-dep-\d+$/`).

So, before adding any provider dependency, check all five:

1. **`repository`** resolves into the vendor's own GitHub organisation.
2. **Maintainers** are the vendor's npm organisation, across the package's whole publish history — not one
   individual account, and not a handover partway through.
3. **History** is measured in years and still moving.
4. **Provenance.** Where the vendor publishes from CI, `dist.attestations` carries
   `https://slsa.dev/provenance/v1`. Its absence is not disqualifying — `@1password/sdk` is genuinely
   1Password's and has none — but it downgrades the npm→GitHub link from cryptographic to asserted, and that
   belongs in the commit message rather than in nobody's head.
5. **Read the repository through the door** and see what it says about itself:
   `slopweaver github repo --repo <owner/name> --description "x" --dry-run` prints the current description
   and writes nothing. That is how `1Password/onepassword-sdk-js` was confirmed as "The official JavaScript
   SDK for 1Password", and how `@vantasdk/vanta-mcp-server` was found to open "DEPRECATED: This project is no
   longer maintained."

## Six edges the audit actually found

These are the parts worth encoding, because each is a case where the naive reading of the rule is wrong.

- **An endpoint the SDK does not cover is a reason to add transport, not to abandon the SDK.** Datadog ships
  no API class for `/api/v1/logs-analytics/*`, so `src/datadog/rawTransport.ts` exists — with its method type
  admitting `GET` and `POST` only, so a mutating call is a compile error rather than a review catch. Type the
  escape hatch so it cannot grow, and say in the module header why the SDK could not answer.

- **A route the SDK's generated TYPES do not know is still the SDK's job.** Octokit's `client.request(...)`
  takes a route string, so GitHub's native-stack endpoints and its asynchronous merge request
  (`PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async` and its `.../{uuid}` poll) ride the SAME
  authenticated, throttled, redirect-guarded client every typed call does — only the response projection is
  hand-written, defensively, in `src/corpus/github/stack.ts` and `src/corpus/github/mergeAsync.ts`. That is
  the whole difference between "the generated types have not caught up" and "we built transport". Check the
  installed `@octokit/openapi-types` before repeating that a route is uncovered: it is a fact about the
  version in the lockfile, not about the endpoint.

- **Extend the SDK rather than replace it when it is wrong.** Cloudflare's generated parser ignores
  Cloudflare's own `success` field, so a `success:false` body riding on HTTP 200 reads as an empty success.
  `src/atlas/cloudflare/client.ts`'s `guardingFetch` wraps the SDK's _own_ fetch and hands it a synthesized
  error response, so the SDK's `APIError.generate` throws exactly as it would for a genuine 4xx. Every other
  response passes through byte for byte.

- **Reading an SDK beats calling one when the question is "what exists".** Five atlases take their API
  surface from the installed package's own generated sources rather than a list somebody typed — Slack's
  `.d.ts` (`src/atlas/slackApi/sdkTypings.ts`), Notion's generated endpoint modules, GitHub's OpenAPI types,
  Xero's generated operations, and Datadog's compiled client. A hand-written endpoint list is a snapshot of
  the day it was typed, and a route it invents looks exactly as correct as one that works.

- **An SDK that widens what a caller can do is not an improvement.** `@1password/sdk` is genuinely
  1Password's, and this repository still does not want it: it covers two of the nine `op` surfaces the
  1Password atlas reads and none of the Events API, while putting `secrets.resolve()` and `items.delete()` on
  the same client object as those reads. `src/atlas/onepassword/opCli.ts` takes a surface NAME, never an argv,
  so "a caller reads an item's contents" is not expressible. Adopting the SDK would make it one method call.

- **Take the SDK, not its default middleware, when the middleware retries.** The Outlook door uses
  `@microsoft/microsoft-graph-client` and `@azure/msal-node`, both Microsoft's, from one file
  (`src/live/outlook/client.ts`). The Graph client's default chain includes a `RetryHandler` that retries a 429
  itself, POSTs included, beneath `safeProviderCall`'s own retry, so a move or a send could go out twice. The
  door builds the chain as authentication then the wire and nothing else. Both packages call the global `fetch`
  at request time, so the fixture lane (`src/__tests__/subprocess/live/outlook/`) redirects them with a preload
  in the spawned CLI and production code carries no override.

## Validate what you read

The owner's steer, off the plan-budget reader: **every outbound boundary validates what it reads
with a runtime Zod schema per endpoint, and fails loudly and early on a missing, renamed or new field.** An
official, versioned SDK is still the first choice, because it pins the API version you read rather than
whatever the provider serves today; the rule below is the precedent for the clients no SDK covers.

- **One boundary per endpoint, strict all the way down.** `defineBoundary({ endpoint, schema })`
  (`src/lib/boundary.ts`) takes a schema whose every object is `z.strictObject`, and throws at definition if
  one is not, or if anything else there could read drift as success (`.catch()`, any `.transform()` or pipe,
  `z.coerce`, `z.any`, any check but a plain bound (`z.property` included), an error map or any `when` Zod did not
  install itself, a format's included (Zod hands either the live issue or payload), `.prefault()`, a bound on a type it does
  not measure, such as `.optional()`, `.default()`, `.nullable()`, a union or an object (Zod runs it on an absent
  key, a default, null or a field named `length`), `.exactOptional()` (it runs its inner schema on an absent key),
  `z.xor` (it fails when two arms match, an absent key included), `z.undefined`, `z.void` and a literal allowing
  undefined (no JSON carries undefined — an absent key is `.optional()`), a record keyed
  by numbers, a symbol key, a key named like an `Object.prototype` member (Zod reads an absent one through the
  prototype), a schema or check whose `type` or `check` label a param overwrote (read against the class that built
  it, `src/lib/boundaryTraits.ts`), any intersection, a union beside a
  keys-anything arm; the file header of `src/lib/boundaryWalk.ts` has the whole list). An own `__proto__` key
  anywhere in an answer, which Zod's record skips, is refused at the read as a new field. A boundary validates; the domain maps the parsed value AFTER the
  read. Its `parse`/`parseJson` refuse drift BY NAME: `new field "x"`, `field "y" is missing`,
  `field "a" renamed to "b"?` (the nearest-field finder `strictForm` already used), `field "z" changed`.
- **A plain `z.union` holds at most ONE arm reading objects and one reading lists.** Two of a kind — however
  wrapped or nested — are refused at definition (`src/lib/boundaryUnion.ts`), because when neither matches no
  read can say which the provider sent (an object-or-list union stays legal: each arm refuses the other kind):
  eight review passes each found a ranking of arms that named a field of the wrong one. Spell them a
  `z.discriminatedUnion` on a field EVERY arm carries (Zod reads only the arm its tag names; an optional,
  defaulted or nullable tag, a nested arm without it, a nest on another field whose arms answer different values
  of the tag, a value two arms share, or `unionFallback`, is refused,
  since a dropped tag then reads as some arm), or one
  `z.strictObject` whose differing keys are optional — that trade makes a dropped differing key quiet. A refusal
  reads the one arm that did not refuse the value outright (`src/lib/boundaryArms.ts`): `null`/`string`/a literal
  beside one object is never a guess.
- **Declare every key the answer carries; read only what you need.** A key you do not read is declared as
  `z.unknown().optional()`, so an ADDED key is loud at any depth and a DROPPED one is loud wherever you read it.
  The key set is only known from a live answer: read it against the real endpoint before landing.
- **A field holding an authored DOCUMENT is one key you do not read.** A workflow's DSL, a filter tree or a JSON
  Schema has keys its author wrote at any depth, so a schema measured from one answer refuses the next. Name each
  such field with its reason and declare it `z.unknown()`, required or optional as measured; the record holding it
  stays strict. The trade: nothing inside it is checked, its kind included. Name it, never infer it from how much
  sibling records vary — the first list is `src/atlas/jumpcloud/responseDocumentPaths.ts`.
- **Map the refusal into your domain's error** at the call, carrying `message`, exactly as with `IngestError`.
- **The precedent is `claude reset`.** Its first strict read of `/api/oauth/usage` refused with twenty-eight
  fields the plain `z.object` before it had dropped without a word — `arm` and `percent_used` on every grant,
  `event_props` on the block, and twenty-five top-level keys, most of them experiment codenames. The trade is
  stated rather than discovered: that top level is where the provider moves most often, so `claude reset`
  refuses on each new codename until one line declares it (`src/claude/resetStatus.ts`).

**`boundary-schema` in `yarn lint`** refuses a source that calls a bare `fetch(`, the Datadog raw-text
transport or a bound `transport.request(` and reads JSON in the same file without `defineBoundary`, over a debt
list that only shrinks and is now empty (`src/devLint/boundarySchemaDebt.ts`): the last row, the Datadog atlas's
329 operations, retired by generating one strict boundary per operation from the pinned specification and a
census (`src/atlas/datadog/responseCodegen.ts`). Vanta has no official SDK, so `src/atlas/vanta/sdk/` is ours: every
operation, write client and the token mint reads through its own strict boundary, the document detail included,
because the owner wants it to stay strict: when the upstream provider changes, this codebase is updated to match.
Its blind spots are named in its header: a transport and parser in two files through another seam, an injected
fetch under another name, and **an official SDK's response** — typed at compile time and validated by nothing at
runtime. The steer names SDK reads too; bringing them under a runtime schema is its own board row, because a
strict schema over an Octokit pull request means declaring every field GitHub sends.

## Why the SDK choice is prose and not a gate

A static gate here would have to distinguish "raw fetch because the SDK has no method for it" from "raw fetch
because nobody looked", and on this tree every raw-fetch site beside an SDK is the first kind and says so in
its header. The check that would pay for itself is narrower — **a new dependency's officialness evidence,
asserted at the moment it is added** — and it is not built. Until it is, the five checks above are a reviewer's
list, and the evidence for a new provider dependency belongs in the commit that adds it.
