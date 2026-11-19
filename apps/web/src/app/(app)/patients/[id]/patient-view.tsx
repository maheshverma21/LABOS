"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeftIcon, ClipboardListIcon, PencilIcon, PlusIcon } from "lucide-react";
import {
  formatINR,
  formatAbhaNumber,
  formatMobile,
  patientDisplayName,
  SEX_LABEL,
  type PatientDetail,
} from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/app-shell/page-header";
import { useAuth } from "@/providers/auth-provider";
import { APP_NAME } from "@/lib/brand";
import { ageSex, formatDate, usePatient } from "@/lib/patients";
import { useOrders } from "@/lib/orders";
import { PaymentStatusBadge } from "@/components/payment-status-badge";
import { PatientForm } from "../_components/patient-form";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function PatientOrders({ patientId }: { patientId: string }) {
  const { can } = useAuth();
  const { data, isPending } = useOrders({ patientId, pageSize: 50 }, can("orders:read"));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders</CardTitle>
        <CardDescription>Every visit, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : !data?.orders.length ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ClipboardListIcon className="size-4" /> No orders yet.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {data.orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted">
                  <span className="w-28 font-mono text-xs">{o.orderNo}</span>
                  <span className="flex-1 text-muted-foreground">
                    {formatDate(o.createdAt)} · {o.testCount} {o.testCount === 1 ? "test" : "tests"}
                    {o.doctor && ` · ${o.doctor.name}`}
                  </span>
                  <span className="tabular-nums">{formatINR(o.netPaise)}</span>
                  <PaymentStatusBadge status={o.paymentStatus} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PatientDetails({ p }: { p: PatientDetail }) {
  const address = [p.address, p.city, p.pincode].filter(Boolean).join(", ");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Sex">{SEX_LABEL[p.sex]}</Detail>
          <Detail label={p.dobEstimated ? "Date of birth (estimated from age)" : "Date of birth"}>
            {formatDate(p.dob)}
          </Detail>
          <Detail label="Mobile">{p.phone && formatMobile(p.phone)}</Detail>
          <Detail label="Other mobile">{p.altPhone && formatMobile(p.altPhone)}</Detail>
          <Detail label="Email">{p.email}</Detail>
          <Detail label="Address">{address}</Detail>
          <Detail label="ABHA number">{p.abhaNumber && formatAbhaNumber(p.abhaNumber)}</Detail>
          <Detail label="ABHA address">{p.abhaAddress}</Detail>
          <Detail label="Registered">
            {formatDate(p.createdAt)}
            {p.registeredBranch && ` at ${p.registeredBranch.name}`}
          </Detail>
          {p.notes && (
            <div className="sm:col-span-2 lg:col-span-3">
              <Detail label="Notes">{p.notes}</Detail>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

export function PatientView({ id }: { id: string }) {
  const { can } = useAuth();
  const { data: p, isPending, error } = usePatient(id);
  const [editing, setEditing] = useState(false);

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <PageHeader
        title="Patient not found"
        description={error.message}
        actions={
          <Button variant="outline" asChild>
            <Link href="/patients">Back to patients</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <title>{`${patientDisplayName(p)} (${p.uhid}) · ${APP_NAME}`}</title>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/patients" aria-label="Back to patients">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{patientDisplayName(p)}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary" className="font-mono">
              {p.uhid}
            </Badge>
            <span>{ageSex(p)}</span>
            {p.phone && <span>· {formatMobile(p.phone)}</span>}
          </p>
        </div>
        {!editing && can("patients:write") && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <PencilIcon /> Edit details
          </Button>
        )}
        {!editing && can("orders:write") && (
          <Button asChild>
            <Link href={`/orders/new?patientId=${p.id}`}>
              <PlusIcon /> New order
            </Link>
          </Button>
        )}
      </div>

      {editing ? (
        <div className="max-w-3xl">
          <PatientForm
            key={p.updatedAt}
            patient={p}
            onSaved={() => {
              toast.success("Saved");
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <>
          <PatientDetails p={p} />
          <PatientOrders patientId={p.id} />
        </>
      )}
    </>
  );
}
