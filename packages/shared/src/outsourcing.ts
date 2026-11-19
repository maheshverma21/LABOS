import { z } from "zod";

/** Largest report file accepted back from an outsourced lab. */
export const OUTSOURCE_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const OUTSOURCE_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;

export const outsourceLabSchema = z.object({
  name: z.string().trim().min(2, "Enter the lab's name").max(80),
  /** Tests sent to this lab. Leave out to keep the current ones. */
  testIds: z.array(z.uuid()).max(3000).optional(),
});
export type OutsourceLabInput = z.input<typeof outsourceLabSchema>;

export const outsourceFileSchema = z.object({ addLetterhead: z.boolean() });

export const outsourceTestSchema = z.object({ labId: z.uuid().nullable() });

export interface OutsourceLabItem {
  id: string;
  name: string;
  testCount: number;
  tests: { id: string; code: string; name: string }[];
}

export interface OutsourceTestItem {
  id: string;
  code: string;
  name: string;
  department: string;
  labId: string | null;
}
