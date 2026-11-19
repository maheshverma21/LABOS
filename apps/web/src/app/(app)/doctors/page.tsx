"use client";

import { useDeferredValue, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PencilIcon, PlusIcon, SearchIcon } from "lucide-react";
import { formatMobile, type DoctorItem } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DoctorPriceListDialog } from "@/components/doctors/doctor-price-list-dialog";
import { DoctorDialog } from "@/components/doctors/doctor-dialog";
import { PageHeader } from "@/components/app-shell/page-header";
import { useAuth } from "@/providers/auth-provider";
import { api } from "@/lib/api";
import { APP_NAME } from "@/lib/brand";
import { useDoctors } from "@/lib/patients";

export default function DoctorsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const q = useDeferredValue(search.trim());
  const { data, isPending } = useDoctors(q, showInactive);
  // `n` changes on every open, so the dialog gets a fresh form each time.
  const [dialog, setDialog] = useState<{ open: boolean; doctor: DoctorItem | null; n: number }>({
    open: false,
    doctor: null,
    n: 0,
  });
  const openDialog = (doctor: DoctorItem | null) => setDialog((d) => ({ open: true, doctor, n: d.n + 1 }));
  const canWrite = can("patients:write");
  const [priceDoctor, setPriceDoctor] = useState<DoctorItem | null>(null);

  const toggle = useMutation({
    mutationFn: (d: DoctorItem) => api(`/doctors/${d.id}/status`, { method: "PATCH", body: { isActive: !d.isActive } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doctors"] }),
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      <title>{`Referring doctors · ${APP_NAME}`}</title>
      <PageHeader
        title="Referring doctors"
        description="Doctors who send patients to your lab."
        actions={
          canWrite && (
            <Button onClick={() => openDialog(null)}>
              <PlusIcon /> Add doctor
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Name, clinic or mobile"
            aria-label="Search doctors"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </InputGroup>
        <div className="flex items-center gap-2">
          <Checkbox id="inactive" checked={showInactive} onCheckedChange={(v) => setShowInactive(v === true)} />
          <Label htmlFor="inactive" className="font-normal">
            Show inactive
          </Label>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Doctor</TableHead>
              <TableHead className="hidden md:table-cell">Clinic</TableHead>
              <TableHead className="hidden sm:table-cell">Mobile</TableHead>
              <TableHead className="hidden sm:table-cell">Commission</TableHead>
              <TableHead className="hidden md:table-cell">Price list</TableHead>
              {canWrite && <TableHead className="w-40 text-right" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            )}
            {data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  {q ? "No doctor matches your search." : "No referring doctors yet."}
                </TableCell>
              </TableRow>
            )}
            {data?.map((d, i) => (
              <TableRow key={d.id} className={d.isActive ? undefined : "opacity-60"}>
                <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                <TableCell>
                  <div className="font-medium">
                    {d.name} {!d.isActive && <Badge variant="outline">Inactive</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[d.qualification, d.specialty].filter(Boolean).join(" · ")}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {[d.clinicName, d.city].filter(Boolean).join(", ") || "—"}
                </TableCell>
                <TableCell className="hidden sm:table-cell tabular-nums">{d.phone ? formatMobile(d.phone) : "—"}</TableCell>
                <TableCell className="hidden sm:table-cell tabular-nums">{d.commissionPercent ? `${d.commissionPercent}%` : "—"}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {canWrite ? (
                    <Button variant="outline" size="sm" onClick={() => setPriceDoctor(d)}>
                      {d.priceList ? <PencilIcon /> : <PlusIcon />} {d.priceList ? "Edit" : "Add"}
                    </Button>
                  ) : (
                    (d.priceList?.name ?? "—")
                  )}
                </TableCell>
                {canWrite && (
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openDialog(d)}>
                      <PencilIcon /> Edit
                    </Button>
                    <Button variant="ghost" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(d)}>
                      {d.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {priceDoctor && (
        <DoctorPriceListDialog key={priceDoctor.id} doctor={priceDoctor} open onOpenChange={(o) => !o && setPriceDoctor(null)} />
      )}
      <DoctorDialog
        key={dialog.n}
        doctor={dialog.doctor}
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </>
  );
}
