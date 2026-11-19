"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

type Props = Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type" | "defaultValue"> & {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  /** Allow a minus sign. */
  allowNegative?: boolean;
};

const toText = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "" : String(v));

function parse(text: string): number | null {
  const n = Number(text);
  return text.trim() === "" || text === "-" || text === "." || !Number.isFinite(n) ? null : n;
}

/**
 * A text box for numbers that emits number | null. It keeps the typed text
 * (so "1." or "0.0" can be typed) and ignores keystrokes that aren't numeric.
 */
export function NumberInput({ value, onChange, allowNegative = false, ...props }: Props) {
  const [text, setText] = useState(toText(value));
  const [prevValue, setPrevValue] = useState(value);

  // The form changed the value (e.g. a reset): show the new value.
  if (value !== prevValue) {
    setPrevValue(value);
    if (parse(text) !== value) setText(toText(value));
  }

  const pattern = allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/;

  return (
    <Input
      {...props}
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onChange={(e) => {
        // "0" + typing "5" should read "5", not "05".
        const next = e.target.value.replace(",", ".").replace(/^(-?)0+(?=\d)/, "$1");
        if (!pattern.test(next)) return;
        setText(next);
        const n = parse(next);
        setPrevValue(n);
        onChange(n);
      }}
    />
  );
}
