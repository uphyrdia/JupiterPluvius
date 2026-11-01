import { useEffect, useState } from "react";

/** Phones, small tablets and portrait windows get the stacked layout. Keep in sync with base.css. */
export const COMPACT_QUERY = "(max-width: 899px), (max-aspect-ratio: 1/1)";

export function useCompact(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(COMPACT_QUERY);
    const onChange = () => setCompact(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return compact;
}
