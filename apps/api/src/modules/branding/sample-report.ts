import { prisma } from "../../lib/prisma";
import { formatDateTimeIST, type ReportData } from "../reports/report-data";

/**
 * A made-up report with the lab's real details, for previewing a template.
 * The person previewing signs it, so their own signature and stamp show up.
 */
export async function sampleReport(tenantId: string, userId: string): Promise<ReportData> {
  const [lab, branch, me] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { name: true, gstin: true, phone: true, email: true, tagline: true, address: true, website: true, accreditation: true, logoId: true },
    }),
    prisma.branch.findFirst({ where: { tenantId, type: "LAB", isActive: true }, orderBy: { createdAt: "asc" }, select: { name: true, address: true, phone: true } }),
    prisma.user.findFirstOrThrow({
      where: { id: userId, tenantId },
      select: { name: true, qualification: true, registrationNo: true, signatureId: true, stampId: true },
    }),
  ]);
  const now = new Date();
  const at = (minutesAgo: number) => formatDateTimeIST(new Date(now.getTime() - minutesAgo * 60_000));
  return {
    lab,
    branch,
    headerValues: {
      name: "Mrs. Sample Patient", ageSex: "34 Y / Female", uhid: "26111801", doctor: "Dr. Referring Doctor",
      patientType: "Regular", phone: "98XXXXXX00", email: "sample@example.com", address: "12 Sample Street", city: "Sample City",
      state: "Sample State", district: "Sample District", pincode: "000000", country: "India",
      passportNumber: "X0000000", orderNo: "SAMPLE-0001", barcode: "SAMPLE000101", branch: branch?.name ?? "Main Lab",
      registeredAt: at(300), collectedAt: at(290), receivedAt: at(240), reportedAt: at(10), reportStatus: "Final",
    },
    patient: { name: "Mrs. Sample Patient", uhid: "26111801", ageSex: "34 Y / Female", phone: null },
    order: { orderNo: "SAMPLE-0001", registeredAt: at(300), doctor: "Dr. Referring Doctor" },
    collectedAt: at(290),
    receivedAt: at(240),
    reportedAt: at(10),
    partial: false,
    amended: false,
    departments: [
      {
        name: "Haematology",
        tests: [
          {
            code: "CBC",
            name: "Complete Blood Count",
            amended: false,
            remarks: null,
            notes: null,
            rows: [
              { name: "Haemoglobin", value: "11.2", unit: "g/dL", flag: "LOW", range: "12.0 - 15.0" },
              { name: "Total leucocyte count", value: "7,800", unit: "/cumm", flag: "NORMAL", range: "4,000 - 11,000" },
              { name: "Platelet count", value: "2.4", unit: "lakh/cumm", flag: "NORMAL", range: "1.5 - 4.1" },
            ],
          },
        ],
      },
      {
        name: "Biochemistry",
        tests: [
          {
            code: "FBS",
            name: "Glucose, fasting",
            amended: false,
            remarks: null,
            notes: "Fasting of at least 8 hours is recommended.",
            rows: [{ name: "Glucose, fasting", value: "96", unit: "mg/dL", flag: "NORMAL", range: "70 - 100" }],
          },
        ],
      },
    ],
    signatories: [
      {
        name: me.name,
        qualification: me.qualification ?? "MD (Pathology)",
        registrationNo: me.registrationNo,
        signatureId: me.signatureId,
        stampId: me.stampId,
      },
    ],
  };
}
