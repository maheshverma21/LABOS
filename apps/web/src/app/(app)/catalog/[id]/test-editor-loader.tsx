"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/app-shell/page-header";
import { useTest } from "@/lib/catalog";
import { TestEditor } from "../_components/test-editor";

export function TestEditorLoader({ id }: { id: string }) {
  const { data, error, isPending } = useTest(id);

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <PageHeader
        title="Test not found"
        description={error.message}
        actions={
          <Button variant="outline" asChild>
            <Link href="/catalog">Back to Test List</Link>
          </Button>
        }
      />
    );
  }
  // Re-mount when the server version changes so the form picks up fresh values.
  return <TestEditor key={`${data.id}-${data.isActive}`} test={data} />;
}
