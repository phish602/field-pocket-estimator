// @ts-nocheck
/* eslint-disable */

// Gate 13G amendment: shared "is this a narrow/phone-width viewport" signal,
// so components that each need this (the header status chip, the header's
// center mark) read the exact same breakpoint instead of each keeping their
// own copy of the same resize listener.

import { useEffect, useState } from "react";

export const NARROW_VIEWPORT_BREAKPOINT_PX = 480;

export default function useIsNarrowViewport(breakpoint = NARROW_VIEWPORT_BREAKPOINT_PX) {
  const [isNarrow, setIsNarrow] = useState(
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false
  );

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);

  return isNarrow;
}
