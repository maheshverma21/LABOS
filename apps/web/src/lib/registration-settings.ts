"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Defaults a front-desk user can preset for the Registration / Billing page. */
export type QuickSettings = {
  patientType: string;
  paymentMode: string;
  organisation: string;
  referral: string;
  otherReferral: string;
  consultingDoctor: string;
  reportCollectionType: string;
  additionalServices: string;
};

/** Which fields the registration page shows, and how. */
export type NameLayout = "full" | "split";
export type DisplaySettings = {
  nameLayout: NameLayout;
  /** Keys of REQUIRED_FIELD_OPTIONS that must be filled before a patient is saved. */
  requiredFields: string[];
  /** Keys of REGISTRATION_FIELDS hidden from the registration page. */
  hiddenFields: string[];
  /** Custom labels, keyed by REGISTRATION_FIELDS key. */
  fieldLabels: Record<string, string>;
};

/** Every field of the registration page, in page order. Locked ones can't be hidden. */
export const REGISTRATION_FIELDS: { key: string; label: string; locked?: boolean }[] = [
  { key: "patientId", label: "Patient ID", locked: true },
  { key: "patientType", label: "Select Patient Type" },
  { key: "salutation", label: "Designation" },
  { key: "name", label: "Patient Name", locked: true },
  { key: "sex", label: "Gender", locked: true },
  { key: "age", label: "Date of Birth / Age", locked: true },
  { key: "phone", label: "Contact Number" },
  { key: "phoneBelongsTo", label: "Phone Number Belongs To" },
  { key: "email", label: "Email" },
  { key: "referral", label: "Referral" },
  { key: "address", label: "Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "district", label: "District" },
  { key: "pincode", label: "Pincode" },
  { key: "passportNumber", label: "Passport Number" },
  { key: "country", label: "Country" },
  { key: "barcode", label: "Barcode No." },
];

/** Optional fields on the registration page that a lab can make mandatory. */
export const REQUIRED_FIELD_OPTIONS: { key: string; label: string }[] = [
  { key: "lastName", label: "Last Name" },
  { key: "phone", label: "Contact Number" },
  { key: "email", label: "Email ID" },
  { key: "address", label: "Address" },
  { key: "patientType", label: "Patient Type" },
  { key: "referral", label: "Referral" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "district", label: "District" },
  { key: "pincode", label: "Pincode" },
  { key: "passportNumber", label: "Passport Number" },
  { key: "country", label: "Country" },
  { key: "barcode", label: "Barcode No." },
];

/** Machine integration and barcode preferences (the "Integration" tab). */
export type IntegrationSettings = {
  /** Fields shown for machine integration: "machineReading", "barcode". */
  fieldsToShow: string[];
  autoGenerateBarcode: boolean;
  /** "patient", "sample", "department". */
  barcodeTypes: string[];
  /** "pathology". */
  printBarcode: string[];
};

export const INTEGRATION_FIELD_OPTIONS = [
  { key: "machineReading", label: "Machine Reading" },
];
export const BARCODE_TYPE_OPTIONS = [
  { key: "patient", label: "Patient Wise" },
  { key: "sample", label: "Sample Wise" },
  { key: "department", label: "Department Wise" },
];
export const PRINT_BARCODE_OPTIONS = [
  { key: "pathology", label: "Pathology" },
];

/** The barcode mode in force (the settings keep a list for older saves): patient > department > sample. */
export function barcodeMode(i: IntegrationSettings): "patient" | "sample" | "department" {
  if (i.barcodeTypes.includes("patient")) return "patient";
  if (i.barcodeTypes.includes("department")) return "department";
  return "sample";
}

export type RegistrationSettings = {
  quick: QuickSettings;
  display: DisplaySettings;
  integration: IntegrationSettings;
};

export const PATIENT_TYPE_OPTIONS = ["Regular", "VIP", "Staff", "Senior Citizen"];
export const PAYMENT_MODE_OPTIONS = ["Cash", "Card", "UPI", "Cheque", "Online", "Credit"];
export const REPORT_COLLECTION_OPTIONS = ["Self Collect", "Home Delivery", "Email", "WhatsApp"];
export const ADDITIONAL_SERVICE_OPTIONS = ["Home Collection", "Urgent Report", "Report Courier"];

export const DEFAULT_SETTINGS: RegistrationSettings = {
  quick: {
    patientType: "",
    paymentMode: "Cash",
    organisation: "DIRECT",
    referral: "SELF",
    otherReferral: "",
    consultingDoctor: "",
    reportCollectionType: "",
    additionalServices: "",
  },
  display: { nameLayout: "full", requiredFields: [], hiddenFields: [], fieldLabels: {} },
  integration: { fieldsToShow: ["machineReading", "barcode"], autoGenerateBarcode: true, barcodeTypes: ["patient"], printBarcode: ["pathology"] },
};

const KEY = "lms.registration-settings.v1";
const EVENT = "lms:registration-settings";
let cache: { raw: string | null; value: RegistrationSettings } | null = null;

export function loadRegistrationSettings(): RegistrationSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (cache && cache.raw === raw) return cache.value;
  let value = DEFAULT_SETTINGS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<RegistrationSettings>;
      value = {
        quick: { ...DEFAULT_SETTINGS.quick, ...(parsed.quick ?? {}) },
        display: { ...DEFAULT_SETTINGS.display, ...(parsed.display ?? {}) },
        integration: (() => {
          const i = { ...DEFAULT_SETTINGS.integration, ...(parsed.integration ?? {}) };
          return { ...i, printBarcode: i.printBarcode.filter((k) => k !== "radiology") };
        })(),
      };
    } catch {
      /* corrupt value: fall back to defaults */
    }
  }
  cache = { raw, value };
  return value;
}

export function saveRegistrationSettings(next: RegistrationSettings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable (private mode): settings last for this page only */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useRegistrationSettings() {
  const settings = useSyncExternalStore(subscribe, loadRegistrationSettings, () => DEFAULT_SETTINGS);
  const save = useCallback((next: RegistrationSettings) => saveRegistrationSettings(next), []);
  return [settings, save] as const;
}
