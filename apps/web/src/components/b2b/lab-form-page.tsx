"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EyeIcon, EyeOffIcon, FileTextIcon, ImageIcon, KeyRoundIcon, PlusIcon, TrashIcon, UploadIcon } from "lucide-react";
import { ACCOUNT_TYPE_LABEL, ACCOUNT_TYPES, accountLoginSchema, accountSchema, labLetterheadSchema, labSettingsSchema, passwordSchema, SETTING_FLAGS, type AccountDetail } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { MoneyInput } from "@/components/inputs/money-input";
import { NumberInput } from "@/components/inputs/number-input";
import { api, apiBlob, apiUpload } from "@/lib/api";
import { accountKeys, fmtStamp, useAccount } from "@/lib/accounts";

const Req = () => <span className="mr-1 text-red-600">*</span>;
const field = "space-y-1.5";
const lbl = "text-sm font-normal";

/** Add a B2B lab, or edit one: details, its own report letterhead, finance, switches, login and bank details. */
export function LabFormPage({ labId }: { labId?: string }) {
  const lab = useAccount(labId ?? "", !!labId);
  if (labId && !lab.data) return <Skeleton className="h-96" />;
  return <Form lab={lab.data} />;
}

function Form({ lab }: { lab?: AccountDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const defaults = labSettingsSchema.parse({});
  const [v, setV] = useState(() => ({
    name: lab?.name ?? "",
    code: lab?.code ?? "",
    type: lab?.type ?? "LAB",
    city: lab?.city ?? "",
    phone: lab?.phone ?? "",
    email: lab?.email ?? "",
    address: lab?.address ?? "",
    contactName: lab?.contactName ?? "",
    gstin: lab?.gstin ?? "",
    notes: lab?.notes ?? "",
    creditLimitPaise: (lab ? lab.creditLimitPaise : 0) as number | null,
    discountPercent: lab?.discountPercent ?? 0,
    isActive: lab?.isActive ?? true,
    settings: lab?.settings ?? defaults,
    letterhead: lab?.letterhead ?? labLetterheadSchema.parse({}),
  }));
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((p) => ({ ...p, [k]: x }));
  const first = lab?.logins[0];
  const [loginEmail, setLoginEmail] = useState(first?.email ?? "");
  const [loginPw, setLoginPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: async () => {
      const parsed = accountSchema.safeParse({
        ...v,
        phone: v.phone || null,
        email: v.email || null,
        letterhead: { ...v.letterhead },
      });
      if (!parsed.success) {
        const e: Record<string, string> = {};
        for (const i of parsed.error.issues) e[i.path.join(".")] ??= i.message;
        setErrors(e);
        throw new Error("Check the highlighted fields");
      }
      if (!v.email.trim()) {
        setErrors({ email: "Email is required" });
        throw new Error("Check the highlighted fields");
      }
      setErrors({});
      // The login: a new one needs both an email and a password; an existing one only a new password.
      if (!first && (loginEmail || loginPw)) {
        const l = accountLoginSchema.safeParse({ name: v.contactName || v.name, email: loginEmail, password: loginPw });
        if (!l.success) {
          setErrors({ login: l.error.issues[0]?.message ?? "Check the login" });
          throw new Error("Check the login details");
        }
      }
      if (first && loginPw && !passwordSchema.safeParse(loginPw).success) {
        setErrors({ login: "Password must be at least 8 characters" });
        throw new Error("Check the login details");
      }
      const { account } = lab
        ? await api<{ account: AccountDetail }>(`/accounts/${lab.id}`, { method: "PUT", body: parsed.data })
        : await api<{ account: AccountDetail }>("/accounts", { method: "POST", body: parsed.data });
      if (lab && lab.isActive !== v.isActive) await api(`/accounts/${lab.id}/status`, { method: "POST", body: { isActive: v.isActive } });
      if (!lab && !v.isActive) await api(`/accounts/${account.id}/status`, { method: "POST", body: { isActive: false } });
      if (!first && loginEmail && loginPw) {
        await api(`/accounts/${account.id}/logins`, { method: "POST", body: { name: v.contactName || v.name, email: loginEmail, password: loginPw } });
      } else if (first && loginPw) {
        await api(`/accounts/${account.id}/logins/${first.id}`, { method: "PATCH", body: { password: loginPw } });
      }
      return account;
    },
    onSuccess: async (a) => {
      await queryClient.invalidateQueries({ queryKey: accountKeys.all });
      toast.success(lab ? "Saved" : `${a.name} added`);
      router.push("/b2b");
    },
    onError: (err) => toast.error(err.message),
  });

  const err = (k: string) => (errors[k] ? <p className="text-xs text-destructive">{errors[k]}</p> : null);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{lab ? `Edit ${lab.name}` : "New B2B Lab"}</h1>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-base">Lab Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div className={field}>
              <Label className={lbl} htmlFor="f-name">
                <Req />
                Lab Name
              </Label>
              <Input id="f-name" value={v.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} />
              {err("name")}
            </div>
            <div className={field}>
              <Label className={lbl} htmlFor="f-city">
                City
              </Label>
              <Input id="f-city" value={v.city} onChange={(e) => set("city", e.target.value)} />
            </div>
            <div className={field}>
              <Label className={lbl} htmlFor="f-phone">
                Phone Number
              </Label>
              <div className="flex">
                <span className="flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm whitespace-nowrap">IN +91</span>
                <Input id="f-phone" className="rounded-l-none" inputMode="numeric" value={v.phone} onChange={(e) => set("phone", e.target.value.replace(/[^\d ]/g, ""))} />
              </div>
            </div>
            <div className={field}>
              <Label className={lbl} htmlFor="f-email">
                <Req />
                Email
              </Label>
              <Input id="f-email" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} aria-invalid={!!errors.email} />
              {err("email")}
            </div>
            <div className={field}>
              <Label className={lbl}>Active State</Label>
              <div className="pt-1">
                <Switch aria-label="Active state" checked={v.isActive} onCheckedChange={(x) => set("isActive", x)} />
              </div>
            </div>
            <div className={field}>
              <Label className={lbl} htmlFor="f-code">
                <Req />
                Center Code
              </Label>
              <Input id="f-code" className="uppercase" maxLength={12} value={v.code} onChange={(e) => set("code", e.target.value)} aria-invalid={!!errors.code} />
              {err("code")}
            </div>
            <div className={`${field} md:col-span-2`}>
              <Label className={lbl} htmlFor="f-address">
                Address
              </Label>
              <textarea id="f-address" value={v.address} onChange={(e) => set("address", e.target.value)} className="min-h-14 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
            </div>
          </div>

          <div className="border-t pt-4">
            <LetterheadSection v={v.letterhead} onChange={(l) => set("letterhead", l)} error={errors["letterhead.backgroundAssetId"]} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-base">Financial Management</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className={field}>
            <Label className={lbl} htmlFor="f-type">
              Type
            </Label>
            <Select value={v.type} onValueChange={(x) => set("type", x as typeof v.type)}>
              <SelectTrigger id="f-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {ACCOUNT_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className={field}>
            <Label className={lbl} htmlFor="f-limit">
              Credit Limit
            </Label>
            <MoneyInput id="f-limit" placeholder="No limit" value={v.creditLimitPaise} onChange={(x) => set("creditLimitPaise", x)} />
            <p className="text-xs text-muted-foreground">How far below zero the wallet may go. Blank means no limit.</p>
          </div>
          <div className={field}>
            <Label className={lbl} htmlFor="f-discount">
              Discount (%)
            </Label>
            <NumberInput id="f-discount" value={v.discountPercent} onChange={(x) => set("discountPercent", x ?? 0)} />
            <p className="text-xs text-muted-foreground">Off base rates, for tests the price list doesn&apos;t set.</p>
            {err("discountPercent")}
          </div>
          <div className={field}>
            <Label className={lbl} htmlFor="f-gstin">
              GSTIN
            </Label>
            <Input id="f-gstin" className="uppercase" maxLength={15} value={v.gstin} onChange={(e) => set("gstin", e.target.value)} aria-invalid={!!errors.gstin} />
            {err("gstin")}
          </div>
          <div className={field}>
            <Label className={lbl} htmlFor="f-contact">
              Contact Person
            </Label>
            <Input id="f-contact" value={v.contactName} onChange={(e) => set("contactName", e.target.value)} />
          </div>
          <div className={`${field} md:col-span-3`}>
            <Label className={lbl} htmlFor="f-notes">
              Notes
            </Label>
            <Input id="f-notes" value={v.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>

          <div className="space-y-4 border-t pt-4 md:col-span-4">
            <h3 className="text-sm font-medium">Permissions and Security</h3>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {SETTING_FLAGS.map((f) => (
                <Label key={f.key} className="items-start gap-2 text-sm font-normal">
                  <Checkbox className="mt-0.5" checked={v.settings[f.key]} onCheckedChange={(x) => set("settings", { ...v.settings, [f.key]: x === true })} />
                  {f.label}
                </Label>
              ))}
            </div>
            <div className="space-y-2 border-t pt-4">
              <h3 className="text-sm font-medium">
                <Req />
                Payment Method
              </h3>
              <div className="flex gap-6">
                {(["manual", "online"] as const).map((k) => (
                  <Label key={k} className="gap-2 text-sm font-normal">
                    <Checkbox checked={v.settings.payment[k]} onCheckedChange={(x) => set("settings", { ...v.settings, payment: { ...v.settings.payment, [k]: x === true } })} />
                    {k === "manual" ? "Manual" : "Pay Online"}
                  </Label>
                ))}
              </div>
              {errors["settings.payment"] && <p className="text-xs text-destructive">{errors["settings.payment"]}</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-base">User Credentials</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className={field}>
              <Label className={lbl} htmlFor="f-user">
                User Name (login email)
              </Label>
              <Input id="f-user" type="email" autoComplete="off" disabled={!!first} value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
            </div>
            <div className={field}>
              <Label className={lbl} htmlFor="f-pw">
                Password
              </Label>
              <div className="relative">
                <Input id="f-pw" type={showPw ? "text" : "password"} autoComplete="new-password" placeholder={first ? "Leave blank to keep the current password" : "At least 8 characters"} value={loginPw} onChange={(e) => setLoginPw(e.target.value)} className="pr-10" />
                <button type="button" aria-label={showPw ? "Hide password" : "Show password"} onClick={() => setShowPw((s) => !s)} className="absolute top-2 right-3 text-muted-foreground">
                  {showPw ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                </button>
              </div>
            </div>
          </div>
          {err("login")}
          <p className="text-xs text-muted-foreground">The lab signs in at the normal sign-in page with this email. They choose their own password at first sign-in.</p>
          {lab && <MoreLogins lab={lab} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-base">Bank Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          {(
            [
              ["bankName", "Bank Name", "Enter Bank Name"],
              ["accountNumber", "Account Number", "Enter Account Number"],
              ["ifsc", "IFSC Code", "Enter IFSC Code"],
              ["pan", "PAN Number", "Enter PAN Number"],
            ] as const
          ).map(([k, label, ph]) => (
            <div key={k} className={field}>
              <Label className={lbl} htmlFor={`f-${k}`}>
                {label}
              </Label>
              <Input id={`f-${k}`} placeholder={ph} value={v.settings.bank[k] ?? ""} onChange={(e) => set("settings", { ...v.settings, bank: { ...v.settings.bank, [k]: e.target.value || null } })} />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/b2b")}>
          Cancel
        </Button>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Spinner />}
          {lab ? "Update" : "Create"}
        </Button>
      </div>
    </div>
  );
}

function LetterheadSection({ v, onChange, error }: { v: ReturnType<typeof labLetterheadSchema.parse>; onChange: (l: typeof v) => void; error?: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => onChange({ ...v, [k]: x });

  // Show the saved background.
  useEffect(() => {
    if (!v.backgroundAssetId) return;
    let url: string | null = null;
    let live = true;
    apiBlob(`/lab/assets/${v.backgroundAssetId}`)
      .then((b) => {
        if (!live) return;
        url = URL.createObjectURL(b);
        setThumb(url);
      })
      .catch(() => setThumb(null));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [v.backgroundAssetId]);

  const upload = async (f: File) => {
    setBusy(true);
    try {
      const { asset } = await apiUpload<{ asset: { id: string } }>("/lab/b2b-letterhead/asset", f, "POST");
      onChange({ ...v, backgroundAssetId: asset.id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't upload");
    } finally {
      setBusy(false);
    }
  };

  const preview = async () => {
    try {
      const blob = await apiBlob("/lab/b2b-letterhead/preview", { method: "POST", body: { ...v, enabled: true } });
      window.open(URL.createObjectURL(blob), "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't make the preview");
    }
  };

  const slider = (k: "leftMarginMm" | "rightMarginMm", label: string) => (
    <div className={field}>
      <Label className={lbl}>{label}</Label>
      <div className="flex items-center gap-3">
        <input type="range" min={0} max={60} value={v[k]} onChange={(e) => set(k, Number(e.target.value))} className="flex-1 accent-primary" aria-label={label} />
        <NumberInput className="w-16" value={v[k]} onChange={(x) => set(k, Math.min(60, Math.max(0, x ?? 0)))} />
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Label className="gap-2 text-sm font-normal">
        <Checkbox checked={v.enabled} onCheckedChange={(x) => set("enabled", x === true)} />
        Add B2B Letterhead
      </Label>
      {v.enabled && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className={field}>
            <Label className={lbl}>Header Height</Label>
            <NumberInput value={v.headerHeightMm} onChange={(x) => set("headerHeightMm", Math.min(150, Math.max(0, x ?? 0)))} />
          </div>
          <div className={field}>
            <Label className={lbl}>Footer Height</Label>
            <NumberInput value={v.footerHeightMm} onChange={(x) => set("footerHeightMm", Math.min(150, Math.max(0, x ?? 0)))} />
          </div>
          <div className={field}>
            <Label className={lbl}>Letterhead (A4 image, PNG or JPEG)</Label>
            <Button type="button" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? <Spinner /> : <UploadIcon />} Click to Upload
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void upload(f);
              }}
            />
          </div>
          {slider("leftMarginMm", "Left Margin")}
          {slider("rightMarginMm", "Right Margin")}
          <div className="flex items-end gap-3">
            {v.backgroundAssetId && (
              <div className="flex flex-1 items-center gap-3 rounded-md border p-2 text-sm">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="Letterhead background" className="h-12 w-9 rounded border object-cover" />
                ) : (
                  <ImageIcon className="size-8 text-primary" />
                )}
                <span className="flex-1">Letterhead Background</span>
                <button type="button" aria-label="Remove letterhead image" onClick={() => set("backgroundAssetId", null)} className="text-muted-foreground hover:text-destructive">
                  <TrashIcon className="size-4" />
                </button>
              </div>
            )}
            <Button type="button" variant="outline" className="border-primary text-primary" disabled={!v.backgroundAssetId} onClick={() => void preview()}>
              <FileTextIcon /> Preview Report
            </Button>
          </div>
          {error && <p className="text-xs text-destructive md:col-span-3">{error}</p>}
        </div>
      )}
    </div>
  );
}

/** Other people who can sign in for this lab. */
function MoreLogins({ lab }: { lab: AccountDetail }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: accountKeys.all });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", email: "", password: "" });
  const [resetting, setResetting] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const others = lab.logins.slice(1);

  const add = useMutation({
    mutationFn: () => api(`/accounts/${lab.id}/logins`, { method: "POST", body: accountLoginSchema.parse(draft) }),
    onSuccess: async () => {
      await refresh();
      toast.success("Login added");
      setDraft({ name: "", email: "", password: "" });
      setAdding(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Check the details"),
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { isActive?: boolean; password?: string } }) => api(`/accounts/${lab.id}/logins/${id}`, { method: "PATCH", body }),
    onSuccess: async () => {
      await refresh();
      setResetting(null);
      setPw("");
      toast.success("Saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const first = lab.logins[0];

  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Logins for this lab</h3>
        <Button type="button" size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>
          <PlusIcon /> Add another login
        </Button>
      </div>
      {[first, ...others].filter(Boolean).map((l) => (
        <div key={l!.id} className="grid gap-2 rounded-md border p-2 text-sm">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{l!.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {l!.email} · {l!.lastLoginAt ? `last in ${fmtStamp(l!.lastLoginAt)}` : "never signed in"}
              </div>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setResetting(resetting === l!.id ? null : l!.id)}>
              <KeyRoundIcon /> Reset password
            </Button>
            <Switch aria-label={`${l!.name} can sign in`} checked={l!.isActive} disabled={patch.isPending} onCheckedChange={(x) => patch.mutate({ id: l!.id, body: { isActive: x } })} />
          </div>
          {resetting === l!.id && (
            <div className="flex gap-2">
              <Input aria-label="New temporary password" placeholder="Temporary password (8+ characters)" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} />
              <Button type="button" disabled={!passwordSchema.safeParse(pw).success || patch.isPending} onClick={() => patch.mutate({ id: l!.id, body: { password: pw } })}>
                Set
              </Button>
            </div>
          )}
        </div>
      ))}
      {adding && (
        <div className="grid gap-2 rounded-md border p-2 sm:grid-cols-3">
          <Input aria-label="Name" placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <Input aria-label="Email" type="email" placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          <Input aria-label="Temporary password" placeholder="Temporary password" autoComplete="off" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
          <Button type="button" className="sm:col-span-3" disabled={add.isPending} onClick={() => add.mutate()}>
            {add.isPending && <Spinner />}
            Create login
          </Button>
        </div>
      )}
    </div>
  );
}
