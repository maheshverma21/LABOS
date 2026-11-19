import type { LucideIcon } from "lucide-react";
import {
  BookOpenIcon,
  Building2Icon,
  WalletIcon,
  DownloadIcon,
  ReceiptTextIcon,
  ChartColumnIcon,
  CpuIcon,
  ScrollTextIcon,
  FileTextIcon,
  FlaskConicalIcon,
  HandshakeIcon,
  LayoutDashboardIcon,
  NetworkIcon,
  ShieldCheckIcon,
  StethoscopeIcon,
  TestTubeDiagonalIcon,
  UsersIcon,
  UserRoundIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import type { Permission } from "@lms/shared";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Hidden unless the user has this permission. */
  permission?: Permission;
  /** Not built yet: shown greyed out. */
  soon?: boolean;
  /** Only for people with one of these roles (e.g. My visits for phlebotomists, not owners who merely have every permission). */
  roles?: string[];
}

export interface NavGroup {
  label: string;
  /** Icon shown beside the heading. */
  icon: LucideIcon;
  /** Items are listed directly, with no heading (used for the main lab workflow). */
  flat?: boolean;
  items: NavItem[];
}

/** The nav item for a path: the one with the longest matching href. */
export function activeHref(pathname: string): string | undefined {
  return NAV.flatMap((g) => g.items)
    .filter((i) => !i.soon && (pathname === i.href || pathname.startsWith(`${i.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    icon: LayoutDashboardIcon,
    items: [{ title: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon }],
  },
  {
    label: "Lab",
    icon: FlaskConicalIcon,
    flat: true,
    items: [
      { title: "Registration / Billing", href: "/patients", icon: UserRoundIcon, permission: "patients:read" },
      { title: "Accession", href: "/samples", icon: TestTubeDiagonalIcon, permission: "samples:read" },
      { title: "Results", href: "/results", icon: FlaskConicalIcon, permission: "results:read" },
      { title: "Reports", href: "/reports", icon: FileTextIcon, permission: "reports:read" },
    ],
  },
  {
    label: "Finance",
    icon: WalletIcon,
    items: [
      { title: "Finance Dashboard", href: "/finance", icon: WalletIcon, permission: "billing:read" },
      { title: "Export", href: "/finance/export", icon: DownloadIcon, permission: "billing:read" },
      { title: "Bill List", href: "/finance/bills", icon: ReceiptTextIcon, permission: "billing:read" },
      { title: "MIS Reports", href: "/finance/mis", icon: ChartColumnIcon, permission: "billing:read" },
      { title: "Financial Reports", href: "/finance/reports", icon: ScrollTextIcon, permission: "billing:read" },
    ],
  },
  {
    label: "Test Master",
    icon: TestTubeDiagonalIcon,
    items: [{ title: "Test List", href: "/catalog", icon: BookOpenIcon, permission: "catalog:read" }],
  },
  {
    label: "Setup",
    icon: SlidersHorizontalIcon,
    items: [
      { title: "Outsourcing Management", href: "/outsourcing", icon: NetworkIcon, permission: "catalog:read" },
      { title: "Referring doctors", href: "/doctors", icon: StethoscopeIcon, permission: "patients:read" },
      { title: "B2B Labs", href: "/b2b", icon: HandshakeIcon, permission: "accounts:read" },
    ],
  },
  {
    label: "Settings",
    icon: SettingsIcon,
    items: [
      { title: "Lab profile", href: "/settings/lab", icon: Building2Icon, permission: "settings:write" },
      { title: "Analyzers", href: "/settings/analyzers", icon: CpuIcon, permission: "settings:write" },
      { title: "Users & roles", href: "/settings/users", icon: UsersIcon, permission: "users:read" },
      { title: "Security", href: "/settings/security", icon: ShieldCheckIcon },
    ],
  },
];
