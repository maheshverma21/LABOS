"use client";

import Link from "next/link";
import { ArrowRightIcon, CheckCircle2Icon, CircleIcon } from "lucide-react";
import { SYSTEM_ROLES } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/app-shell/page-header";
import { useAuth } from "@/providers/auth-provider";

const roleName = (key: string) => SYSTEM_ROLES.find((r) => r.key === key)?.name ?? key;

const COMING_UP = [
  "Inventory and quality control",
  "Analyzer integration",
  "ABDM / ABHA health records",
];

export default function DashboardPage() {
  const { user, can } = useAuth();
  if (!user) return null;

  return (
    <>
      <PageHeader title={`Welcome, ${user.name}`} description={user.tenant.name} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Your access</CardTitle>
            <CardDescription>What you can do in this lab</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-1.5">
              {user.roles.map((r) => (
                <Badge key={r} variant="secondary">
                  {roleName(r)}
                </Badge>
              ))}
            </div>
            <p className="text-muted-foreground">
              {user.permissions.length} permissions ·{" "}
              {user.branches.length === 1 ? user.branches[0]?.name : `${user.branches.length} branches`}
            </p>
          </CardContent>
        </Card>

        {can("users:write") && (
          <Card>
            <CardHeader>
              <CardTitle>Set up your lab</CardTitle>
              <CardDescription>Before your first patient</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="flex items-center gap-2">
                <CheckCircle2Icon className="size-4 text-primary" /> Lab account created
              </p>
              <p className="flex items-center gap-2">
                <CircleIcon className="size-4 text-muted-foreground" /> Add your GSTIN and branch addresses for bills
              </p>
              <p className="flex items-center gap-2">
                <CircleIcon className="size-4 text-muted-foreground" /> Set up your tests, reference ranges and prices
              </p>
              <p className="flex items-center gap-2">
                <CircleIcon className="size-4 text-muted-foreground" /> Add your front desk, technicians and pathologist
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link href="/settings/lab">
                    Lab profile <ArrowRightIcon />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/catalog">
                    Test List <ArrowRightIcon />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/settings/users">
                    Add staff <ArrowRightIcon />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Coming next</CardTitle>
            <CardDescription>Modules after the core lab workflow</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {COMING_UP.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <CircleIcon className="size-3" /> {item}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
