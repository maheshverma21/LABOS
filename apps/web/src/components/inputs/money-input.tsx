"use client";

import { paiseToRupees, rupeesToPaise } from "@lms/shared";
import { InputGroup, InputGroupAddon, InputGroupText } from "@/components/ui/input-group";
import { NumberInput } from "./number-input";

type Props = Omit<React.ComponentProps<typeof NumberInput>, "value" | "onChange"> & {
  /** Amount in paise, or null for "not set". */
  value: number | null | undefined;
  onChange: (paise: number | null) => void;
};

/** Shows and edits rupees; reads and writes paise. */
export function MoneyInput({ value, onChange, className, ...props }: Props) {
  return (
    <InputGroup className={className}>
      <InputGroupAddon>
        <InputGroupText>₹</InputGroupText>
      </InputGroupAddon>
      <NumberInput
        {...props}
        data-slot="input-group-control"
        className="flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
        value={value == null ? null : paiseToRupees(value)}
        onChange={(rupees) => onChange(rupees == null ? null : rupeesToPaise(rupees))}
      />
    </InputGroup>
  );
}
