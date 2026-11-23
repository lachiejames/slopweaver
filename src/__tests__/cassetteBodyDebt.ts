/**
 * The request-body fidelity DEBT — every committed cassette entry that still cannot prove what was sent.
 *
 * `setup-polly.ts` persists a projection of every request body and holds a replayed request to it
 * (`cassetteRequestBody.ts`). That only reaches an entry whose recording actually carries a body. An entry
 * whose body was blanked to `""` has nothing to be held to, and no amount of code can recover it: the bytes
 * are gone, and only a re-record against the real provider writes them. So such a gap is written down here
 * instead of being left as a silent pass.
 *
 * **Keyed by recording DIRECTORY because that is the unit of repair.** You do not re-record one entry; you
 * re-record the suite that wrote it, with `POLLY_MODE=record` and that provider's record-time credentials —
 * the `Run:` block at the top of each integration test names its own. When a suite is re-recorded under the
 * current persist path, its entries gain bodies and its row must be deleted or lowered, which is precisely
 * the diff that makes progress visible.
 *
 * **The register only shrinks, and `unit/cassetteBodyFidelity.test.ts` is what enforces that** — in BOTH
 * directions, the house shape for a debt list (see `whole-file-json`'s own): the test recomputes the map from
 * the committed `.har` files and asserts EQUALITY, so a new unproven entry fails as loudly as a row that has
 * silently stopped firing.
 *
 * MEASURED over the two committed cassettes — the synthetic safe fixture, and
 * `integration/githubCodeScanningEnable.test.ts`'s one GitHub GET (every other suite that replays a recording
 * is quarantined in `config/vitest/integration.ts`): 3 entries, a GraphQL POST carrying its body, a Slack call
 * carrying none and the GET — 1 proven, 0 unproven, 0 untexted, 2 absent.
 * Reproduce with
 * `yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/cassetteBodyFidelity.test.ts`.
 */

/** A committed recording directory, and how many of its entries carry no recorded request body. */
export const CASSETTE_BODY_DEBT: ReadonlyMap<string, number> = new Map<string, number>();

/** How many committed entries carry a recorded request body and are therefore held to it on every replay. */
export const CASSETTE_BODY_PROVEN = 1;

/**
 * How many committed entries sent a body the persister writes NO TEXT for — an upload's bytes (a PNG to cloud
 * storage, a file to Slack's upload host), where Polly records the `postData` member with a mime type and no
 * `text`. These are not debt: a re-record cannot give them text either, so the comparison answers
 * `unrecorded` for them by construction, and this count is what keeps that exception visible rather than
 * folded into {@link CASSETTE_BODY_ABSENT}.
 */
export const CASSETTE_BODY_UNTEXTED = 0;

/** How many committed entries sent no request body at all — a GET, which has nothing to prove either way. */
export const CASSETTE_BODY_ABSENT = 2;
