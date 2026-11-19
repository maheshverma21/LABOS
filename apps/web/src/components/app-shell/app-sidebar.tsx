"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRightIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/providers/auth-provider";
import { activeHref, NAV } from "./nav";
import { BranchSwitcher } from "./branch-switcher";
import { UserMenu } from "./user-menu";

export function AppSidebar() {
  const { can, user } = useAuth();
  const pathname = usePathname();
  const active = activeHref(pathname);
  const { state, isMobile } = useSidebar();
  const collapsedBar = state === "collapsed" && !isMobile;
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => (!item.permission || can(item.permission)) && (!item.roles || item.roles.some((r) => user?.roles.includes(r))),
    ),
  })).filter((group) => group.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1"><BranchSwitcher /></div>
          <SidebarTrigger className="hidden size-8 shrink-0 md:inline-flex group-data-[collapsible=icon]:hidden" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => {
          const menu = (
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  {item.soon ? (
                    <>
                      <SidebarMenuButton tooltip={`${item.title} (coming soon)`} aria-disabled className="opacity-50">
                        <item.icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                      <SidebarMenuBadge className="text-[10px] font-normal text-sidebar-foreground/60">Soon</SidebarMenuBadge>
                    </>
                  ) : (
                    <SidebarMenuButton asChild tooltip={item.title} isActive={item.href === active}>
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          );
          // Every heading is an expandable section. All start closed; in the icon-only sidebar they stay open so the icons show.
          if (group.flat) return <SidebarGroup key={group.label}><SidebarGroupContent>{menu}</SidebarGroupContent></SidebarGroup>;
          const isOpen = collapsedBar || open[group.label] === true;
          return (
            <Collapsible
              key={group.label}
              open={isOpen}
              onOpenChange={(o) => setOpen((prev) => ({ ...prev, [group.label]: o }))}
              className="group/collapsible"
            >
              <SidebarGroup>
                <SidebarGroupLabel asChild>
                  <CollapsibleTrigger className="h-8 cursor-pointer gap-2 text-sm font-normal text-sidebar-foreground hover:bg-sidebar-accent/60">
                    <group.icon />
                    <span>{group.label}</span>
                    <ChevronRightIcon className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>{menu}</SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
