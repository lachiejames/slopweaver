// Stub for `sharp` — slopweaver only does TEXT embeddings, never image pipelines, but
// @xenova/transformers hard-depends on sharp and imports it eagerly (utils/image.js). The real sharp is
// a native dep whose binary breaks cross-platform installs (it needs a package-install lifecycle script
// to wire up its platform binary, and this repo runs with `enableScripts: false`). This no-op keeps the
// import working; it throws only if an image pipeline is actually used (never, here).
//
// reproduce the two facts this stub depends on:
//   grep -n '"sharp"' node_modules/@xenova/transformers/package.json        # dependencies, not optional
//   grep -n "^import sharp" node_modules/@xenova/transformers/src/utils/image.js
//   grep -n "utils/image" node_modules/@xenova/transformers/src/transformers.js  # main entry re-exports it
// If either no longer holds (upstream made sharp optional, or dropped/relocated the import), this stub
// may no longer be needed — re-verify (see src/__tests__/unit/stubs/sharpAssumptions.test.ts) before
// deleting it and the `sharp` entry in package.json's `resolutions`.
//
// The `resolutions` pin is repo-wide: any dependency that resolves `sharp` gets this stub, not just
// @xenova/transformers — currently also promptfoo (dependencies: sharp ^0.35.3) and its own transitive
// @huggingface/transformers (sharp ^0.34.5), both unrelated to slopweaver's own text-embedding use. The
// thrown message below deliberately does not claim slopweaver is the caller.
export default function sharp() {
  throw new Error(
    "sharp is stubbed by this repo's package.json `resolutions` override (portal:./stubs/sharp) — every " +
      "consumer of the `sharp` package in this dependency tree gets this no-op instead of the real " +
      "native binary. slopweaver itself only does text embeddings and never invokes an image pipeline; " +
      "if you are seeing this from another package, that package tried to use sharp for real. See " +
      "stubs/sharp/index.js.",
  );
}
