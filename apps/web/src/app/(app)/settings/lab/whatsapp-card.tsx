"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { WhatsappSettings, WhatsappSettingsInput } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, api } from "@/lib/api";
import { reportKeys } from "@/lib/reports";

/** Sending reports on WhatsApp through AiSensy: the lab's own account or the shared one. */
export function WhatsappCard({ settings }: { settings: WhatsappSettings }) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [provider, setProvider] = useState(settings.provider);
  const [apiKey, setApiKey] = useState("");
  const [campaignName, setCampaignName] = useState(settings.campaignName ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const save = useMutation({
    mutationFn: (body: WhatsappSettingsInput) =>
      api<{ settings: WhatsappSettings }>("/reports/whatsapp-settings", { method: "PUT", body }),
    onSuccess: ({ settings: saved }) => {
      queryClient.setQueryData(reportKeys.whatsapp(), saved);
      queryClient.invalidateQueries({ queryKey: reportKeys.all });
      setApiKey("");
      setFieldErrors({});
      toast.success("WhatsApp settings saved");
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields);
      toast.error(err.message);
    },
  });

  const own = provider === "own";
  const sharedMissing = enabled && !own && !settings.sharedAvailable;

  return (
    <Card id="whatsapp" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>WhatsApp reports</CardTitle>
        <CardDescription>Send report PDFs to patients on WhatsApp through AiSensy.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ enabled, provider, apiKey: apiKey || null, campaignName: campaignName || null });
          }}
        >
          <div className="flex items-center gap-2">
            <Checkbox id="wa-enabled" checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            <Label htmlFor="wa-enabled">Send reports on WhatsApp</Label>
          </div>

          <FieldGroup className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="wa-provider">Account</FieldLabel>
              <Select value={provider} onValueChange={(v) => setProvider(v as "own" | "shared")} disabled={!enabled}>
                <SelectTrigger id="wa-provider" className="w-full sm:w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="shared">Shared account</SelectItem>
                  <SelectItem value="own">Our own AiSensy account</SelectItem>
                </SelectContent>
              </Select>
              {!own && !sharedMissing && (
                <FieldDescription>Reports go out from the platform&apos;s WhatsApp number. Nothing to set up.</FieldDescription>
              )}
              {sharedMissing && (
                <FieldDescription className="text-destructive">
                  The shared account isn&apos;t set up on this server yet. Use your own account for now.
                </FieldDescription>
              )}
            </Field>

            {own && (
              <>
                <Field data-invalid={!!fieldErrors.apiKey}>
                  <FieldLabel htmlFor="wa-key">AiSensy API key</FieldLabel>
                  <Input
                    id="wa-key"
                    type="password"
                    autoComplete="off"
                    disabled={!enabled}
                    placeholder={settings.apiKeyHint ? `Saved, ends in ${settings.apiKeyHint}. Leave blank to keep it.` : "Paste the key"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <FieldDescription>In AiSensy: Manage, API key. It&apos;s stored encrypted and never shown again.</FieldDescription>
                  <FieldError errors={fieldErrors.apiKey?.map((message) => ({ message }))} />
                </Field>
                <Field data-invalid={!!fieldErrors.campaignName}>
                  <FieldLabel htmlFor="wa-campaign">API campaign name</FieldLabel>
                  <Input
                    id="wa-campaign"
                    disabled={!enabled}
                    placeholder="lab_report"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                  />
                  <FieldDescription>
                    A live API campaign whose approved template has a document header and two variables: {"{{1}}"} patient name, {"{{2}}"} lab
                    name.
                  </FieldDescription>
                  <FieldError errors={fieldErrors.campaignName?.map((message) => ({ message }))} />
                </Field>
              </>
            )}
          </FieldGroup>

          <div>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />}
              Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
