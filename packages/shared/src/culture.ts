import { z } from "zod";

// ---------------------------------------------------------------------------
// Culture & sensitivity tests.
//
// A culture test has no numeric parameters. Instead its catalog entry carries a
// CultureConfig (the antibiotics that can be reported, a no-growth template),
// and each order's result is a CultureResult: either "no growth" or one or
// more organisms, each with a sensitivity table.
//
// Antibiotic lists below are common practice panels to save typing. The lab's
// microbiologist must review them against current CLSI / EUCAST guidance.
// ---------------------------------------------------------------------------

export const REPORT_KINDS = ["STANDARD", "CULTURE"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const SENSITIVITY_RESULTS = ["S", "I", "R", "SDD"] as const;
export type SensitivityResult = (typeof SENSITIVITY_RESULTS)[number];

export const SENSITIVITY_LABEL: Record<SensitivityResult, string> = {
  S: "Sensitive",
  I: "Intermediate",
  R: "Resistant",
  SDD: "Susceptible, dose dependent",
};

export const CULTURE_OUTCOMES = ["NO_GROWTH", "GROWTH"] as const;
export type CultureOutcome = (typeof CULTURE_OUTCOMES)[number];

export const CULTURE_OUTCOME_LABEL: Record<CultureOutcome, string> = {
  NO_GROWTH: "No growth",
  GROWTH: "Growth of organism(s)",
};

// --- Presets ----------------------------------------------------------------

export interface AntibioticPreset {
  name: string;
  /** Antibiotic class, used to group the list. */
  group: string;
}

const ab = (group: string, names: string[]): AntibioticPreset[] => names.map((name) => ({ name, group }));

export const ANTIBIOTIC_GROUPS: { group: string; items: AntibioticPreset[] }[] = [
  { group: "Penicillins", items: ab("Penicillins", ["Penicillin G", "Ampicillin", "Amoxicillin", "Amoxicillin-Clavulanate", "Piperacillin-Tazobactam", "Oxacillin", "Cloxacillin"]) },
  { group: "Cephalosporins", items: ab("Cephalosporins", ["Cefazolin", "Cefuroxime", "Cefoxitin", "Cefixime", "Ceftriaxone", "Cefotaxime", "Ceftazidime", "Cefepime", "Cefoperazone-Sulbactam"]) },
  { group: "Carbapenems", items: ab("Carbapenems", ["Imipenem", "Meropenem", "Ertapenem"]) },
  { group: "Aminoglycosides", items: ab("Aminoglycosides", ["Gentamicin", "Amikacin", "Tobramycin", "Netilmicin"]) },
  { group: "Fluoroquinolones", items: ab("Fluoroquinolones", ["Ciprofloxacin", "Levofloxacin", "Ofloxacin", "Norfloxacin", "Moxifloxacin"]) },
  { group: "Macrolides & Lincosamides", items: ab("Macrolides & Lincosamides", ["Azithromycin", "Erythromycin", "Clarithromycin", "Clindamycin"]) },
  { group: "Glycopeptides & Others", items: ab("Glycopeptides & Others", ["Vancomycin", "Teicoplanin", "Linezolid", "Daptomycin", "Colistin", "Polymyxin B", "Tigecycline", "Chloramphenicol", "Fusidic Acid"]) },
  { group: "Tetracyclines", items: ab("Tetracyclines", ["Tetracycline", "Doxycycline", "Minocycline"]) },
  { group: "Urinary & Others", items: ab("Urinary & Others", ["Nitrofurantoin", "Fosfomycin", "Co-trimoxazole (Trimethoprim-Sulfamethoxazole)", "Trimethoprim", "Metronidazole", "Rifampicin"]) },
  { group: "Antifungals", items: ab("Antifungals", ["Fluconazole", "Voriconazole", "Itraconazole", "Amphotericin B", "Caspofungin", "Micafungin"]) },
];

const pick = (...names: string[]): AntibioticPreset[] => {
  const all = ANTIBIOTIC_GROUPS.flatMap((g) => g.items);
  return names.map((n) => all.find((a) => a.name === n)).filter((a): a is AntibioticPreset => !!a);
};

/** One-click starting lists for the usual specimen types. */
export const ANTIBIOTIC_PANELS: { key: string; label: string; items: AntibioticPreset[] }[] = [
  {
    key: "URINE",
    label: "Urine (UTI)",
    items: pick("Amoxicillin-Clavulanate", "Cefixime", "Ceftriaxone", "Ceftazidime", "Cefoperazone-Sulbactam", "Piperacillin-Tazobactam", "Gentamicin", "Amikacin", "Ciprofloxacin", "Levofloxacin", "Norfloxacin", "Nitrofurantoin", "Fosfomycin", "Co-trimoxazole (Trimethoprim-Sulfamethoxazole)", "Imipenem", "Meropenem", "Colistin"),
  },
  {
    key: "GRAM_NEG",
    label: "Gram-negative bacilli (general)",
    items: pick("Ampicillin", "Amoxicillin-Clavulanate", "Piperacillin-Tazobactam", "Cefotaxime", "Ceftriaxone", "Ceftazidime", "Cefepime", "Cefoperazone-Sulbactam", "Imipenem", "Meropenem", "Ertapenem", "Gentamicin", "Amikacin", "Ciprofloxacin", "Levofloxacin", "Co-trimoxazole (Trimethoprim-Sulfamethoxazole)", "Tigecycline", "Colistin"),
  },
  {
    key: "GRAM_POS",
    label: "Gram-positive cocci (general)",
    items: pick("Penicillin G", "Cefoxitin", "Oxacillin", "Gentamicin", "Ciprofloxacin", "Levofloxacin", "Erythromycin", "Azithromycin", "Clindamycin", "Tetracycline", "Doxycycline", "Co-trimoxazole (Trimethoprim-Sulfamethoxazole)", "Vancomycin", "Teicoplanin", "Linezolid", "Rifampicin", "Chloramphenicol"),
  },
  {
    key: "BLOOD",
    label: "Blood / sterile sites",
    items: pick("Ampicillin", "Piperacillin-Tazobactam", "Ceftriaxone", "Ceftazidime", "Cefepime", "Cefoperazone-Sulbactam", "Imipenem", "Meropenem", "Gentamicin", "Amikacin", "Ciprofloxacin", "Levofloxacin", "Co-trimoxazole (Trimethoprim-Sulfamethoxazole)", "Vancomycin", "Teicoplanin", "Linezolid", "Clindamycin", "Colistin", "Tigecycline"),
  },
  {
    key: "STOOL",
    label: "Stool (enteric pathogens)",
    items: pick("Ampicillin", "Ceftriaxone", "Cefixime", "Ciprofloxacin", "Ofloxacin", "Azithromycin", "Chloramphenicol", "Co-trimoxazole (Trimethoprim-Sulfamethoxazole)", "Gentamicin", "Norfloxacin", "Tetracycline", "Doxycycline"),
  },
  {
    key: "SWAB",
    label: "Pus / wound / swab",
    items: pick("Amoxicillin-Clavulanate", "Cefoxitin", "Cefuroxime", "Ceftriaxone", "Ceftazidime", "Piperacillin-Tazobactam", "Imipenem", "Meropenem", "Gentamicin", "Amikacin", "Ciprofloxacin", "Levofloxacin", "Clindamycin", "Erythromycin", "Co-trimoxazole (Trimethoprim-Sulfamethoxazole)", "Vancomycin", "Linezolid", "Colistin"),
  },
  {
    key: "FUNGAL",
    label: "Fungal (yeast)",
    items: pick("Fluconazole", "Voriconazole", "Itraconazole", "Amphotericin B", "Caspofungin", "Micafungin"),
  },
];

/** Organisms offered as quick picks when entering a result (free text is always allowed). */
export const ORGANISM_PRESETS = [
  "Escherichia coli",
  "Klebsiella pneumoniae",
  "Klebsiella oxytoca",
  "Proteus mirabilis",
  "Pseudomonas aeruginosa",
  "Acinetobacter baumannii",
  "Enterobacter species",
  "Citrobacter species",
  "Serratia marcescens",
  "Salmonella Typhi",
  "Salmonella Paratyphi A",
  "Shigella species",
  "Vibrio cholerae",
  "Staphylococcus aureus",
  "Methicillin-resistant Staphylococcus aureus (MRSA)",
  "Coagulase-negative Staphylococcus (CoNS)",
  "Staphylococcus saprophyticus",
  "Enterococcus faecalis",
  "Enterococcus faecium",
  "Streptococcus pyogenes (Group A)",
  "Streptococcus pneumoniae",
  "Streptococcus agalactiae (Group B)",
  "Candida albicans",
  "Candida tropicalis",
  "Candida glabrata (Nakaseomyces glabratus)",
  "Candida species",
  "Mixed growth (> 2 organisms) suggestive of contamination",
] as const;

/** Colony count choices; the field is free text so labs can type their own. */
export const COLONY_COUNT_PRESETS = [
  "> 10^5 CFU/mL (significant)",
  "10^4 - 10^5 CFU/mL",
  "< 10^4 CFU/mL",
  "Heavy growth",
  "Moderate growth",
  "Scanty growth",
] as const;

/** The no-growth wording for each sample type; the lab edits it per test. */
export const NO_GROWTH_TEMPLATES: Record<string, string> = {
  URINE: "No growth of pathogenic organisms after 48 hours of aerobic incubation at 37°C.",
  WB_EDTA: "No growth after 5 days of incubation at 37°C.",
  CSF: "No growth after 48 hours of aerobic incubation at 37°C.",
  BODY_FLUID: "No growth after 48 hours of aerobic incubation at 37°C.",
  STOOL: "No Salmonella, Shigella, Vibrio or other enteric pathogens isolated after 48 hours of incubation.",
  SWAB: "No growth of pathogenic organisms after 48 hours of aerobic incubation at 37°C.",
  OTHER: "No growth after 48 hours of aerobic incubation at 37°C.",
};
export const noGrowthTemplateFor = (sampleType: string) => NO_GROWTH_TEMPLATES[sampleType] ?? NO_GROWTH_TEMPLATES.OTHER!;

export const DEFAULT_SENSITIVITY_FOOTNOTE =
  "S = Sensitive, I = Intermediate, R = Resistant. Antimicrobial susceptibility tested by Kirby-Bauer disk diffusion as per CLSI guidelines.";

// --- Catalog config (stored on the test) ------------------------------------

export const cultureAntibioticSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  group: z
    .string()
    .trim()
    .max(60)
    .nullable()
    .optional()
    .transform((v) => v || null),
});

export const cultureConfigSchema = z
  .object({
    antibiotics: z.array(cultureAntibioticSchema).max(80).default([]),
    /** Printed when the result is "No growth". */
    noGrowthText: z.string().trim().min(1, "Add the no-growth wording").max(500),
    /** Printed under the sensitivity table. */
    footnote: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .optional()
      .transform((v) => v || null),
    /** Show a zone-of-inhibition (mm) / MIC column in the sensitivity table. */
    showMeasure: z.boolean().default(true),
  })
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    c.antibiotics.forEach((a, i) => {
      const k = a.name.toLowerCase();
      if (seen.has(k)) ctx.addIssue({ code: "custom", path: ["antibiotics", i, "name"], message: "Already in the list" });
      seen.add(k);
    });
  });
export type CultureConfig = z.output<typeof cultureConfigSchema>;
export type CultureConfigInput = z.input<typeof cultureConfigSchema>;

export const newCultureConfig = (sampleType = "URINE"): CultureConfigInput => ({
  antibiotics: (ANTIBIOTIC_PANELS.find((p) => p.key === sampleType)?.items ?? ANTIBIOTIC_PANELS[1]!.items).map((a) => ({ ...a })),
  noGrowthText: noGrowthTemplateFor(sampleType),
  footnote: DEFAULT_SENSITIVITY_FOOTNOTE,
  showMeasure: true,
});

// --- Result (stored on the order's test) ------------------------------------

export const cultureSensitivitySchema = z.object({
  antibiotic: z.string().trim().min(1).max(80),
  result: z.enum(SENSITIVITY_RESULTS),
  /** Zone diameter in mm, or MIC, as typed ("22", "<=0.5"). */
  measure: z
    .string()
    .trim()
    .max(20)
    .nullable()
    .optional()
    .transform((v) => v || null),
});

export const cultureOrganismSchema = z.object({
  name: z.string().trim().min(1, "Organism name is required").max(120),
  colonyCount: z
    .string()
    .trim()
    .max(80)
    .nullable()
    .optional()
    .transform((v) => v || null),
  /** Antibiotics left out here simply aren't reported for this organism. */
  sensitivities: z.array(cultureSensitivitySchema).max(80).default([]),
});

export const cultureResultSchema = z
  .object({
    outcome: z.enum(CULTURE_OUTCOMES),
    /** The wording printed for "No growth" (from the test's template, editable per order). */
    noGrowthText: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .optional()
      .transform((v) => v || null),
    organisms: z.array(cultureOrganismSchema).max(6).default([]),
    /** Direct smear / Gram stain or other microscopy remarks, printed above the result. */
    microscopy: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .optional()
      .transform((v) => v || null),
  })
  .superRefine((r, ctx) => {
    if (r.outcome === "GROWTH" && r.organisms.length === 0) {
      ctx.addIssue({ code: "custom", path: ["organisms"], message: "Add at least one organism" });
    }
    r.organisms.forEach((o, i) => {
      const seen = new Set<string>();
      o.sensitivities.forEach((s, j) => {
        const k = s.antibiotic.toLowerCase();
        if (seen.has(k)) ctx.addIssue({ code: "custom", path: ["organisms", i, "sensitivities", j, "antibiotic"], message: "Listed twice" });
        seen.add(k);
      });
    });
  })
  .transform((r) => (r.outcome === "NO_GROWTH" ? { ...r, organisms: [] } : r));
export type CultureResult = z.output<typeof cultureResultSchema>;
export type CultureResultInput = z.input<typeof cultureResultSchema>;

/** Counts resistant results across an organism, e.g. to highlight multi-drug resistance. */
export const resistantCount = (o: { sensitivities: { result: SensitivityResult }[] }) =>
  o.sensitivities.filter((s) => s.result === "R").length;
