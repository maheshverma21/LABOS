"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PencilIcon, PlusIcon, StarIcon, Trash2Icon } from "lucide-react";
import { LETTERHEAD_STYLE_LABEL, type ReportTemplateItem } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "@/components/app-shell/page-header";
import { api } from "@/lib/api";
import { APP_NAME } from "@/lib/brand";
import { brandingKeys, useTemplates } from "@/lib/branding";

function TemplateRow({ t, onDelete }: { t: ReportTemplateItem; onDelete: () => void }) {
  const queryClient = useQueryClient();
  const makeDefault = useMutation({
    mutationFn: () => api(`/lab/templates/${t.id}/default`, { method: "POST" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: brandingKeys.templates });
      toast.success(`${t.name} is now the default`);
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="size-4 shrink-0 rounded-full border" style={{ background: t.accentColor }} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 font-medium">
          {t.name}
          {t.isDefault && <Badge>Default</Badge>}
        </div>
        <div className="text-sm text-muted-foreground">{LETTERHEAD_STYLE_LABEL[t.style]}</div>
      </div>
      <div className="flex flex-wrap gap-1">
        {!t.isDefault && (
          <Button variant="ghost" size="sm" disabled={makeDefault.isPending} onClick={() => makeDefault.mutate()}>
            {makeDefault.isPending ? <Spinner /> : <StarIcon />} Make default
          </Button>
        )}
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/settings/report-templates/${t.id}`}>
            <PencilIcon /> Edit
          </Link>
        </Button>
        {!t.isDefault && (
          <Button variant="ghost" size="sm" onClick={onDelete} aria-label={`Delete ${t.name}`}>
            <Trash2Icon />
          </Button>
        )}
      </div>
    </li>
  );
}

function DeleteDialog({ t, onClose }: { t: ReportTemplateItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const del = useMutation({
    mutationFn: () => api(`/lab/templates/${t.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: brandingKeys.templates });
      toast.success(`${t.name} deleted`);
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {t.name}?</DialogTitle>
          <DialogDescription>Reports already printed or sent aren&apos;t affected. New reports can&apos;t use it any more.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="destructive" disabled={del.isPending} onClick={() => del.mutate()}>
            {del.isPending && <Spinner />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ReportTemplatesPage() {
  const { data: templates, isPending } = useTemplates();
  const [deleting, setDeleting] = useState<ReportTemplateItem | null>(null);
  return (
    <>
      <title>{`Report letterheads · ${APP_NAME}`}</title>
      <PageHeader
        title="Report letterheads"
        description="How your reports look. The default is used for WhatsApp, the patient link and printing; staff can pick another when printing."
        actions={
          <Button asChild>
            <Link href="/settings/report-templates/new">
              <PlusIcon /> New letterhead
            </Link>
          </Button>
        }
      />
      <div className="max-w-3xl">
        {isPending || !templates ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <Card className="py-0">
            <CardContent className="px-0">
              <ul className="divide-y">
                {templates.map((t) => (
                  <TemplateRow key={t.id} t={t} onDelete={() => setDeleting(t)} />
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
        <p className="mt-3 text-sm text-muted-foreground">
          Signatures and stamps are added under Users &amp; roles.
        </p>
      </div>
      {deleting && <DeleteDialog t={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}
