"use client";

/**
 * A ref that always holds a render's latest value, for a callback made once that must read what is current when it
 * runs rather than what was current when it was made.
 */
import { type RefObject, useEffect, useRef } from "react";

/**
 * The latest value, as a ref updated after every render.
 *
 * @param value what this render has
 * @returns the ref
 */
export function useLatest<T>({ value }: { value: T }): RefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
