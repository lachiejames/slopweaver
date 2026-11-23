/**
 * Turn one admitted Datadog operation's pinned specification and its census (`responseCensus.ts`) into the
 * TypeScript source of its strict response boundary (`responseBoundary.ts`). Pure:
 * `tools/generateDatadogResponseBoundaries.ts` reads and writes, and every rule about what is declared lives here.
 *
 * ## The specification is the structure, the census checks it
 *
 * Object and array shape come only from the specification (`responseSpec.ts`), never from what one organisation
 * happened to send. The census decides three things and nothing else:
 *
 * - **Whether a place was measured.** A field no answer reached is declared by NAME only, `z.unknown()`, so its
 *   value is never read on a guess (a name `defineBoundary` refuses outright excepted: § Cuts). An unmeasured
 *   place no name holds — the root, an array's items, a map's values — keeps the specification's kinds with every
 *   object field so declared.
 * - **Requiredness.** A field is required exactly when every merged object arm requires it AND it was present on
 *   every object measured at its parent. Disagreement never refuses: either side permitting absence wins.
 * - **Lag.** A measured kind or key the specification does not declare there is ADMITTED, since the live answer is
 *   the evidence and the specification is behind it, and every one is returned as a lag observation the
 *   generator lists in the inventory, `DATADOG_RESPONSE_SPEC_LAG`. A lagged key is optional and declares its
 *   measured scalars — when the census recorded it as itself. One it recorded only under a placeholder (`<int>`,
 *   `<uuid>`, `<unsafe>`) has no name a strict field could carry, so it refuses, `UNDECLARABLE`, rather than being
 *   admitted. A lag of `object` or `array` has no specification structure under it, so its field is cut
 *   `unspecified`, which the cut inventory lists in place of the lag — unless the specification alone already cuts
 *   that place (`free`, `unbuildable-map`, `oneof-conflict`), which is decided first and is the reason listed. A
 *   lagged scalar where the specification declares a map is admitted as an arm beside that map, and a record arm
 *   beside any other is `oneof-conflict` (the merge table, `responseSpec.ts`), so that place too is cut and listed
 *   as a cut in place of its lag. The inventory's diff is where a person sees lag arrive; it records no review.
 *
 * ## Cuts
 *
 * A place the boundary layer cannot hold strictly is a CUT (`DatadogCutReason`): its nearest named field is
 * declared `z.unknown()` and recorded in the inventory. A cut reaching the root has no field to land on and
 * refuses, `UNCUTTABLE`. Nothing at or below a cut is read: its kinds are never compared with the specification, so
 * it records no lag (the cut inventory already lists it as unread), and an `<unsafe>` key or a non-finite number
 * there is ignored. Anywhere declared, either refuses, `UNDECLARABLE`, since the boundary would refuse its own
 * evidence. So does a measured object's field the specification names the way the census never records a key as
 * itself (`<unsafe>`, a uuid): its placeholder counts other keys, so nothing measured that field. A field named
 * like an `Object.prototype` member (`constructor`, `toString`) refuses `UNDECLARABLE` wherever its object is
 * declared, measured or not: `defineBoundary` refuses the name itself, so not even a name-only field can hold it.
 * A declared root whose census counted a 2xx answer that was empty or not JSON refuses `UNDECLARABLE` too, since
 * a JSON boundary refuses that answer.
 *
 * ## A specification this cannot read
 *
 * A measured place whose specification cannot be read — a reference resolving to nothing, or to anything but one
 * whole component (`#/components/<kind>/<name>`: a pointer into a component's insides is refused too), a reference
 * carrying a keyword beside it that is not annotation (OpenAPI 3.0 ignores every sibling of a `$ref`, so an
 * annotation there — `default`, `deprecated`, `description`, `example`, `examples`, `externalDocs`, `nullable`,
 * `readOnly`, `title`, `writeOnly`, `xml` or an `x-` extension — is ignored and anything else refused), an `allOf`,
 * a `oneOf` beside an `anyOf`, a `oneOf`/`anyOf` that is not a list, one carrying `properties`, `required`,
 * `additionalProperties` or `items` beside its arms (a merge into every arm, as an `allOf` would need) or a `type`
 * excluding a kind one of its arms declares (a narrowing; a `type` its arms all sit within adds nothing), a node that
 * is not an object, or one whose `properties`, `required`, `additionalProperties` or `items` is not of the JSON type
 * it is read as (an `items: false` included) — refuses, `SPEC_UNREADABLE`, naming the place. So does a document or
 * schema that contains itself other than by a `$ref`, before anything is read, since no walk of it ends, and a place
 * nested deeper than generation descends (`MAX_DEPTH`, `responseCodegenPlace.ts`) or whose `oneOf`/`anyOf` arms
 * nest deeper than it expands or expand to more arms than it merges (null is no arm, so never counted) or visit
 * more schemas than it expands (null-only ones included), shared YAML aliases counted once per path
 * (`responseSpec.ts`). Which schema is the operation's is decided before any of this, by `datadogResponseDeclaration` (`responseDeclaration.ts`), whose own
 * refusals (an operation the specification does not declare, no 2xx content, two JSON media entries across the 2xx
 * answers, under two codes or one, declaring different schemas) are its own to name.
 *
 * One unmeasured place is read: an array arm beside another arm has its items' specification read, however deep,
 * measured or not, because only that says whether the array holds maps and so whether its own place is a
 * `oneof-conflict` cut. That read is of the specification alone, before the place's own cut is decided and before
 * anything measured below it, and an item specification it cannot read refuses there as above.
 *
 * ## Where each part lives
 *
 * This file is the walk that descends from the root. What one place reads without descending is
 * `responseCodegenPlace.ts`; the field lines, lag fields and folded map values are `responseCodegenFields.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";

import {
  isPrototypeName,
  ownCensusEntry,
  type ResponseJsonKind,
  type ResponseStructure,
  responseCensusKey,
} from "../kit/responseStructure.js";

import type { DatadogOperationCensus } from "./responseCensus.js";
import { type DatadogCodegenError, DatadogCodegenErrors } from "./responseCodegenErrors.js";
import { fieldLine, foldedMapValues, lagFields, MAP_VALUE } from "./responseCodegenFields.js";
import {
  type Arm,
  admittedLagKinds,
  armCountOf,
  type Context,
  type CutOutcome,
  childPath,
  type DatadogCut,
  type DatadogSpecLag,
  type DeclaredView,
  measuredKinds,
  type Outcome,
  ownCut,
  type Place,
  placeView,
  propertyName,
  scalarArms,
  sourced,
  unreadIfCut,
  withNull,
} from "./responseCodegenPlace.js";
import { type DatadogSpecNode, datadogSpecCyclic } from "./responseSpecNode.js";

/** One operation's generated boundary. */
export interface DatadogGeneratedBoundary {
  /** The `defineDatadogResponseBoundary` call, as source. */
  readonly source: string;
  readonly cuts: readonly DatadogCut[];
  /** Every lag the boundary admits, in the order generation met it. */
  readonly lag: readonly DatadogSpecLag[];
  readonly measured: boolean;
}

/**
 * One place's outcome where a name holds it: a cut, never measured, or the source the specification declares
 * with the census checking it.
 */
function placeOutcome({ place }: { place: Place }): Result<Outcome, DatadogCodegenError> {
  return unreadIfCut({ build: () => readPlace({ place }), ctx: place.ctx });
}

/** {@link placeOutcome}'s reading, before a cut it ends in forgets what it recorded. */
function readPlace({ place }: { place: Place }): Result<Outcome, DatadogCodegenError> {
  const { ctx, path } = place;
  // Unmeasured, a place is declared without reading its specification, so nothing there can refuse or be cut.
  const measured = measuredKinds({ place });
  if (measured === null) {
    return ok({ kind: "unmeasured" });
  }
  const view = placeView({ place });
  if (view.isErr()) {
    return err(view.error);
  }
  if (view.value.kind === "cut") {
    return ok({ kind: "cut", reason: view.value.reason });
  }
  const lag = admittedLagKinds({ measured, place, view: view.value });
  if (lag.isErr()) {
    return err(lag.error);
  }
  if ("kind" in lag.value) {
    return ok(lag.value);
  }
  const outcome = declaredOutcome({ lagKinds: lag.value, place, view: view.value });
  // A cut an arm forces outward leaves the place unread, a non-finite number included; declared, no schema admits one.
  if (outcome.isErr() || outcome.value.kind === "cut" || !measured.includes("non-finite")) {
    return outcome;
  }
  const why = "a number too large for JSON to read back, which no number schema admits";
  return err(DatadogCodegenErrors.undeclarable({ path, surface: ctx.surface, why }));
}

/**
 * One place's outcome where no name holds it — the root, an array's items, a map's values. Unmeasured, it keeps
 * the specification's kinds with every object field declared by name only, since `z.unknown()` is legal only as
 * a field.
 */
function positionOutcome({ place }: { place: Place }): Result<Outcome, DatadogCodegenError> {
  return unreadIfCut({ build: () => readPosition({ place }), ctx: place.ctx });
}

/** {@link positionOutcome}'s reading, before a cut it ends in forgets what it recorded. */
function readPosition({ place }: { place: Place }): Result<Outcome, DatadogCodegenError> {
  const outcome = placeOutcome({ place });
  if (outcome.isErr() || outcome.value.kind !== "unmeasured") {
    return outcome;
  }
  const view = placeView({ place });
  if (view.isErr()) {
    return err(view.error);
  }
  if (view.value.kind === "cut") {
    return ok({ kind: "cut", reason: view.value.reason });
  }
  return declaredOutcome({ lagKinds: [], place, view: view.value });
}

/**
 * The source a declared view emits: its array, scalar, object or map arms, `.nullable()` when null is one. An arm
 * accepting any keys — the merged map, or an array of maps — beside an arm of another kind is a cut, since
 * `defineBoundary` refuses a union no failed read could attribute. Map arms merge into one map first
 * (`responseSpec.ts`), as object and array arms do, so two maps are one arm.
 */
function declaredOutcome({
  place,
  view,
  lagKinds,
}: {
  place: Place;
  view: DeclaredView;
  lagKinds: readonly ResponseJsonKind[];
}): Result<Outcome, DatadogCodegenError> {
  const scalars = scalarArms({ lagKinds, view });
  const cut = ownCut({ armCount: armCountOf({ lagKinds, view }), place, view });
  if (cut.isErr()) {
    return err(cut.error);
  }
  if (cut.value !== null) {
    return ok(cut.value);
  }
  const structured = structuredArms({ place, view });
  if (structured.isErr()) {
    return err(structured.error);
  }
  if ("kind" in structured.value) {
    return ok(structured.value);
  }
  const arms: Arm[] = [...structured.value, ...scalars.map(([, source]) => ({ anyKeys: false, source }))];
  const nullable = view.nullable || lagKinds.includes("null");
  return ok(withNull({ arms, nullable }));
}

/** The array, object or map arm a declared view carries, or the cut one of them forces outward. */
function structuredArms({
  place,
  view,
}: {
  place: Place;
  view: DeclaredView;
}): Result<readonly Arm[] | CutOutcome, DatadogCodegenError> {
  // Read in order and only on demand, so a cut stops the walk before a later arm records anything.
  const { array, object, map } = view;
  const readers: (() => Result<Arm | CutOutcome, DatadogCodegenError>)[] = [];
  if (array !== null) {
    readers.push(() => arrayArm({ array, place }));
  }
  if (object !== null) {
    readers.push(() => objectArm({ object, place }));
  }
  if (map !== null) {
    readers.push(() => mapArm({ map, place }));
  }
  const arms: Arm[] = [];
  for (const read of readers) {
    const arm = read();
    if (arm.isErr()) {
      return err(arm.error);
    }
    if ("kind" in arm.value) {
      return ok(arm.value);
    }
    arms.push(arm.value);
  }
  return ok(arms);
}

/** The array arm at one place, its items read one position down, or the cut a free array or its items force. */
function arrayArm({
  place,
  array,
}: {
  place: Place;
  array: NonNullable<DeclaredView["array"]>;
}): Result<Arm | CutOutcome, DatadogCodegenError> {
  if (array.free) {
    return ok({ kind: "cut", reason: "free" });
  }
  const items = positionOutcome({ place: { ...place, nodes: array.items, path: `${place.path}[]` } });
  if (items.isErr()) {
    return err(items.error);
  }
  const item = sourced({ outcome: items.value });
  if (item.kind === "cut") {
    return ok(item);
  }
  return ok({ anyKeys: item.anyKeys, source: `z.array(${item.source})` });
}

/**
 * The object arm at one place: every field the specification declares, required as measured, and every key the
 * census measured beyond them admitted as lag. An object never measured here declares its names only.
 */
function objectArm({
  place,
  object,
}: {
  place: Place;
  object: NonNullable<DeclaredView["object"]>;
}): Result<Arm, DatadogCodegenError> {
  const { ctx, structure, path } = place;
  const objects = ownCensusEntry({ key: path, record: structure.objects });
  const fields: (readonly [string, string])[] = [];
  for (const [key, nodes] of object.properties) {
    if (isPrototypeName({ name: key })) {
      const why = `the field ${key} is named like an Object.prototype member, which defineBoundary refuses`;
      return err(DatadogCodegenErrors.undeclarable({ path, surface: ctx.surface, why }));
    }
    const child = childPath({ key, parent: path });
    if (objects === undefined) {
      fields.push([key, `${propertyName({ key })}: z.unknown().optional()`]);
      continue;
    }
    if (key === "<unsafe>" || responseCensusKey({ key }) !== key) {
      // The census counts such a key under a placeholder it shares with every key of that shape, never as itself.
      const why = `the field ${key} is a key the census records only under a placeholder, so nothing measured it`;
      return err(DatadogCodegenErrors.undeclarable({ path: child, surface: ctx.surface, why }));
    }
    const outcome = placeOutcome({ place: { ...place, nodes, path: child } });
    if (outcome.isErr()) {
      return err(outcome.error);
    }
    const present = ownCensusEntry({ key: child, record: structure.paths })?.present;
    // A census file is parsed, not trusted to be this module's own output, so a zero count requires nothing.
    const required = object.required.has(key) && objects > 0 && present === objects;
    fields.push([key, fieldLine({ child, ctx, key, outcome: outcome.value, required })]);
  }
  const lagged = objects === undefined ? ok([]) : lagFields({ declared: object.properties, place });
  if (lagged.isErr()) {
    return err(lagged.error);
  }
  const all = [...fields, ...lagged.value].toSorted(([a], [b]) => (a < b ? -1 : 1)).map(([, line]) => line);
  return ok({ anyKeys: false, source: `z.strictObject({ ${all.join(", ")} })` });
}

/**
 * The map arm at one place: a record keyed by any string, its values declared from the specification and checked
 * against every value measured under any key. A map whose values the specification leaves free cannot be held
 * strictly, so it is cut.
 */
function mapArm({
  place,
  map,
}: {
  place: Place;
  map: NonNullable<DeclaredView["map"]>;
}): Result<Arm | CutOutcome, DatadogCodegenError> {
  if (map.free) {
    return ok({ kind: "cut", reason: "unbuildable-map" });
  }
  const structure = foldedMapValues({ path: place.path, structure: place.structure });
  const valuePath = childPath({ key: MAP_VALUE, parent: place.path });
  const values = positionOutcome({ place: { ...place, nodes: map.values, path: valuePath, structure } });
  if (values.isErr()) {
    return err(values.error);
  }
  const value = sourced({ outcome: values.value });
  if (value.kind === "cut") {
    return ok(value);
  }
  return ok({ anyKeys: true, source: `z.record(z.string(), ${value.source})` });
}

/**
 * The source of one admitted operation's strict response boundary: the specification's structure at every place
 * its census measured, names only where it measured nothing, and every place the layer cannot hold cut and
 * listed.
 *
 * @param document the pinned specification the operation is declared in, for resolving references
 * @param surface the registry operation's name
 * @param schema the operation's 2xx JSON schema (`datadogResponseDeclaration`)
 * @param census the operation's tally from the one census run, or `null` when it never answered 2xx
 * @returns the boundary's source, its cuts and the lag it admitted; or the first refusal, naming its path
 */
export function datadogBoundarySource({
  document,
  surface,
  schema,
  census,
}: {
  document: Readonly<Record<string, unknown>>;
  surface: string;
  schema: DatadogSpecNode;
  census: DatadogOperationCensus | null;
}): Result<DatadogGeneratedBoundary, DatadogCodegenError> {
  if (datadogSpecCyclic({ value: document }) || datadogSpecCyclic({ value: schema.node })) {
    const why = "a schema that contains itself other than by a $ref, which no walk of it ends";
    return err(DatadogCodegenErrors.specUnreadable({ path: "", surface, why }));
  }
  const ctx: Context = {
    cuts: [],
    document,
    lag: [],
    roots: census === null ? {} : census.roots,
    surface,
  };
  const structure: ResponseStructure =
    census === null ? { objects: {}, paths: {} } : { objects: census.objects, paths: census.paths };
  const root: Place = { ctx, nodes: [schema], path: "", structure };
  const outcome = positionOutcome({ place: root });
  if (outcome.isErr()) {
    return err(outcome.error);
  }
  const declared = sourced({ outcome: outcome.value });
  if (declared.kind === "cut") {
    return err(DatadogCodegenErrors.uncuttable({ path: "", reason: declared.reason, surface }));
  }
  // Only a root declared rather than cut reads its measured roots, as everywhere a cut leaves nothing read.
  const unreadable = ["empty-text", "non-json"].filter(
    (each) => ownCensusEntry({ key: each, record: ctx.roots }) !== undefined,
  );
  if (unreadable.length > 0) {
    const why = `a 2xx answer measured as ${unreadable.join(" and ")}, which a JSON boundary refuses`;
    return err(DatadogCodegenErrors.undeclarable({ path: "", surface, why }));
  }
  const measured = measuredKinds({ place: root }) !== null;
  const source = `defineDatadogResponseBoundary({ schema: ${declared.source}, source: "${measured ? "measured" : "spec-names-only"}", surface: ${JSON.stringify(surface)} })`;
  return ok({ cuts: ctx.cuts, lag: ctx.lag, measured, source });
}
