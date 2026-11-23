/**
 * The compile pass of `atlas hex sync`, and what it says about itself: fetching and compiling every pinned
 * document, the coverage reason and state that compile earned, the gaps it observed, and the standing
 * withholding gap. A leaf: it imports nothing from `sync.ts` or `syncPublish.ts`, which both read it.
 */
import { compilePinnedCatalogue, type CompiledCatalogue as KitCompiledCatalogue } from "../kit/pinnedSpec.js";

import { HEX_PROBE_CENSUS } from "./apiProbe.js";
import { describeHexDrift, type HexSpecError } from "./errors.js";
import { openHexGap } from "./gaps.js";
import { HEX_CLIENT_SURFACE } from "./generated/clientSurface.js";
import { HEX_SPEC_PINS } from "./generated/specLock.js";
import type { HexAtlasGap, HexAtlasKind, HexAtlasKindFile } from "./model.js";
import { type HexSpecTransport, verifyAndCompile } from "./specFetch.js";
import type { HexSpecPin } from "./specPin.js";
import type { HexSpecSurface } from "./specSurface.js";

/** Every compiled document, plus whatever could not be compiled and whatever has since moved. */
export type CompiledCatalogue = KitCompiledCatalogue<HexSpecSurface, HexSpecError>;

/**
 * Fetch and compile every pinned document. Nothing here stops the batch.
 *
 * @param pins the reviewed lock
 * @param transport how one document's bytes are obtained; a test supplies a deterministic fake
 * @returns every surface compiled, every document that could not be, and every one that has moved
 *
 * @internal
 */
export async function compileHexCatalogue({
  pins,
  transport,
}: {
  pins: readonly HexSpecPin[];
  transport: HexSpecTransport;
}): Promise<CompiledCatalogue> {
  return compilePinnedCatalogue({
    compile: ({ pin, text }) => verifyAndCompile({ pin, text }),
    countOperations: ({ surface }) => surface.operations.length,
    pins,
    transport,
  });
}

/**
 * How many of a file's method rows carry one disposition on the api channel.
 *
 * @returns the number of rows whose api-channel detail names that disposition
 */
export function dispositionCount({ file, disposition }: { file: HexAtlasKindFile; disposition: string }): number {
  return file.entities.filter((entity) => {
    const detail = entity.channels.api?.detail;
    return (
      typeof detail === "object" && detail !== null && (detail as { disposition?: unknown }).disposition === disposition
    );
  }).length;
}

/**
 * The coverage reason and state one compile earned, stated as a fraction rather than as a total.
 *
 * @returns the cell's reason and its `synced` or `deferred` state
 */
export function compileCell({ catalogue }: { catalogue: CompiledCatalogue }): {
  reason: string;
  state: "deferred" | "synced";
} {
  const declared = HEX_SPEC_PINS.length;
  const compiled = catalogue.surfaces.length;
  if (compiled === declared) {
    return {
      reason:
        `${String(compiled)} of ${String(declared)} pinned document(s) compiled, declaring ` +
        `${String(catalogue.operationCount)} operations. Beside them: ` +
        `${String(HEX_PROBE_CENSUS.filter((row) => row.evidence === "mounted-401").length)} of ` +
        `${String(HEX_PROBE_CENSUS.length)} probed nouns mounted, and ` +
        `${String(HEX_CLIENT_SURFACE.graphqlOperations.length)} GraphQL operations the shipped client declares`,
      state: "synced",
    };
  }
  return {
    reason:
      `${String(compiled)} of ${String(declared)} pinned document(s) compiled — ` +
      `${String(catalogue.failures.length)} could not be read, and each carries its own gap. The operations ` +
      "those documents declare are absent from this generation rather than absent from Hex",
    state: "deferred",
  };
}

/**
 * One gap per document this run could not read, one per document that has moved, and the standing one this
 * atlas raises about its own withholding.
 *
 * All three are per-KIND, because a reader filtering `atlas hex coverage --kind method` should see the
 * reasons the method rows are what they are without having to know that another kind carries them.
 *
 * @param catalogue what the compile pass came back with
 * @param kind the kind these gaps are recorded against
 * @param at this run's ISO timestamp
 * @returns the gaps this run observed
 */
export function catalogueGaps({
  catalogue,
  kind,
  at,
}: {
  catalogue: CompiledCatalogue;
  kind: HexAtlasKind;
  at: string;
}): readonly HexAtlasGap[] {
  return [
    ...catalogue.failures.map((failure) =>
      openHexGap({
        at,
        condition: "spec-unreadable",
        fields: [],
        kind,
        reason: `${failure.message}. Re-run \`slopweaver atlas hex sync\`; a document that stays unreadable is a Hex-side change worth regenerating the lock for`,
        scope: failure.specId,
        surfaces: ["api"],
      }),
    ),
    ...catalogue.drifts.map((drift) =>
      openHexGap({
        at,
        condition: "spec-moved",
        fields: [],
        kind,
        reason: describeHexDrift({ drift }),
        scope: drift.specId,
        surfaces: ["api"],
      }),
    ),
  ];
}

/**
 * The standing gap this atlas raises about its own withholding, never closed.
 *
 * @param at this run's ISO timestamp
 * @param withheld how many operations carry the withheld disposition
 * @returns the one gap
 */
export function withholdingGap({ at, withheld }: { at: string; withheld: number }): HexAtlasGap {
  return openHexGap({
    at,
    condition: "result-data-withheld",
    fields: [],
    kind: "method",
    reason:
      `${String(withheld)} operation(s) are mapped in full and never called for their body, because their ` +
      "response is or renders the result of executing something against a data connection. This is the " +
      "owner's rule — this atlas stores no customer data locally — rather than a shortfall, " +
      "so it is PERMANENTLY open and nothing closes it. Read which ones with `slopweaver atlas hex read " +
      "--kind method --query withheld --json`, and `src/atlas/hex/disposition.ts` carries the criterion",
    scope: "result-bearing-operations",
    surfaces: ["api", "browser"],
  });
}
