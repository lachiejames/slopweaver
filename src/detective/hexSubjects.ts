/**
 * Reading the stored Hex atlas into the subjects {@link ./hexLead} matches keywords against.
 *
 * Its own module rather than a function inside the gate, because this is the one part of the Hex lead that
 * KNOWS the atlas's stored shape. The gate stays pure over a plain list — which is what makes it testable
 * with a literal — and the coupling to `atlas/hex/model.ts`'s detail schemas lives here, in one place a
 * change to those schemas breaks visibly.
 *
 * It makes no network call and opens no credential: `readHexSnapshot` is a file read, which is the whole
 * point of gating a Hex read on a local probe first.
 */
import { hexProjectDetailSchema, hexResourceDetailSchema } from "../atlas/hex/model.js";
import { readHexSnapshot } from "../atlas/hex/readAdapter.js";
import type { AtlasKindView } from "../atlas/kit/read.js";
import type { HexAtlasSubject } from "./hexLead.js";

/** One kind's entities, or an empty list when the atlas holds that kind at all. */
function entitiesOf({ kinds, kind }: { kinds: readonly AtlasKindView[]; kind: string }): AtlasKindView["entities"] {
  const held = kinds.find((view) => view.kind === kind);
  if (held === undefined) {
    return [];
  }
  return held.entities;
}

/**
 * Project the stored atlas into the gate's subjects.
 *
 * A row whose detail does not parse is DROPPED rather than half-read: the detail schemas are this
 * repository's own, so a parse miss means the stored generation predates them, and a subject assembled out
 * of a shape nobody recognises would match keywords against fields that are not what they look like.
 *
 * @param home the state home holding the atlas; omitted takes `$SLOPWEAVER_HOME`
 * @returns the subjects, and the reason there are none when the atlas cannot be read
 */
export function readHexSubjects({ home }: { home?: string } = {}): {
  subjects: readonly HexAtlasSubject[];
  unreadable: string | null;
} {
  const snapshot = readHexSnapshot(home === undefined ? {} : { home });
  if (snapshot.isErr()) {
    return { subjects: [], unreadable: snapshot.error.message };
  }
  const kinds = snapshot.value.kinds;
  const projects = entitiesOf({ kind: "project", kinds }).flatMap((entity): readonly HexAtlasSubject[] => {
    const parsed = hexProjectDetailSchema.safeParse(entity.detail);
    if (!parsed.success) {
      return [];
    }
    return [
      {
        categories: parsed.data.categories,
        description: parsed.data.description,
        family: "project",
        name: parsed.data.title,
        projectId: entity.providerId,
        queriedTables: parsed.data.queriedTables,
      },
    ];
  });
  const connections = entitiesOf({ kind: "resource", kinds }).flatMap((entity): readonly HexAtlasSubject[] => {
    const parsed = hexResourceDetailSchema.safeParse(entity.detail);
    if (!parsed.success || parsed.data.family !== "data-connection") {
      return [];
    }
    return [
      {
        categories: [],
        description: parsed.data.description,
        family: "connection",
        name: parsed.data.name,
        projectId: null,
        queriedTables: [],
      },
    ];
  });
  return { subjects: [...projects, ...connections], unreadable: null };
}
