import { useLayoutEffect, useRef } from "react";

/**
 * Starts the sew-in only once the browser is really drawing frames. If it never does, as in a
 * background tab or on a struggling phone, the figures simply stay visible, unanimated.
 */
export function useSewIn<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (ref.current) ref.current.dataset.sew = "true";
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return ref;
}
