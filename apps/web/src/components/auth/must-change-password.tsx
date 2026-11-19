"use client";

import { toast } from "sonner";
import { KeyRoundIcon } from "lucide-react";
import type { ChangePasswordInput, SessionUser } from "@lms/shared";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/providers/auth-provider";
import { api } from "@/lib/api";
import { ChangePasswordForm } from "./change-password-form";

export const changeOwnPassword = (values: ChangePasswordInput) =>
  api<{ user: SessionUser }>("/auth/change-password", { method: "POST", body: values });

/** After the owner sets a temporary password, nothing else works until the user picks their own. */
export function MustChangePassword() {
  const { user, refreshUser, logout } = useAuth();
  if (!user?.mustChangePassword) return null;
  return (
    <Dialog open>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-5" /> Choose your own password
          </DialogTitle>
          <DialogDescription>
            Your lab owner set a temporary password for you. Enter it below as the current password, then choose one only you know.
          </DialogDescription>
        </DialogHeader>
        <ChangePasswordForm
          submit={changeOwnPassword}
          submitLabel="Save my password"
          onDone={async () => {
            await refreshUser();
            toast.success("Password changed");
          }}
        />
        <button type="button" className="text-sm text-muted-foreground underline-offset-4 hover:underline" onClick={logout}>
          Sign out instead
        </button>
      </DialogContent>
    </Dialog>
  );
}
