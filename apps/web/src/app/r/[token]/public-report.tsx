"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, DownloadIcon, FileTextIcon, PhoneIcon } from "lucide-react";
import type { ApiError as ApiErrorBody, PublicReportInfo } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

async function fetchInfo(token: string): Promise<PublicReportInfo> {
  const res = await fetch(`/api/public/reports/${encodeURIComponent(token)}/info`, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as ApiErrorBody | null)?.error?.message ?? "This report link isn't valid");
  return (body as { report: PublicReportInfo }).report;
}

/** What a patient sees when they open the link from WhatsApp. No sign-in. */
export function PublicReport({ token }: { token: string }) {
  const { data: r, error, isPending } = useQuery({ queryKey: ["public-report", token], queryFn: () => fetchInfo(token), retry: false });
  const pdf = `/api/public/reports/${encodeURIComponent(token)}/pdf`;

  return (
    <main className="flex min-h-svh items-start justify-center bg-muted/40 px-4 py-10 sm:items-center">
      <Card className="w-full max-w-sm">
        {isPending ? (
          <CardContent className="space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        ) : error || !r ? (
          <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
            <CircleAlertIcon className="size-8 text-muted-foreground" />
            <p className="font-medium">{error?.message ?? "This report link isn't valid"}</p>
            <p className="text-sm text-muted-foreground">Check the link, or ask the lab to send it again.</p>
          </CardContent>
        ) : (
          <>
            <CardHeader>
              <CardDescription>{r.lab.name}</CardDescription>
              <CardTitle className="text-xl">Hello {r.patientName}, your report is here</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Lab no.</dt>
                <dd className="font-mono">{r.orderNo}</dd>
                <dt className="text-muted-foreground">Date</dt>
                <dd>{dateFmt.format(new Date(r.orderDate))}</dd>
                <dt className="text-muted-foreground">Tests ready</dt>
                <dd>
                  {r.approvedTests} of {r.totalTests}
                </dd>
              </dl>
              {r.approvedTests === 0 ? (
                <p className="rounded-md bg-muted p-3 text-sm">Your results aren&apos;t ready yet. Please check again later.</p>
              ) : (
                <>
                  {r.approvedTests < r.totalTests && (
                    <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      Some tests are still in progress. This link will show them once they&apos;re ready.
                    </p>
                  )}
                  <div className="grid gap-2">
                    <Button asChild size="lg">
                      <a href={pdf} target="_blank" rel="noreferrer">
                        <FileTextIcon /> Open report
                      </a>
                    </Button>
                    <Button asChild variant="outline" size="lg">
                      <a href={pdf} download={`Report-${r.orderNo}.pdf`}>
                        <DownloadIcon /> Download PDF
                      </a>
                    </Button>
                  </div>
                </>
              )}
              {r.lab.phone && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <PhoneIcon className="size-3.5" /> Questions? Call the lab on{" "}
                  <a className="underline underline-offset-2" href={`tel:${r.lab.phone.replace(/\s/g, "")}`}>
                    {r.lab.phone}
                  </a>
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Link valid until {dateFmt.format(new Date(r.expiresAt))}. Please discuss your results with your doctor.
              </p>
            </CardContent>
          </>
        )}
      </Card>
    </main>
  );
}
