/**
 * The two things a schema cannot see, refused by the atlas kit — a manifest whose per-kind numbers contradict
 * each other, and a kind file holding a record that belongs to another kind. Both are structural checks over
 * documents that already parsed, so they live beside `store.ts` rather than inside any platform's schema:
 * `store.ts` applies {@link kindDisagreements} on every read and at publish, and {@link incoherentKinds} at
 * publish, once the digests are stamped. {@link validateGeneration} is the publish-time pass that runs the
 * platform's own schemas beside the misrouting check, so every pre-write document judgement sits here. Pure.
 */
import { isRecord } from "../../lib/parsers.js";
import type { AtlasKindStatus } from "./kindStatus.js";
import type { AtlasKindFileLike, AtlasManifestLike, AtlasStoreSpec } from "./store.js";

/** The `kind` a document declares on itself, or `null` when it carries none the kit can read. */
function declaredKind({ document }: { document: unknown }): string | null {
  if (!isRecord(document)) {
    return null;
  }
  const kind = document["kind"];
  return typeof kind === "string" ? kind : null;
}

/**
 * Every way one kind file disagrees with the kind it is filed under — its own declared kind, and each
 * entity's.
 *
 * A platform's schema validates a kind file against ONE shape, and the kinds that share a shape are exactly
 * the ones a mis-routed projection moves between: a Cloudflare zone-setting inside `dns-record.jsonl` parses
 * clean, publishes, and is read back forever as a DNS record. The kind enum sits on the FILE and on each
 * ENTITY on every atlas that carries one, and nothing compared them. This does — structurally, so an atlas
 * whose entities carry no kind of their own (CrowdStrike discriminates its file union instead) is simply not
 * checked rather than being forced to invent one.
 *
 * @param document the assembled kind document, straight off disk or about to be written
 * @param kind the kind whose slot it occupies, which the path already decided
 * @returns one line per disagreement, empty when the document agrees with its slot
 */
export function kindDisagreements({ document, kind }: { document: unknown; kind: string }): readonly string[] {
  const problems: string[] = [];
  const fileKind = declaredKind({ document });
  if (fileKind !== null && fileKind !== kind) {
    problems.push(`the file declares kind ${fileKind}`);
  }
  const held: readonly unknown[] =
    isRecord(document) && Array.isArray(document["entities"]) ? document["entities"] : [];
  for (const entity of held) {
    const entityKind = declaredKind({ document: entity });
    if (entityKind !== null && entityKind !== kind) {
      const id = isRecord(entity) && typeof entity["id"] === "string" ? entity["id"] : "an unidentified entity";
      problems.push(`${id} is a ${entityKind}`);
    }
  }
  return problems;
}

/**
 * Refuse a stamped manifest whose per-kind numbers contradict each other.
 *
 * A digest is stamped from bytes {@link publishAtlas} actually writes, so a kind that claims entities or a
 * success while carrying none was never written by the generation claiming it — `publishAtlas` accepts a
 * PARTIAL file set and leaves an omitted kind's file untouched, so a platform that stamps a success for a
 * kind it did not hand over publishes a manifest describing a file nobody wrote. The read side then digests
 * that unchanged file against its own unchanged digest and answers `agrees`, which is why this has to be
 * caught here rather than graded afterwards.
 *
 * CrowdStrike carried this as half of its own publish guard first, and this half is here because the
 * partial-set protocol is the kit's rather than any platform's. Its OTHER half — a `lastAttempt` of `ok`
 * with no success time — deliberately stayed behind: what `outcome: "ok"` means is a fact about how a
 * platform's own sync writes its manifest, and five atlases here record an attempt that ran cleanly while
 * never reading the kind at all. Lifting that one broke every one of them, which is the same reason
 * {@link AtlasStoreSpec.gradeNeverSucceeded} is a parameter.
 *
 * @param kinds the platform's own kind list
 * @param manifest the manifest as it would be written, digests already stamped
 * @returns one line per incoherence, empty when every kind's numbers agree
 */
export function incoherentKinds<TKind extends string>({
  kinds,
  manifest,
}: {
  kinds: readonly TKind[];
  manifest: { readonly kinds: Readonly<Record<TKind, AtlasKindStatus>> };
}): readonly string[] {
  const problems: string[] = [];
  for (const kind of kinds) {
    const status = manifest.kinds[kind];
    if (status.digest === null && status.entityCount > 0) {
      problems.push(
        `${kind} is graded with ${String(status.entityCount)} entities but carries no file digest — the count describes a file this generation never wrote`,
      );
    } else if (status.digest === null && status.lastSuccessAt !== null) {
      problems.push(
        `${kind} records a success at ${status.lastSuccessAt} but carries no file digest, so nothing vouches for the bytes on disk`,
      );
    }
  }
  return problems;
}

/**
 * Validate every document before the first byte is written, so a bad manifest leaves no orphan files.
 *
 * Lives beside {@link kindDisagreements} because it is the publish-time half of the same structural check,
 * plus the platform's own schema over each kind file and the manifest. Pure.
 *
 * @param files the kind files this publish is writing; a kind absent here is not judged
 * @param manifest the stamped manifest about to be published
 * @param spec the platform's own document contract, carrying its kind list and both parsers
 * @returns one line per document that would not be storable, empty when the generation may be written
 */
export function validateGeneration<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
>({
  files,
  manifest,
  spec,
}: {
  files: Readonly<Partial<Record<TKind, TFile>>>;
  manifest: TManifest;
  spec: AtlasStoreSpec<TKind, TFile, TManifest>;
}): readonly string[] {
  const problems: string[] = [];
  for (const kind of spec.kinds) {
    const file = files[kind];
    if (file === undefined) {
      continue;
    }
    const parsed = spec.parseKindFile({ json: file });
    if (!parsed.success) {
      problems.push(`refusing to write ${kind}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
    }
    const misrouted = kindDisagreements({ document: file, kind });
    if (misrouted.length > 0) {
      problems.push(`refusing to write ${kind}: ${misrouted.slice(0, 8).join("; ")}`);
    }
  }
  const parsedManifest = spec.parseManifest({ json: manifest });
  if (!parsedManifest.success) {
    problems.push(
      `refusing to write the manifest: ${parsedManifest.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  return problems;
}
