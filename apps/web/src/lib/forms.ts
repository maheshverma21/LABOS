import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import { ApiError } from "./api";

/**
 * Shows an API error on the form: field errors go under their inputs,
 * anything else becomes a toast.
 */
export function showFormError<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>) {
  if (err instanceof ApiError) {
    const fields = Object.entries(err.fields ?? {});
    fields.forEach(([name, messages], i) => {
      if (messages[0]) {
        // Focus the first one so it scrolls into view in long forms and dialogs.
        setError(name as Path<T>, { type: "server", message: messages[0] }, { shouldFocus: i === 0 });
      }
    });
    if (fields.length === 0) toast.error(err.message);
    return;
  }
  toast.error("Could not reach the server. Check your connection and try again.");
}
