"use client";

import { use } from "react";
import { LabFormPage } from "@/components/b2b/lab-form-page";

export default function EditLabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <LabFormPage labId={id} />;
}
