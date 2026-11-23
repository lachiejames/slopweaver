/*
 * The appearance boot script run against fake storage: `boot` executes the real script in a fresh VM context and
 * returns what it put on `<html>` and what it left in each storage.
 */

import { runInNewContext } from "node:vm";

import { appearanceBootScript } from "../../../lib/theme";

/**
 * A `Storage` stand-in over a plain record: `throws` fails every call, as a blocked storage does; `read-only`
 * reads but fails every write, as a full quota does. A key in `unreadable` fails its own read and no other.
 */
function fakeStorage({
  entries,
  behaviour,
  unreadable,
}: {
  entries: Record<string, string>;
  behaviour: "works" | "throws" | "read-only";
  unreadable: readonly string[];
}): Pick<Storage, "getItem" | "removeItem" | "setItem"> {
  const fail = (): never => {
    throw new Error("storage unavailable");
  };
  return {
    getItem: (key) => {
      if (behaviour === "throws" || unreadable.includes(key)) {
        return fail();
      }
      if (Object.hasOwn(entries, key)) {
        return entries[key];
      }
      return null;
    },
    removeItem: (key) => {
      if (behaviour !== "works") {
        fail();
      }
      delete entries[key];
    },
    setItem: (key, value) => {
      if (behaviour !== "works") {
        fail();
      }
      entries[key] = value;
    },
  };
}

/** Which way a fake storage misbehaves, from the two flags a boot case names. */
function behaviourOf({ throws, readOnly }: { throws: boolean; readOnly: boolean }): "works" | "throws" | "read-only" {
  if (throws) {
    return "throws";
  }
  if (readOnly) {
    return "read-only";
  }
  return "works";
}

/**
 * Run the boot script against fake storage and a query string; return what it put on `<html>`.
 *
 * @returns the attributes and inline properties it set on `<html>`, and each storage as it was left
 */
export function boot({
  local = {},
  session = {},
  search = "",
  localThrows = false,
  localReadOnly = false,
  sessionThrows = false,
  unreadable = [],
  attributes = {},
}: {
  local?: Record<string, string>;
  session?: Record<string, string>;
  search?: string;
  localThrows?: boolean;
  localReadOnly?: boolean;
  sessionThrows?: boolean;
  unreadable?: readonly string[];
  attributes?: Record<string, string>;
}): {
  readonly attributes: Record<string, string>;
  /** Every inline custom property it set on `<html>`: none, since no surface reads one. */
  readonly properties: Record<string, string>;
  readonly local: Record<string, string>;
  readonly session: Record<string, string>;
} {
  const properties: Record<string, string> = {};
  const style: Pick<CSSStyleDeclaration, "setProperty"> = {
    setProperty: (name, value) => {
      properties[name] = String(value);
    },
  };
  const documentElement: Pick<Element, "setAttribute"> & { style: typeof style } = {
    setAttribute: (name, value) => {
      attributes[name] = value;
    },
    style,
  };
  const localStorage = fakeStorage({
    behaviour: behaviourOf({ readOnly: localReadOnly, throws: localThrows }),
    entries: local,
    unreadable,
  });
  const sessionStorage = fakeStorage({
    behaviour: behaviourOf({ readOnly: false, throws: sessionThrows }),
    entries: session,
    unreadable: [],
  });
  runInNewContext(appearanceBootScript(), {
    URLSearchParams,
    document: { documentElement },
    localStorage,
    location: { search },
    sessionStorage,
  });
  return { attributes, local, properties, session };
}
