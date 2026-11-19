"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

/** A Code 128 barcode, drawn as SVG so it prints sharply. */
export function Barcode({ value, height = 34, width = 1.4 }: { value: string; height?: number; width?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current) {
      JsBarcode(ref.current, value, { format: "CODE128", height, width, margin: 0, displayValue: false });
    }
  }, [value, height, width]);
  return <svg ref={ref} role="img" aria-label={`Barcode ${value}`} />;
}
