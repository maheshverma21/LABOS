"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import {
  computeTotals,
  formatINR,
  formatMobile,
  patientDisplayName,
  PAYMENT_MODE_LABEL,
  PAYMENT_MODES,
  type DiscountType,
  type DoctorItem,
  type OrderDetail,
  type PaymentMode,
  PRICE_LIST_TYPES,
  PRICE_LIST_TYPE_LABELS,
  type PriceListDetail,
  type PriceListType,
  type TestDetail,
} from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { MoneyInput } from "@/components/inputs/money-input";
import { NumberInput } from "@/components/inputs/number-input";
import { useAuth } from "@/providers/auth-provider";
import { api } from "@/lib/api";
import { catalogKeys, usePriceLists, useTests } from "@/lib/catalog";
import { orderKeys } from "@/lib/orders";
import { ageSex, patientKeys, useDoctors, usePatient, usePatientSearch } from "@/lib/patients";
import { cn } from "@/lib/utils";
import { barcodeMode, useRegistrationSettings } from "@/lib/registration-settings";
import { APP_NAME } from "@/lib/brand";
import { useAccounts } from "@/lib/accounts";
import { DoctorPicker } from "@/components/doctors/doctor-picker";

const BASE_RATES = "base";

// ---------------------------------------------------------------------------
// Patient
// ---------------------------------------------------------------------------

function PatientPicker({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const { data, isFetching } = usePatientSearch(q.trim(), 1, 8);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <InputGroup className="flex-1">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            autoFocus
            placeholder="Search by name, mobile or patient ID"
            aria-label="Search patients"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </InputGroup>
        <Button variant="outline" asChild>
          <Link href="/patients/new?next=order">
            <UserPlusIcon /> New patient
          </Link>
        </Button>
      </div>
      {q.trim() && (
        <ul className="divide-y rounded-lg border">
          {data?.patients.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => onPick(p.id)}
              >
                <span className="w-20 font-mono text-xs text-muted-foreground">{p.uhid}</span>
                <span className="flex-1 font-medium">{patientDisplayName(p)}</span>
                <span className="text-muted-foreground">{ageSex(p)}</span>
                <span className="hidden w-28 text-right tabular-nums text-muted-foreground sm:block">
                  {p.phone ? formatMobile(p.phone) : ""}
                </span>
              </button>
            </li>
          ))}
          {data?.patients.length === 0 && !isFetching && (
            <li className="px-3 py-3 text-sm text-muted-foreground">
              No patient found.{" "}
              <Link href="/patients/new?next=order" className="text-foreground underline underline-offset-4">
                Register them
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function SummaryRow({ k, v }: { k: string; v: string | null }) {
  if (!v) return null;
  return (
    <div>
      <p className="text-sm text-muted-foreground">{k}</p>
      <p>{v}</p>
    </div>
  );
}

function PatientSummary({ id, onChange }: { id: string; onChange: () => void }) {
  const { data: p, isPending } = usePatient(id);
  if (isPending) return <Spinner className="text-muted-foreground" />;
  if (!p) return null;
  return (
    <div className="space-y-4">
      <div className="border-b pb-2">
        <p className="font-semibold">
          {patientDisplayName(p)} ({ageSex(p)})
        </p>
        <p className="text-sm text-muted-foreground">ID: {p.uhid}</p>
      </div>
      <SummaryRow k="Contact No" v={p.phone ? `91 ${p.phone}` : null} />
      <SummaryRow k="Referral" v={p.referral} />
      <Button variant="outline" size="sm" onClick={onChange}>
        Change patient
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

interface PaymentRow {
  key: number;
  mode: PaymentMode;
  amountPaise: number | null;
  reference: string;
}


export function NewOrder({
  initialPatientId,
  initialAccountId,
}: {
  initialPatientId?: string;
  initialAccountId?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canDiscount = can("billing:discount");

  const [patientId, setPatientId] = useState<string | null>(initialPatientId ?? null);
  const [pickedDoctor, setDoctor] = useState<DoctorItem | null | undefined>(undefined);
  const [priceListId, setPriceListId] = useState(BASE_RATES);
  // Which kind of price list is being used: follows the referring doctor or the billed organisation.
  const [priceType, setPriceType] = useState<PriceListType>("DOCTOR");
  const [testIds, setTestIds] = useState<string[]>([]);
  const [testQuery, setTestQuery] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("PERCENT");
  const [discountValue, setDiscountValue] = useState<number | null>(null);
  const [discountReason, setDiscountReason] = useState("");
  const [notes, setNotes] = useState("");
  const [barcode, setBarcode] = useState("");
  const [{ integration, display }] = useRegistrationSettings();
  const barcodeShown = !display.hiddenFields.includes("barcode");
  const barcodeRequired = barcodeShown && !integration.autoGenerateBarcode && display.requiredFields.includes("barcode");
  const barcodeLabel = display.fieldLabels.barcode?.trim() || "Barcode No.";
  const [payments, setPayments] = useState<PaymentRow[]>([{ key: 0, mode: "CASH", amountPaise: null, reference: "" }]);
  // The first row (usually cash) takes whatever the other rows leave, until the cashier types in it.
  const [firstRowAuto, setFirstRowAuto] = useState(true);
  const nextKey = useRef(1);

  // Bill to a B2B account: their rates, and nothing to pay at the counter.
  const accounts = useAccounts("", false, can("accounts:read"));
  const [accountId, setAccountId] = useState<string | null>(null);
  const account = accounts.data?.find((a) => a.id === accountId) ?? null;
  const chooseAccount = (id: string | null) => {
    setAccountId(id);
    const a = accounts.data?.find((x) => x.id === id);
    setPriceListId(a?.priceList?.id ?? BASE_RATES);
    if (a) setPriceType(a.type === "HOSPITAL" ? "HOSPITAL" : "B2B");
    if (a) {
      setFirstRowAuto(false);
      // Nothing is paid at the counter: a single empty row (only shown again if the account is removed).
      setPayments([{ key: 0, mode: "CASH", amountPaise: null, reference: "" }]);
    } else {
      setFirstRowAuto(true);
    }
  };
  const [accountInit, setAccountInit] = useState(initialAccountId ?? null);
  if (accountInit && accounts.data) {
    setAccountInit(null);
    if (accounts.data.some((a) => a.id === accountInit)) chooseAccount(accountInit);
  }

  const patient = usePatient(patientId ?? "");
  // A barcode typed at registration carries over to the bill.
  useEffect(() => {
    const b = patient.data?.barcode;
    if (b) setBarcode((cur) => cur || b);
  }, [patient.data?.barcode]);
  // Until the cashier picks one, use the doctor chosen at registration.
  const allDoctors = useDoctors("").data;
  const doctor =
    pickedDoctor !== undefined
      ? pickedDoctor
      : (allDoctors?.find((d) => d.name === patient.data?.referral) ?? null);
  const tests = useTests();
  const priceLists = usePriceLists();
  const listsOfType = priceLists.data?.filter((l) => l.type === priceType || l.id === priceListId) ?? [];
  // Picking a referring doctor switches to the doctor price list, and to that doctor's own list if they have one.
  const chooseDoctor = (d: DoctorItem | null) => {
    setDoctor(d);
    if (accountId) return;
    setPriceType("DOCTOR");
    setPriceListId(d?.priceList?.id ?? BASE_RATES);
  };
  // The doctor chosen at registration (from the patient's referral) brings their price list too.
  const [syncedDoctor, setSyncedDoctor] = useState<string | null>(null);
  if (pickedDoctor === undefined && doctor && !accountId && syncedDoctor !== doctor.id) {
    setSyncedDoctor(doctor.id);
    if (doctor.priceList) {
      setPriceType("DOCTOR");
      setPriceListId(doctor.priceList.id);
    }
  }
  const priceList = useQuery({
    queryKey: catalogKeys.priceList(priceListId),
    queryFn: () => api<{ priceList: PriceListDetail }>(`/catalog/price-lists/${priceListId}`).then((r) => r.priceList),
    enabled: priceListId !== BASE_RATES,
  });

  const byId = useMemo(() => new Map((tests.data ?? []).map((t) => [t.id, t])), [tests.data]);
  const overrides = useMemo(
    () => new Map((priceListId === BASE_RATES ? [] : (priceList.data?.items ?? [])).map((i) => [i.testId, i.pricePaise])),
    [priceList.data, priceListId],
  );
  // A B2B lab's standing discount comes off the base price of tests its rates don't set.
  const labDiscount = accounts.data?.find((a) => a.id === accountId)?.discountPercent ?? 0;
  const priceOf = (id: string) => overrides.get(id) ?? Math.round(((byId.get(id)?.pricePaise ?? 0) * (100 - labDiscount)) / 100);

  // Members of the panels on this order, to stop a test being billed twice.
  const panelIds = testIds.filter((id) => byId.get(id)?.isPanel);
  const panelDetails = useQueries({
    queries: panelIds.map((id) => ({
      queryKey: catalogKeys.test(id),
      queryFn: () => api<{ test: TestDetail }>(`/catalog/tests/${id}`).then((r) => r.test),
    })),
  });
  const inPanel = new Map<string, string>();
  for (const q of panelDetails) for (const m of q.data?.panelTests ?? []) inPanel.set(m.id, q.data!.name);

  const addTest = async (id: string) => {
    const t = byId.get(id);
    if (!t) return;
    setTestQuery("");
    if (testIds.includes(id)) return;
    if (inPanel.has(id)) {
      toast.error(`${t.name} is already part of ${inPanel.get(id)}`);
      return;
    }
    if (t.isPanel) {
      const detail = await queryClient.fetchQuery({
        queryKey: catalogKeys.test(id),
        queryFn: () => api<{ test: TestDetail }>(`/catalog/tests/${id}`).then((r) => r.test),
      });
      const members = new Set(detail.panelTests.map((m) => m.id));
      const covered = testIds.filter((x) => members.has(x));
      if (covered.length) {
        toast.info(`Removed ${covered.map((x) => byId.get(x)?.code).join(", ")}: already in ${t.name}`);
      }
      setTestIds((ids) => [...ids.filter((x) => !members.has(x)), id]);
      return;
    }
    setTestIds((ids) => [...ids, id]);
  };

  const lines = testIds.map((id) => ({ id, test: byId.get(id), price: priceOf(id) }));
  const unpriced = lines.filter((l) => l.price === 0);
  const discount =
    canDiscount && discountValue
      ? { type: discountType, value: discountType === "PERCENT" ? discountValue : Math.round(discountValue) }
      : null;
  const totals = computeTotals(
    lines.map((l) => l.price),
    discount,
  );

  const totalPaise = totals.netPaise;
  const others = payments.slice(1).reduce((a, p) => a + (p.amountPaise ?? 0), 0);
  const shownPayments = firstRowAuto
    ? payments.map((p, i) => (i === 0 ? { ...p, amountPaise: Math.max(totalPaise - others, 0) || null } : p))
    : payments;
  const paidPaise = shownPayments.reduce((a, p) => a + (p.amountPaise ?? 0), 0);
  const duePaise = account ? 0 : totalPaise - paidPaise;
  // What the lab can still order: its wallet less what is on hold, plus its credit.
  const available = account && account.creditLimitPaise != null ? account.netPaise + account.creditLimitPaise : null;
  const overLimit = available != null && totalPaise > available;

  const editPayment = (key: number, patch: Partial<PaymentRow>) => {
    if (key === shownPayments[0]?.key && "amountPaise" in patch) setFirstRowAuto(false);
    setPayments(shownPayments.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  };

  const problems = [
    !patientId && "Pick a patient",
    testIds.length === 0 && "Add at least one test",
    unpriced.length > 0 && `No price for ${unpriced.map((l) => l.test?.code).join(", ")}`,
    duePaise < 0 && "Payment is more than the bill",
    discount && discountReason.trim().length < 3 && "Give a reason for the discount",
    overLimit && `${account?.name} would go over its credit limit`,
    barcodeRequired && !barcode.trim() && `Enter the ${barcodeLabel.toLowerCase()}`,
  ].filter(Boolean) as string[];

  const create = useMutation({
    mutationFn: () =>
      api<{ order: OrderDetail }>("/orders", {
        method: "POST",
        body: {
          patientId,
          doctorId: doctor?.id ?? null,
          priceListId: priceListId === BASE_RATES ? null : priceListId,
          testIds,
          discount: discount && { ...discount, reason: discountReason },
          accountId: account?.id ?? null,
          payments: (account ? [] : shownPayments)
            .filter((p) => (p.amountPaise ?? 0) > 0)
            .map((p) => ({ mode: p.mode, amountPaise: p.amountPaise, reference: p.reference || null })),
          notes: notes || null,
          barcode: barcodeShown && !integration.autoGenerateBarcode ? barcode.trim() || null : null,
          barcodeMode: barcodeMode(integration),
        },
      }),
    onSuccess: async ({ order }) => {
      await queryClient.invalidateQueries({ queryKey: orderKeys.all });
      await queryClient.invalidateQueries({ queryKey: patientKeys.all });
      toast.success(`Order ${order.orderNo} created`);
      router.push(`/orders/${order.id}?new=1`);
    },
    onError: (err) => toast.error(err.message),
  });

  const bookingTime = new Date().toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Kolkata" });
  const [source, setSource] = useState<"self" | "org" | "none">("none");
  const testSearchRef = useRef<HTMLInputElement>(null);

  const matches = (() => {
    const q = testQuery.trim().toLowerCase();
    if (!q) return [];
    const all = (tests.data ?? []).filter((t) => !testIds.includes(t.id));
    const starts = all.filter((t) => t.code.toLowerCase().startsWith(q));
    const contains = all.filter((t) => !starts.includes(t) && `${t.code} ${t.name}`.toLowerCase().includes(q));
    return [...starts, ...contains].slice(0, 8);
  })();

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <title>{`Bill Patient · ${APP_NAME}`}</title>
      <header className="flex items-center gap-4 border-b px-4 py-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/patients">
            <ArrowLeftIcon /> Back
          </Link>
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">Bill Patient</h1>
        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          Bill Booking Time
          <span className="rounded-md border px-3 py-1.5 text-foreground">{bookingTime}</span>
        </div>
        <Button variant="ghost" size="icon" asChild>
          <Link href="/patients" aria-label="Close">
            <XIcon />
          </Link>
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[17rem_1fr_24rem]">
        {/* Patient */}
        <aside className="overflow-y-auto border-b p-4 lg:border-r lg:border-b-0">
          {patientId ? (
            <PatientSummary id={patientId} onChange={() => setPatientId(null)} />
          ) : (
            <PatientPicker onPick={setPatientId} />
          )}
        </aside>

        {/* Source of billing and tests */}
        <main className="space-y-6 overflow-y-auto p-4">
          {barcodeShown && (
            <div className="grid gap-1.5">
              <Label htmlFor="order-barcode">{barcodeLabel}{barcodeRequired && <span className="text-destructive"> *</span>}</Label>
              <Input
                id="order-barcode"
                value={integration.autoGenerateBarcode ? "" : barcode}
                disabled={integration.autoGenerateBarcode}
                placeholder={integration.autoGenerateBarcode ? "Auto-generated when the bill is saved" : barcodeMode(integration) === "patient" ? "Scan or type the visit's barcode" : "Scan or type the tube's barcode"}
                maxLength={32}
                onChange={(e) => setBarcode(e.target.value)}
              />
            </div>
          )}

          <section className="space-y-2">
            <p className="text-sm text-muted-foreground">Select Source of Billing</p>
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ["self", "Self Pay"],
                  ["org", "Org Pay"],
                  ["none", "None (Default)"],
                ] as const
              ).map(([k, label]) => (
                <Button
                  key={k}
                  type="button"
                  variant={source === k ? "default" : "outline"}
                  disabled={k === "org" && (accounts.data?.length ?? 0) === 0}
                  onClick={() => {
                    setSource(k);
                    if (k !== "org" && accountId) chooseAccount(null);
                  }}
                >
                  {label}
                </Button>
              ))}
              {source === "org" && (
                <Select value={accountId ?? ""} onValueChange={(v) => chooseAccount(v || null)}>
                  <SelectTrigger className="w-full sm:w-64" aria-label="Organisation">
                    <SelectValue placeholder="Select organisation" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.data?.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} <span className="text-muted-foreground">· {a.code}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </section>

          <section className="rounded-lg border shadow-sm">
            <div className="grid grid-cols-[2.5rem_1fr_9rem_2.5rem] gap-3 px-4 py-3 text-sm font-semibold">
              <span>#</span>
              <span>Test Name</span>
              <span>Price</span>
              <span />
            </div>
            <ul>
              {lines.map(({ id, test, price }, i) => (
                <li key={id} className="grid grid-cols-[2.5rem_1fr_9rem_2.5rem] items-center gap-3 border-t px-4 py-2 text-sm">
                  <span>{i + 1}</span>
                  <span>
                    {test?.name} <span className="font-mono text-xs text-muted-foreground">{test?.code}</span>
                    {test?.isPanel && (
                      <Badge variant="secondary" className="ml-2">
                        Panel
                      </Badge>
                    )}
                  </span>
                  {price === 0 ? (
                    <Badge variant="destructive" className="w-fit">
                      No price
                    </Badge>
                  ) : (
                    <span className="tabular-nums">
                      {overrides.has(id) && test && test.pricePaise !== price && (
                        <span className="mr-2 text-xs text-muted-foreground line-through">{formatINR(test.pricePaise)}</span>
                      )}
                      {formatINR(price)}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Remove ${test?.name}`}
                    onClick={() => setTestIds((ids) => ids.filter((x) => x !== id))}
                  >
                    <XIcon />
                  </Button>
                </li>
              ))}
              <li className="grid grid-cols-[2.5rem_1fr_9rem_2.5rem] items-start gap-3 border-t px-4 py-3">
                <span className="pt-2 text-sm">{lines.length + 1}</span>
                <Command shouldFilter={false} className="overflow-visible rounded-md border">
                  <CommandInput
                    ref={testSearchRef}
                    placeholder="Search & Select List"
                    aria-label="Add a test"
                    value={testQuery}
                    onValueChange={setTestQuery}
                    autoFocus={!!initialPatientId}
                  />
                  {testQuery.trim() && (
                    <CommandList>
                      <CommandEmpty>No test matches.</CommandEmpty>
                      <CommandGroup>
                        {matches.map((t) => (
                          <CommandItem key={t.id} value={t.id} onSelect={() => void addTest(t.id)}>
                            <span className="w-16 font-mono text-xs text-muted-foreground">{t.code}</span>
                            <span className="flex-1 truncate">{t.name}</span>
                            {t.isPanel && <Badge variant="secondary">Panel</Badge>}
                            <span className="tabular-nums text-muted-foreground">
                              {priceOf(t.id) ? formatINR(priceOf(t.id)) : "No price"}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  )}
                </Command>
                <span className="pt-2 text-sm tabular-nums text-muted-foreground">0</span>
                <span />
              </li>
            </ul>
            <button
              type="button"
              onClick={() => testSearchRef.current?.focus()}
              className="m-4 mt-2 block w-[calc(100%-2rem)] rounded-md bg-primary/10 py-2 text-center text-primary hover:bg-primary/15"
            >
              Add Test
            </button>
          </section>

          <Input placeholder="Notes for the lab (optional)" aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />

        </main>

        {/* Price list details and bill */}
        <aside className="space-y-4 overflow-y-auto border-t p-4 text-sm lg:border-t-0 lg:border-l">
          <h2 className="font-medium">Price List Details</h2>
          <div className="grid gap-2">
            <Label htmlFor="price-type" className="font-normal text-muted-foreground">
              Price List Type
            </Label>
            <Select
              value={priceType}
              onValueChange={(v) => {
                setPriceType(v as PriceListType);
                setPriceListId(BASE_RATES);
              }}
            >
              <SelectTrigger id="price-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICE_LIST_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {PRICE_LIST_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="price-list" className="font-normal text-muted-foreground">
              Price List
            </Label>
            <Select value={priceListId} onValueChange={setPriceListId}>
              <SelectTrigger id="price-list" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BASE_RATES}>Base rates</SelectItem>
                {listsOfType.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label className="font-normal text-muted-foreground">Referral</Label>
            <DoctorPicker value={doctor} onChange={chooseDoctor} />
            {doctor && doctor.commissionPercent > 0 && (
              <p className="text-xs text-muted-foreground">
                Commission {doctor.commissionPercent}% · {formatINR(Math.round((totals.netPaise * doctor.commissionPercent) / 100))}
              </p>
            )}
          </div>
          <Separator />
          <div className="space-y-4">
            <div className="flex justify-between">
              <span>
                {lines.length} {lines.length === 1 ? "test" : "tests"}
              </span>
              <span className="tabular-nums">{formatINR(totals.grossPaise)}</span>
            </div>

            {canDiscount && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="flex-1">Discount</Label>
                  <div className="flex rounded-md border p-0.5">
                    {(["PERCENT", "AMOUNT"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={discountType === t}
                        className={cn("rounded px-2 py-0.5 text-xs", discountType === t && "bg-primary text-primary-foreground")}
                        onClick={() => {
                          setDiscountType(t);
                          setDiscountValue(null);
                        }}
                      >
                        {t === "PERCENT" ? "%" : "₹"}
                      </button>
                    ))}
                  </div>
                </div>
                {discountType === "PERCENT" ? (
                  <NumberInput aria-label="Discount percent" placeholder="0" value={discountValue} onChange={(v) => setDiscountValue(v == null ? null : Math.min(v, 100))} />
                ) : (
                  <MoneyInput aria-label="Discount amount" placeholder="0" value={discountValue} onChange={setDiscountValue} />
                )}
                {totals.discountPaise > 0 && (
                  <>
                    <Input
                      placeholder="Reason, e.g. Senior citizen"
                      aria-label="Discount reason"
                      aria-invalid={discountReason.trim().length < 3}
                      value={discountReason}
                      onChange={(e) => setDiscountReason(e.target.value)}
                    />
                    <div className="flex justify-between text-muted-foreground">
                      <span>Discount</span>
                      <span className="tabular-nums">− {formatINR(totals.discountPaise)}</span>
                    </div>
                  </>
                )}
              </div>
            )}

            <Separator />
            <div className="flex justify-between text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatINR(totalPaise)}</span>
            </div>

            {account ? (
              <div className={cn("space-y-1 rounded-md border p-3", overLimit && "border-destructive")}>
                <div className="font-medium">Billed to {account.name}</div>
                <p className="text-xs text-muted-foreground">The patient pays nothing now. The amount is held on {account.name}&apos;s wallet and taken when the sample is received.</p>
                <p className={cn("text-xs", overLimit ? "text-destructive" : "text-muted-foreground")}>
                  Wallet {formatINR(account.walletPaise)}, on hold {formatINR(account.holdPaise)}
                  {account.creditLimitPaise != null && <>, credit limit {formatINR(account.creditLimitPaise)}</>}
                  {overLimit && ": this order would go over. Add money to the wallet or raise the limit."}
                </p>
              </div>
            ) : (
            <div className="space-y-2">
              <Label>Payment now</Label>
              {shownPayments.map((p) => (
                <div key={p.key} className="space-y-1.5">
                  <div className="flex gap-2">
                    <Select value={p.mode} onValueChange={(v) => editPayment(p.key, { mode: v as PaymentMode })}>
                      <SelectTrigger className="w-28" aria-label="Payment mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_MODES.map((m) => (
                          <SelectItem key={m} value={m}>
                            {PAYMENT_MODE_LABEL[m]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <MoneyInput
                      aria-label="Amount paid"
                      className="flex-1"
                      value={p.amountPaise}
                      onChange={(v) => editPayment(p.key, { amountPaise: v })}
                    />
                    {shownPayments.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove payment"
                        onClick={() => setPayments(shownPayments.filter((x) => x.key !== p.key))}
                      >
                        <Trash2Icon />
                      </Button>
                    )}
                  </div>
                  {p.mode !== "CASH" && (
                    <Input
                      placeholder={p.mode === "CARD" ? "Card last 4 digits / approval code" : "Transaction reference"}
                      aria-label="Payment reference"
                      value={p.reference}
                      onChange={(e) => editPayment(p.key, { reference: e.target.value })}
                    />
                  )}
                </div>
              ))}
              {shownPayments.length < 3 && totalPaise > 0 && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() =>
                    setPayments([
                      ...shownPayments,
                      // While the first row is automatic it shrinks as this one is filled in.
                      { key: nextKey.current++, mode: "UPI", amountPaise: firstRowAuto ? null : Math.max(duePaise, 0) || null, reference: "" },
                    ])
                  }
                >
                  <PlusIcon /> Split payment
                </Button>
              )}
            </div>

            )}

            <div className={cn("flex justify-between font-medium", duePaise > 0 ? "text-amber-700 dark:text-amber-400" : duePaise < 0 && "text-destructive")}>
              <span>{duePaise < 0 ? "Over by" : "Balance due"}</span>
              <span className="tabular-nums">{formatINR(Math.abs(duePaise))}</span>
            </div>

            {problems.length > 0 && (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {problems.map((p) => (
                  <li key={p}>• {p}</li>
                ))}
              </ul>
            )}

          </div>
        </aside>
      </div>

      <footer className="flex items-center justify-end gap-3 border-t px-4 py-3">
        {problems.length > 0 && <span className="mr-auto text-xs text-muted-foreground">{problems[0]}</span>}
        <Button variant="outline" className="border-destructive text-destructive hover:text-destructive" asChild>
          <Link href="/patients">Cancel</Link>
        </Button>
        <Button
          className="bg-green-600 text-white hover:bg-green-700"
          disabled={problems.length > 0 || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending && <Spinner />}
          Confirm and Bill
          {totalPaise > 0 && ` · ${formatINR(totalPaise)}`}
        </Button>
      </footer>
    </div>
  );
}
