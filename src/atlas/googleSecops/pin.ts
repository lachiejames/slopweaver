/**
 * What `generated/protoLock.ts` pins: the googleapis sources the Chronicle v1 method inventory was compiled
 * from, at ONE commit, so a regeneration that quietly read something else fails instead of publishing.
 *
 * ## Why a commit, a URL and a digest, and no committed copy
 *
 * `googleAdmin/generated/discoveryLock.ts` is the sibling and the reasoning is the same: the generated
 * table is the reviewed boundary, and the bytes it came from are pinned rather than vendored, so a reviewer
 * diffs 92 rows instead of 322 KB of somebody else's protos. Unlike a discovery document, a
 * `raw.githubusercontent.com/<owner>/<repo>/<commit>/...` URL is commit-addressed, so its bytes cannot be
 * republished under the same address; the digest still guards a truncated or substituted fetch.
 *
 * Reproduce the whole pin, and regenerate the table, in one command (the commit was resolved with
 * `git ls-remote https://github.com/googleapis/googleapis refs/heads/master`):
 *
 * ```bash
 * yarn tsx tools/generateGoogleSecopsSurfaces.ts --fetch <dir>   # writes surfaces.ts AND protoLock.ts
 * yarn tsx tools/generateGoogleSecopsSurfaces.ts --verify --spec-dir <dir>   # plus the byte digests, the parse
 * yarn tsx tools/generateGoogleSecopsSurfaces.ts --verify                    # the committed files only
 * ```
 *
 * To move the pin: change the commit and the pins in `generated/protoLock.ts`, run `--fetch`, and the
 * generator prints every byte length and digest that moved alongside every census number that did. Each one
 * is a thing to READ — a new method, a service entering `apis:`, a scope rule widening — before it is copied
 * in and re-rendered.
 *
 * ## Why this file is not in `generated/`, and holds only a type
 *
 * Every file in `generated/` is DATA, and both checks require each to be byte-equal to what
 * `../surfacesRender.ts` renders for its own imports, so none can carry code. Hand-written TypeScript there
 * could make a read lie: adversarial reviews gave the pins array its own `Symbol.iterator`, first inside the
 * lock and then from a hand-written sibling that mutated it at import, moving a `declared` count between two
 * files for one reader and not another, and every check including `--spec-dir` passed. This module is only
 * ever imported as a type, so nothing written in it runs.
 *
 * - **Pins**: every file in `google/cloud/chronicle/v1/` that declares a method or decides one. Every
 *   `.proto` in the directory is pinned, including `featured_content_metadata.proto`, which declares messages
 *   only, so a service added to it later moves `declared` instead of going unread. The directory's
 *   `BUILD.bazel`, `chronicle_gapic.yaml` and `chronicle_v1_grpc_service_config.json` declare no method, no
 *   binding and no scope, and are not pinned.
 * - **Unpublished services**: the services a pinned proto declares that `chronicle_v1.yaml` does not list
 *   under `apis:`. Parsed and counted but never rows: the service config decides what the v1 API publishes,
 *   and `inventory.ts`'s header says why these stay out of the denominator. All seven of their rpcs DO have
 *   authentication rules in the config, every one granting `chronicle.readonly`, which is why the choice is
 *   stated rather than left to look like an oversight. A service moving into `apis:` fails this pin.
 * - **Inventory digest**: the sha256 of `surfaces.ts`'s canonical serialisation plus every pin's `declared`
 *   and the unpublished list (`tableIntegrity.ts`). The census counts rows per axis and its totals cannot see
 *   a path, a scope list, the order, or a count moved between two files change; this digest can.
 * - **Census**, measured on the pinned generation:
 *   - **39 of the 92 published methods are GETs, and all 39 are entities** — the v1 denominator.
 *   - **21 of those reads accept `chronicle.readonly`; 18 accept ONLY `cloud-platform`** — rules,
 *     retrohunts, rule deployments, reference lists, watchlists, data access labels and scopes,
 *     `GetInstance` and the two Operations reads. That split is the number the owner's scope pick (O1) is
 *     decided on.
 *   - **Every one of the 53 non-GETs is excluded**: 48 change the instance, 5 are POST reads (a bulk get,
 *     two text verifications, two computed activity summaries). Read-only forever means none is called.
 */
import type { PinnedDocument } from "../kit/pinnedSpec.js";

/**
 * One pinned source file.
 * @internal
 */
export interface GoogleSecopsPin extends PinnedDocument {
  /**
   * How many methods the file declares, published or not: rpcs for a proto, `http.rules` for the yaml.
   * The parse half of the census — a reader that started skipping an rpc moves this before anything else.
   */
  readonly declared: number;
}
