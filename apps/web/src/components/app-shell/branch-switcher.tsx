"use client";

import Link from "next/link";
import { CheckIcon, ChevronsUpDownIcon, FlaskConicalIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { useAuth } from "@/providers/auth-provider";
import { useAssetUrl } from "@/lib/branding";
import { useLab } from "@/lib/orders";

function LabMark({ subtitle }: { subtitle: string }) {
  const { user } = useAuth();
  const { data: lab } = useLab();
  const logo = useAssetUrl(lab?.logoId);
  return (
    <>
      {logo ? (
        <div className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg bg-white p-0.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- a blob URL from the API, no optimisation needed */}
          <img src={logo} alt="" className="max-h-full max-w-full object-contain" />
        </div>
      ) : (
        <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <FlaskConicalIcon className="size-4" />
        </div>
      )}
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-semibold">{user?.tenant.name}</span>
        <span className="truncate text-xs text-sidebar-foreground/70">{subtitle}</span>
      </div>
    </>
  );
}

/** Lab name plus the branch the user is working at; a picker when they have more than one. */
export function BranchSwitcher() {
  const { user, branch, setBranch } = useAuth();
  const { isMobile } = useSidebar();
  const branches = user?.branches ?? [];

  if (branches.length <= 1) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" asChild>
            <Link href="/dashboard">
              <LabMark subtitle={branch?.name ?? ""} />
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent" aria-label="Switch branch">
              <LabMark subtitle={branch?.name ?? "Pick a branch"} />
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56" side={isMobile ? "bottom" : "right"} align="start" sideOffset={4}>
            <DropdownMenuLabel className="text-xs text-muted-foreground">Working at</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {branches.map((b) => (
              <DropdownMenuItem key={b.id} onSelect={() => setBranch(b.id)}>
                <span className="flex-1">{b.name}</span>
                {b.id === branch?.id && <CheckIcon />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
