/**
 * One place in an operation's answer as `responseCodegen.ts` reads it — what was measured there, what the
 * specification declares there, and the cut the specification alone forces there — with no read below it. The
 * walk that descends is `responseCodegen.ts`'s; everything here answers about one place and returns.
 */
import { err, ok, type Result } from "#lib/result.js";

import { ownCensusEntry, type ResponseJsonKind, type ResponseStructure } from "../kit/responseStructure.js";

import { type DatadogCodegenError, DatadogCodegenErrors } from "./responseCodegenErrors.js";
import { type DatadogSpecView, datadogSpecView } from "./responseSpec.js";
import type { DatadogCutReason, DatadogSpecNode } from "./responseSpecNode.js";

/** One place the census measured what the specification does not declare, admitted and listed. */
export interface DatadogSpecLag {
  /** The census path: the key's own path for `key`, the place the kind was measured otherwise. */
  readonly path: string;
  readonly lag: "key" | ResponseJsonKind;
}

/** One place a boundary leaves unread, as the inventory lists it. */
export interface DatadogCut {
  readonly path: string;
  readonly reason: DatadogCutReason;
}

/** What every builder reads. */
export interface Context {
  readonly document: Readonly<Record<string, unknown>>;
  readonly surface: string;
  /** The operation's 2xx roots by kind — the root's own measurement, which no key path carries. */
  readonly roots: Readonly<Record<string, number>>;
  readonly cuts: DatadogCut[];
  readonly lag: DatadogSpecLag[];
}

/** One union arm's source, and whether it accepts any keys — a record, or an array of them. */
export interface Arm {
  readonly source: string;
  readonly anyKeys: boolean;
}

/** A place declared by its source. */
export type SourceOutcome = Arm & { readonly kind: "source" };

/** A place left unread, the cut landing on its nearest named field. */
export interface CutOutcome {
  readonly kind: "cut";
  readonly reason: DatadogCutReason;
}

/** A place's outcome: its schema source, a cut its nearest named field takes, or never measured. */
export type Outcome = SourceOutcome | CutOutcome | { readonly kind: "unmeasured" };

/** One place in the answer: the specification nodes meeting there, and the structure measured around it. */
export interface Place {
  readonly ctx: Context;
  readonly structure: ResponseStructure;
  readonly nodes: readonly DatadogSpecNode[];
  readonly path: string;
}

/** A declared view, the one `datadogSpecView` answers when nothing forces a cut. */
export type DeclaredView = Extract<DatadogSpecView, { kind: "declared" }>;

/** The scalar kinds, in the order a union lists them. */
export const SCALARS: readonly (readonly ["boolean" | "number" | "string", string])[] = [
  ["boolean", "z.boolean()"],
  ["number", "z.number()"],
  ["string", "z.string()"],
];

/**
 * A key as an object-literal property name.
 *
 * @returns the key bare when it is an identifier, quoted otherwise
 */
export function propertyName({ key }: { key: string }): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

/**
 * Join a path and one of its keys.
 *
 * @returns the key's own path, the key alone under the root
 */
export function childPath({ parent, key }: { parent: string; key: string }): string {
  return parent === "" ? key : `${parent}.${key}`;
}

/**
 * The JSON kinds measured at one place, the root's read from its root tally.
 *
 * @returns the kinds, or `null` when the place was never measured
 */
export function measuredKinds({ place }: { place: Place }): readonly ResponseJsonKind[] | null {
  const { ctx, structure, path } = place;
  const counts = path === "" ? ctx.roots : ownCensusEntry({ key: path, record: structure.paths })?.kinds;
  if (counts === undefined) {
    return null;
  }
  const kinds = Object.keys(counts).filter(
    (kind): kind is ResponseJsonKind => kind !== "empty-text" && kind !== "non-json",
  );
  return kinds.length === 0 ? null : kinds;
}

/**
 * The kinds the specification declares at one place, a map counted as an object.
 *
 * @returns every JSON kind the view admits
 */
function specKinds({ view }: { view: DeclaredView }): ReadonlySet<ResponseJsonKind> {
  const kinds = new Set<ResponseJsonKind>(view.primitives);
  if (view.object !== null || view.map !== null) {
    kinds.add("object");
  }
  if (view.array !== null) {
    kinds.add("array");
  }
  if (view.nullable) {
    kinds.add("null");
  }
  return kinds;
}

/**
 * How many levels below the root generation descends before it refuses: four times the deepest place the census
 * records (15 levels, at `v1-notebooks-list-notebooks`), and far inside what the call stack holds. Repro: the
 * generator prints the deepest census path, `yarn tsx tools/generateDatadogResponseBoundaries.ts <spec-dir>
 * <census.json>`.
 */
const MAX_DEPTH = 64;

/**
 * A place's depth in levels: each field, array's items and map's values one below its parent.
 *
 * @returns zero at the root
 */
export function datadogPlaceDepth({ path }: { path: string }): number {
  const keys = path.split(".").filter((segment) => segment.replace(/(\[\])+$/, "") !== "").length;
  return keys + path.split("[]").length - 1;
}

/**
 * The specification's view at one place, refused rather than read past {@link MAX_DEPTH}.
 *
 * @returns the merged view or its cut; or a `SPEC_UNREADABLE` refusal naming the place
 */
export function placeView({ place }: { place: Place }): Result<DatadogSpecView, DatadogCodegenError> {
  const { ctx, path } = place;
  if (datadogPlaceDepth({ path }) > MAX_DEPTH) {
    const why = `a schema nested past ${String(MAX_DEPTH)} levels, deeper than this generator descends`;
    return err(DatadogCodegenErrors.specUnreadable({ path, surface: ctx.surface, why }));
  }
  const view = datadogSpecView({ document: ctx.document, nodes: place.nodes });
  return view.mapErr((error) =>
    DatadogCodegenErrors.specUnreadable({ path, surface: ctx.surface, why: error.message }),
  );
}

/**
 * The scalar kinds a declared view carries with its admitted lag.
 *
 * @returns each kind with its source, in union order
 */
export function scalarArms({
  view,
  lagKinds,
}: {
  view: DeclaredView;
  lagKinds: readonly ResponseJsonKind[];
}): typeof SCALARS {
  return SCALARS.filter(([kind]) => view.primitives.has(kind) || lagKinds.includes(kind));
}

/**
 * How many arms a declared view carries with its admitted lag: its scalars, and its array, object and map.
 *
 * @returns the arm count a union would hold
 */
export function armCountOf({ view, lagKinds }: { view: DeclaredView; lagKinds: readonly ResponseJsonKind[] }): number {
  const structured = [view.array, view.object, view.map].filter((arm) => arm !== null).length;
  return scalarArms({ lagKinds, view }).length + structured;
}

/**
 * The cut a declared view forces at its own place, decided from the specification alone before any arm is read,
 * so nothing measured below it can refuse: a free array, a free map, or an arm accepting any keys beside another.
 *
 * @param armCount how many arms the place carries, its admitted lag included
 * @returns the cut, or `null` when the place is declared; or a refusal reading an array's items
 */
export function ownCut({
  place,
  view,
  armCount,
}: {
  place: Place;
  view: DeclaredView;
  armCount: number;
}): Result<CutOutcome | null, DatadogCodegenError> {
  const free = freeCut({ view });
  if (free !== null) {
    return ok(free);
  }
  if (armCount < 2) {
    return ok(null);
  }
  const anyKeys = acceptsAnyKeys({ place, view });
  if (anyKeys.isErr()) {
    return err(anyKeys.error);
  }
  return ok(anyKeys.value ? { kind: "cut", reason: "oneof-conflict" } : null);
}

/**
 * Every measured kind the specification does not declare at one place, each admitted and recorded as lag, once
 * every cut the place's own specification and lag force is decided. A non-finite number is never lag: the caller
 * refuses it once nothing below has cut the place either.
 *
 * @param measured the kinds the census measured at the place
 * @returns the admitted lag kinds, or the cut the place's specification or lag forces; or a refusal reading items
 */
export function admittedLagKinds({
  place,
  view,
  measured,
}: {
  place: Place;
  view: DeclaredView;
  measured: readonly ResponseJsonKind[];
}): Result<readonly ResponseJsonKind[] | CutOutcome, DatadogCodegenError> {
  const { ctx, path } = place;
  // A cut the specification alone forces is the place's own, whatever was measured there.
  const own = ownCut({ armCount: armCountOf({ lagKinds: [], view }), place, view });
  if (own.isErr()) {
    return err(own.error);
  }
  if (own.value !== null) {
    return ok(own.value);
  }
  const declared = specKinds({ view });
  const admitted = measured.filter((each) => !declared.has(each) && each !== "non-finite");
  // Structure the specification says nothing of is cut first: nothing in a cut is read, a non-finite number included.
  if (admitted.includes("object") || admitted.includes("array")) {
    return ok({ kind: "cut", reason: "unspecified" });
  }
  // Admitted scalar lag can add the arm an any-keys arm then conflicts with.
  const cut = ownCut({ armCount: armCountOf({ lagKinds: admitted, view }), place, view });
  if (cut.isErr()) {
    return err(cut.error);
  }
  if (cut.value !== null) {
    return ok(cut.value);
  }
  ctx.lag.push(...admitted.map((kind) => ({ lag: kind, path })));
  return ok(admitted);
}

/** The cut a declared view's own arms force with nothing measured consulted: a free array or a free map. */
function freeCut({ view }: { view: DeclaredView }): CutOutcome | null {
  if (view.array?.free === true) {
    return { kind: "cut", reason: "free" };
  }
  if (view.map?.free === true) {
    return { kind: "cut", reason: "unbuildable-map" };
  }
  return null;
}

/** Whether a declared view's arms accept any keys — a map, or an array whose items, however deep, are one. */
function acceptsAnyKeys({ place, view }: { place: Place; view: DeclaredView }): Result<boolean, DatadogCodegenError> {
  if (view.map !== null) {
    return ok(true);
  }
  if (view.array === null) {
    return ok(false);
  }
  const itemsPlace: Place = { ...place, nodes: view.array.items, path: `${place.path}[]` };
  const items = placeView({ place: itemsPlace });
  if (items.isErr()) {
    return err(items.error);
  }
  if (items.value.kind === "cut") {
    return ok(false);
  }
  return acceptsAnyKeys({ place: itemsPlace, view: items.value });
}

/**
 * Run one place's builder, and when the place turns out cut, forget every lag and cut recorded inside it: nothing at
 * or below a cut is read, so none of it describes the boundary. The place's own cut is recorded by its field after.
 *
 * @param build the reading of the place, which may record lag and cuts below it as it descends
 * @returns what the builder answered, unchanged
 */
export function unreadIfCut({
  ctx,
  build,
}: {
  ctx: Context;
  build: () => Result<Outcome, DatadogCodegenError>;
}): Result<Outcome, DatadogCodegenError> {
  const lag = ctx.lag.length;
  const cuts = ctx.cuts.length;
  const outcome = build();
  if (outcome.isOk() && outcome.value.kind === "cut") {
    ctx.lag.length = lag;
    ctx.cuts.length = cuts;
  }
  return outcome;
}

/**
 * A position's outcome, which is never `unmeasured`, so one here is a defect, thrown.
 *
 * @returns the outcome, narrowed to a source or a cut
 */
export function sourced({ outcome }: { outcome: Outcome }): SourceOutcome | CutOutcome {
  if (outcome.kind === "unmeasured") {
    throw new Error("a position answered unmeasured where a source or a cut was owed");
  }
  return outcome;
}

/**
 * One union of arms, `.nullable()` when null is one, `z.null()` when it is the only one; nothing at all is free.
 *
 * @returns the union's source, or a `free` cut for no arm and no null
 */
export function withNull({ arms, nullable }: { arms: readonly Arm[]; nullable: boolean }): SourceOutcome | CutOutcome {
  const [only] = arms;
  if (only === undefined) {
    return nullable ? { anyKeys: false, kind: "source", source: "z.null()" } : { kind: "cut", reason: "free" };
  }
  const union = arms.length === 1 ? only.source : `z.union([${arms.map((arm) => arm.source).join(", ")}])`;
  const anyKeys = arms.some((arm) => arm.anyKeys);
  return { anyKeys, kind: "source", source: nullable ? `${union}.nullable()` : union };
}
