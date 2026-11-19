import { RequireAuth, StaffOnly } from "@/components/auth-guards";
import { MustChangePassword } from "@/components/auth/must-change-password";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { PageAccess } from "@/components/app-shell/page-access";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <SidebarProvider>
        <AppSidebar />
        {/* min-w-0 lets wide tables scroll inside their own box instead of widening the page. */}
        <SidebarInset className="min-w-0">
          {/* No empty top bar: on desktop the menu toggle lives in the sidebar (theme is in the user menu); phones get a small floating one. */}
          <SidebarTrigger className="fixed left-2 top-2 z-30 size-8 bg-background/90 shadow-sm md:hidden" />
          <main className="flex flex-1 flex-col gap-5 p-3 max-md:pt-12 sm:p-4 md:px-6 md:py-5">
            <StaffOnly>
              <PageAccess>{children}</PageAccess>
            </StaffOnly>
          </main>
        </SidebarInset>
      </SidebarProvider>
      <MustChangePassword />
    </RequireAuth>
  );
}
