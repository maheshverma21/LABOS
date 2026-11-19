"use client";

import { useDeferredValue, useState } from "react";
import { SearchIcon } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { DateRangeInput } from "@/components/filters/date-range-input";
import { useDateRange } from "@/components/b2b/use-range";
import { usePortalOrders } from "@/lib/portal";
import { OrdersTable } from "./orders-table";

export default function PortalOrders() {
  const range = useDateRange(29);
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const { data, isPending } = usePortalOrders(range.from, range.to, q);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Orders &amp; reports</h1>
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeInput from={range.from} to={range.to} onChange={range.set} />
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput placeholder="Order no., patient name or ID" aria-label="Search orders" value={search} onChange={(e) => setSearch(e.target.value)} />
        </InputGroup>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <OrdersTable orders={data ?? []} loading={isPending} />
      </div>
      {data && data.length >= 300 && <p className="text-sm text-muted-foreground">Showing the latest 300 orders. Narrow the dates to see others.</p>}
    </>
  );
}
