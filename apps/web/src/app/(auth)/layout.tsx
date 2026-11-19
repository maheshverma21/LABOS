import { CircleCheckIcon, FlaskConicalIcon } from "lucide-react";
import { RedirectIfAuthenticated } from "@/components/auth-guards";
import { ThemeToggle } from "@/components/theme-toggle";
import { APP_NAME } from "@/lib/brand";

const POINTS = [
  "Billing, barcodes and sample tracking",
  "Results with pathologist approval",
  "Signed reports delivered on WhatsApp",
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <RedirectIfAuthenticated>
      <div className="grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Brand panel: the same blue as the app's sidebar. */}
        <aside className="relative hidden overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex lg:flex-col">
          <div className="pointer-events-none absolute -top-24 right-0 size-80 translate-x-1/3 rounded-full bg-white/5" />
          <div className="pointer-events-none absolute -bottom-32 -left-24 size-96 rounded-full bg-white/5" />
          <div className="relative flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
              <FlaskConicalIcon className="size-6" />
            </div>
            <div className="leading-tight">
              <div className="text-lg font-semibold">{APP_NAME}</div>
              <div className="text-sm text-sidebar-foreground/75">Laboratory management</div>
            </div>
          </div>
          <div className="relative my-auto max-w-md space-y-6">
            <h2 className="text-3xl leading-tight font-semibold tracking-tight">From sample collection to a signed report, in one place.</h2>
            <ul className="space-y-3 text-sidebar-foreground/90">
              {POINTS.map((p) => (
                <li key={p} className="flex items-center gap-2.5">
                  <CircleCheckIcon className="size-4 shrink-0 text-sidebar-foreground/70" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <p className="relative text-sm text-sidebar-foreground/60">Built for diagnostic labs</p>
        </aside>

        <main className="relative flex flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
          <ThemeToggle className="absolute top-4 right-4" />
          {/* Phones: the brand panel is hidden, so show the name above the form. */}
          <div className="flex items-center gap-2 font-medium lg:hidden">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <FlaskConicalIcon className="size-4" />
            </div>
            {APP_NAME}
          </div>
          <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm md:p-8">{children}</div>
        </main>
      </div>
    </RedirectIfAuthenticated>
  );
}
