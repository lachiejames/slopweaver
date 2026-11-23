import { err, ok, type Result } from "../../lib/result.js";

/**
 * The compile-and-publish critical section a compiled API sync runs, owned once rather than per atlas.
 *
 * Kit-owned for the reason `./frontierWalk.ts`'s walk half already is: it was copied whole, and the ORDER
 * inside it is the property a copy loses. The generation is read by the caller, this run's definitions are
 * compiled against it, the compiled kinds are merged onto what the store already held, and only then is
 * anything written — and the manifest the publish compare-and-swaps against is the one THAT read returned,
 * never a second read that could have moved in between.
 *
 * It became a clone the gate could SEE rather than one only a reader could when the per-atlas
 * compare-and-swap moved into `./publish.ts`: the lines that still differed between two atlases were the
 * ones naming each atlas's own guard, and with those gone the two functions were one function. Every step
 * is a seam, so each platform keeps its own store, schemas, file shapes and run report.
 *
 * `./compiledSync.ts` is the other half of the same story and deliberately separate: that module owns the
 * pure folds a compiled sync uses to BUILD its kind files, while this one owns the effectful order they are
 * written in.
 *
 * @param snapshot the generation the caller read — both what the compile merges onto and, through its own
 *   manifest, what the caller's `publish` must swap against
 * @param compile build this run's kind files from its definitions, against what the store already held
 * @param filesFor every kind file to publish, given the compiled ones
 * @param manifestFor the manifest to publish, given the compiled ones
 * @param publish write the files and then the manifest
 * @returns what the compile produced and the paths written, or every reason nothing was
 */
export function publishCompiledGeneration<TSnapshot, TCompiled, TFiles, TManifest>({
  snapshot,
  compile,
  filesFor,
  manifestFor,
  publish,
}: {
  snapshot: TSnapshot;
  compile: (input: { snapshot: TSnapshot }) => Result<TCompiled>;
  filesFor: (input: { compiled: TCompiled; snapshot: TSnapshot }) => TFiles;
  manifestFor: (input: { compiled: TCompiled; snapshot: TSnapshot }) => TManifest;
  publish: (input: { files: TFiles; manifest: TManifest }) => Result<readonly string[]>;
}): Result<{ compiled: TCompiled; written: readonly string[] }> {
  const compiled = compile({ snapshot });
  if (compiled.isErr()) {
    return err(compiled.error);
  }
  const published = publish({
    files: filesFor({ compiled: compiled.value, snapshot }),
    manifest: manifestFor({ compiled: compiled.value, snapshot }),
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({ compiled: compiled.value, written: published.value });
}
