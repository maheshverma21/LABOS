/**
 * A starter catalog of common tests that a new lab can import in one click.
 *
 * IMPORTANT: reference ranges depend on the analyzer, reagents, method and
 * population. These are typical ADULT (18+) textbook values to save typing,
 * not validated ranges. Each lab's pathologist must review them, and add
 * paediatric ranges, before reporting. Prices start at 0 for the lab to set.
 */
import { newCultureConfig, type CultureConfigInput, type ParameterInput, type ReferenceRangeInput, type SampleTypeKey } from "@lms/shared";

const ADULT = 18 * 365;

interface StarterTest {
  code: string;
  name: string;
  department: string;
  sampleType: SampleTypeKey;
  method?: string;
  tatHours: number;
  reportNotes?: string;
  parameters: ParameterInput[];
  /** Culture & sensitivity tests: antibiotic list and no-growth wording. They have no parameters. */
  culture?: CultureConfigInput;
}

interface StarterPanel {
  code: string;
  name: string;
  department: string;
  sampleType: SampleTypeKey;
  tatHours: number;
  testCodes: string[];
}

// --- small builders ---------------------------------------------------------

type Limits = { low?: number; high?: number; critLow?: number; critHigh?: number };

const adult = (l: Limits, sex: "ANY" | "MALE" | "FEMALE" = "ANY"): ReferenceRangeInput => ({
  sex,
  ageMinDays: ADULT,
  low: l.low ?? null,
  high: l.high ?? null,
  criticalLow: l.critLow ?? null,
  criticalHigh: l.critHigh ?? null,
});

const bySex = (male: Limits, female: Limits): ReferenceRangeInput[] => [adult(male, "MALE"), adult(female, "FEMALE")];

const textRange = (text: string): ReferenceRangeInput => ({ sex: "ANY", text });

const num = (
  code: string,
  name: string,
  unit: string | null,
  decimals: number,
  ranges: ReferenceRangeInput[],
  formula?: string,
): ParameterInput => ({ code, name, unit, decimals, resultType: "NUMERIC", ranges, formula: formula ?? null });

const opts = (code: string, name: string, options: string[], normal?: string): ParameterInput => ({
  code,
  name,
  resultType: "OPTIONS",
  options,
  decimals: 0,
  ranges: normal ? [textRange(normal)] : [],
});

const text = (code: string, name: string, unit: string | null, normal?: string): ParameterInput => ({
  code,
  name,
  unit,
  resultType: "TEXT",
  decimals: 0,
  ranges: normal ? [textRange(normal)] : [],
});

const NEG_POS = ["Negative", "Positive"];
const NIL_TO_4 = ["Nil", "Trace", "1+", "2+", "3+", "4+"];
const WIDAL_TITRES = ["< 1:20", "1:20", "1:40", "1:80", "1:160", "1:320", "1:640"];

// --- departments --------------------------------------------------------------

export const STARTER_DEPARTMENTS = [
  "Haematology",
  "Biochemistry",
  "Endocrinology",
  "Clinical Pathology",
  "Serology & Immunology",
  "Microbiology",
  "Health Packages",
];

// --- tests --------------------------------------------------------------------

export const STARTER_TESTS: StarterTest[] = [
  // Haematology
  {
    code: "CBC",
    name: "Complete Blood Count (CBC)",
    department: "Haematology",
    sampleType: "WB_EDTA",
    method: "Automated cell counter",
    tatHours: 6,
    parameters: [
      num("HB", "Haemoglobin", "g/dL", 1, bySex({ low: 13, high: 17, critLow: 7, critHigh: 20 }, { low: 12, high: 15, critLow: 7, critHigh: 20 })),
      num("RBC", "Total RBC count", "mill/µL", 2, bySex({ low: 4.5, high: 5.5 }, { low: 3.8, high: 4.8 })),
      num("PCV", "Packed cell volume (PCV)", "%", 1, bySex({ low: 40, high: 50 }, { low: 36, high: 46 })),
      num("MCV", "MCV", "fL", 1, [adult({ low: 83, high: 101 })]),
      num("MCH", "MCH", "pg", 1, [adult({ low: 27, high: 32 })]),
      num("MCHC", "MCHC", "g/dL", 1, [adult({ low: 31.5, high: 34.5 })]),
      num("RDW", "RDW-CV", "%", 1, [adult({ low: 11.6, high: 14 })]),
      num("TLC", "Total leucocyte count", "10³/µL", 2, [adult({ low: 4, high: 10, critLow: 2, critHigh: 30 })]),
      num("NEUT", "Neutrophils", "%", 0, [adult({ low: 40, high: 80 })]),
      num("LYMPH", "Lymphocytes", "%", 0, [adult({ low: 20, high: 40 })]),
      num("MONO", "Monocytes", "%", 0, [adult({ low: 2, high: 10 })]),
      num("EOS", "Eosinophils", "%", 0, [adult({ low: 1, high: 6 })]),
      num("BASO", "Basophils", "%", 0, [adult({ low: 0, high: 2 })]),
      num("PLT", "Platelet count", "10³/µL", 0, [adult({ low: 150, high: 410, critLow: 20, critHigh: 1000 })]),
    ],
  },
  {
    code: "ESR",
    name: "Erythrocyte Sedimentation Rate (ESR)",
    department: "Haematology",
    sampleType: "WB_EDTA",
    method: "Westergren",
    tatHours: 4,
    parameters: [num("ESR", "ESR", "mm/1st hr", 0, bySex({ low: 0, high: 15 }, { low: 0, high: 20 }))],
  },
  {
    code: "BGRH",
    name: "Blood Group (ABO & Rh)",
    department: "Haematology",
    sampleType: "WB_EDTA",
    method: "Slide / tube agglutination",
    tatHours: 2,
    parameters: [opts("ABO", "ABO group", ["A", "B", "AB", "O"]), opts("RH", "Rh (D) type", ["Positive", "Negative"])],
  },

  // Biochemistry
  {
    code: "FBS",
    name: "Glucose, Fasting",
    department: "Biochemistry",
    sampleType: "PLASMA_FLUORIDE",
    method: "Hexokinase / GOD-POD",
    tatHours: 4,
    parameters: [num("GLU", "Glucose, fasting", "mg/dL", 0, [adult({ low: 70, high: 100, critLow: 50, critHigh: 400 })])],
  },
  {
    code: "PPBS",
    name: "Glucose, Post Prandial (2 hr)",
    department: "Biochemistry",
    sampleType: "PLASMA_FLUORIDE",
    method: "Hexokinase / GOD-POD",
    tatHours: 4,
    parameters: [num("GLU", "Glucose, 2 hr post prandial", "mg/dL", 0, [adult({ low: 70, high: 140, critLow: 50, critHigh: 400 })])],
  },
  {
    code: "RBS",
    name: "Glucose, Random",
    department: "Biochemistry",
    sampleType: "PLASMA_FLUORIDE",
    method: "Hexokinase / GOD-POD",
    tatHours: 2,
    parameters: [num("GLU", "Glucose, random", "mg/dL", 0, [adult({ low: 70, high: 140, critLow: 50, critHigh: 400 })])],
  },
  {
    code: "HBA1C",
    name: "HbA1c (Glycated Haemoglobin)",
    department: "Biochemistry",
    sampleType: "WB_EDTA",
    method: "HPLC",
    tatHours: 8,
    reportNotes: "Below 5.7%: normal. 5.7 to 6.4%: prediabetes. 6.5% or above: diabetes (ADA criteria).",
    parameters: [num("HBA1C", "HbA1c", "%", 1, [adult({ low: 4, high: 5.6 })])],
  },
  {
    code: "LIPID",
    name: "Lipid Profile",
    department: "Biochemistry",
    sampleType: "SERUM",
    method: "Enzymatic",
    tatHours: 8,
    reportNotes: "Fasting sample of 10 to 12 hours preferred. LDL and VLDL are calculated (Friedewald) and not valid when triglycerides exceed 400 mg/dL.",
    parameters: [
      num("TCHOL", "Total cholesterol", "mg/dL", 0, [adult({ high: 200 })]),
      num("TG", "Triglycerides", "mg/dL", 0, [adult({ high: 150 })]),
      num("HDL", "HDL cholesterol", "mg/dL", 0, [adult({ low: 40 })]),
      num("LDL", "LDL cholesterol (calculated)", "mg/dL", 0, [adult({ high: 100 })], "TCHOL - HDL - TG / 5"),
      num("VLDL", "VLDL cholesterol (calculated)", "mg/dL", 0, [adult({ low: 5, high: 30 })], "TG / 5"),
      num("TCHDL", "Total cholesterol / HDL ratio", null, 1, [adult({ high: 5 })], "TCHOL / HDL"),
    ],
  },
  {
    code: "LFT",
    name: "Liver Function Test (LFT)",
    department: "Biochemistry",
    sampleType: "SERUM",
    method: "Automated chemistry analyzer",
    tatHours: 8,
    parameters: [
      num("TBIL", "Bilirubin, total", "mg/dL", 2, [adult({ low: 0.3, high: 1.2 })]),
      num("DBIL", "Bilirubin, direct", "mg/dL", 2, [adult({ low: 0, high: 0.3 })]),
      num("IBIL", "Bilirubin, indirect (calculated)", "mg/dL", 2, [adult({ low: 0.1, high: 1 })], "TBIL - DBIL"),
      num("AST", "AST (SGOT)", "U/L", 0, bySex({ high: 40 }, { high: 32 })),
      num("ALT", "ALT (SGPT)", "U/L", 0, bySex({ high: 41 }, { high: 33 })),
      num("ALP", "Alkaline phosphatase", "U/L", 0, bySex({ low: 40, high: 129 }, { low: 35, high: 104 })),
      num("GGT", "Gamma GT", "U/L", 0, bySex({ low: 10, high: 71 }, { low: 6, high: 42 })),
      num("TP", "Total protein", "g/dL", 1, [adult({ low: 6.4, high: 8.3 })]),
      num("ALB", "Albumin", "g/dL", 1, [adult({ low: 3.5, high: 5.2 })]),
      num("GLOB", "Globulin (calculated)", "g/dL", 1, [adult({ low: 2, high: 3.5 })], "TP - ALB"),
      num("AGR", "A/G ratio (calculated)", null, 2, [adult({ low: 1, high: 2.1 })], "ALB / (TP - ALB)"),
    ],
  },
  {
    code: "KFT",
    name: "Kidney Function Test (KFT)",
    department: "Biochemistry",
    sampleType: "SERUM",
    method: "Automated chemistry analyzer",
    tatHours: 8,
    parameters: [
      num("UREA", "Urea", "mg/dL", 0, [adult({ low: 17, high: 43 })]),
      num("BUN", "Blood urea nitrogen (calculated)", "mg/dL", 1, [adult({ low: 7, high: 20 })], "UREA / 2.14"),
      num("CREAT", "Creatinine", "mg/dL", 2, bySex({ low: 0.7, high: 1.3 }, { low: 0.6, high: 1.1 })),
      num("UA", "Uric acid", "mg/dL", 1, bySex({ low: 3.5, high: 7.2 }, { low: 2.6, high: 6 })),
      num("CA", "Calcium", "mg/dL", 1, [adult({ low: 8.6, high: 10.3, critLow: 6.5, critHigh: 13 })]),
      num("PHOS", "Phosphorus", "mg/dL", 1, [adult({ low: 2.5, high: 4.5 })]),
    ],
  },
  {
    code: "ELEC",
    name: "Serum Electrolytes",
    department: "Biochemistry",
    sampleType: "SERUM",
    method: "Ion selective electrode",
    tatHours: 4,
    parameters: [
      num("NA", "Sodium", "mmol/L", 0, [adult({ low: 136, high: 145, critLow: 120, critHigh: 160 })]),
      num("K", "Potassium", "mmol/L", 1, [adult({ low: 3.5, high: 5.1, critLow: 2.8, critHigh: 6.2 })]),
      num("CL", "Chloride", "mmol/L", 0, [adult({ low: 98, high: 107 })]),
    ],
  },

  // Endocrinology
  {
    code: "TFT",
    name: "Thyroid Profile (T3, T4, TSH)",
    department: "Endocrinology",
    sampleType: "SERUM",
    method: "CLIA",
    tatHours: 12,
    parameters: [
      num("T3", "Total T3", "ng/dL", 0, [adult({ low: 80, high: 200 })]),
      num("T4", "Total T4", "µg/dL", 1, [adult({ low: 5.1, high: 14.1 })]),
      num("TSH", "TSH", "µIU/mL", 2, [adult({ low: 0.27, high: 4.2 })]),
    ],
  },
  {
    code: "TSH",
    name: "TSH (Ultrasensitive)",
    department: "Endocrinology",
    sampleType: "SERUM",
    method: "CLIA",
    tatHours: 12,
    parameters: [num("TSH", "TSH", "µIU/mL", 2, [adult({ low: 0.27, high: 4.2 })])],
  },
  {
    code: "VITD",
    name: "Vitamin D (25-OH)",
    department: "Endocrinology",
    sampleType: "SERUM",
    method: "CLIA",
    tatHours: 24,
    reportNotes: "Below 20 ng/mL: deficient. 20 to 29 ng/mL: insufficient. 30 to 100 ng/mL: sufficient.",
    parameters: [num("VITD", "25-OH Vitamin D", "ng/mL", 1, [adult({ low: 30, high: 100 })])],
  },
  {
    code: "B12",
    name: "Vitamin B12",
    department: "Endocrinology",
    sampleType: "SERUM",
    method: "CLIA",
    tatHours: 24,
    parameters: [num("B12", "Vitamin B12", "pg/mL", 0, [adult({ low: 197, high: 771 })])],
  },

  // Clinical pathology
  {
    code: "URINE",
    name: "Urine Routine & Microscopy",
    department: "Clinical Pathology",
    sampleType: "URINE",
    method: "Dipstick and microscopy",
    tatHours: 4,
    parameters: [
      opts("COLOUR", "Colour", ["Pale yellow", "Yellow", "Dark yellow", "Amber", "Red", "Other"], "Pale yellow"),
      opts("APPEAR", "Appearance", ["Clear", "Slightly turbid", "Turbid"], "Clear"),
      num("PH", "pH", null, 1, [textRange("4.5 - 8.0")]),
      num("SG", "Specific gravity", null, 3, [{ sex: "ANY", low: 1.005, high: 1.03 }]),
      opts("PROT", "Protein", NIL_TO_4, "Nil"),
      opts("SUGAR", "Glucose", NIL_TO_4, "Nil"),
      opts("KET", "Ketones", NEG_POS, "Negative"),
      opts("BIL", "Bilirubin", NEG_POS, "Negative"),
      opts("BLOOD", "Blood", NEG_POS, "Negative"),
      text("PUS", "Pus cells", "/hpf", "0 - 5"),
      text("URBC", "Red blood cells", "/hpf", "0 - 2"),
      text("EPI", "Epithelial cells", "/hpf", "Few"),
      text("CASTS", "Casts", null, "Nil"),
      text("CRYST", "Crystals", null, "Nil"),
    ],
  },

  // Serology & immunology
  {
    code: "CRP",
    name: "C-Reactive Protein (Quantitative)",
    department: "Serology & Immunology",
    sampleType: "SERUM",
    method: "Immunoturbidimetry",
    tatHours: 6,
    parameters: [num("CRP", "CRP", "mg/L", 1, [adult({ high: 5 })])],
  },
  {
    code: "WIDAL",
    name: "Widal Test (Slide)",
    department: "Serology & Immunology",
    sampleType: "SERUM",
    method: "Slide agglutination",
    tatHours: 4,
    reportNotes: "A single titre is of limited value; a fourfold rise in paired samples is more significant.",
    parameters: [
      opts("STO", "S. Typhi O", WIDAL_TITRES, "Below 1:80"),
      opts("STH", "S. Typhi H", WIDAL_TITRES, "Below 1:80"),
      opts("SPAH", "S. Paratyphi AH", WIDAL_TITRES, "Below 1:80"),
      opts("SPBH", "S. Paratyphi BH", WIDAL_TITRES, "Below 1:80"),
    ],
  },
  {
    code: "NS1",
    name: "Dengue NS1 Antigen",
    department: "Serology & Immunology",
    sampleType: "SERUM",
    method: "Immunochromatography (rapid card)",
    tatHours: 2,
    parameters: [opts("NS1", "Dengue NS1 antigen", NEG_POS, "Negative")],
  },
  {
    code: "MPAG",
    name: "Malaria Antigen (Pf / Pv)",
    department: "Serology & Immunology",
    sampleType: "WB_EDTA",
    method: "Immunochromatography (rapid card)",
    tatHours: 2,
    parameters: [
      opts("PF", "Plasmodium falciparum", NEG_POS, "Negative"),
      opts("PV", "Plasmodium vivax", NEG_POS, "Negative"),
    ],
  },

  // Microbiology: culture & sensitivity. Antibiotic lists are common practice panels; the
  // microbiologist must review them against current CLSI / EUCAST guidance.
  {
    code: "UCS",
    name: "Urine Culture & Sensitivity",
    department: "Microbiology",
    sampleType: "URINE",
    method: "Semi-quantitative culture; Kirby-Bauer disk diffusion",
    tatHours: 72,
    parameters: [],
    culture: newCultureConfig("URINE"),
  },
  {
    code: "BCS",
    name: "Blood Culture & Sensitivity",
    department: "Microbiology",
    sampleType: "WB_EDTA",
    method: "Automated blood culture; Kirby-Bauer disk diffusion",
    tatHours: 120,
    parameters: [],
    culture: newCultureConfig("BLOOD"),
  },
  {
    code: "SCS",
    name: "Stool Culture & Sensitivity",
    department: "Microbiology",
    sampleType: "STOOL",
    method: "Culture on selective media; Kirby-Bauer disk diffusion",
    tatHours: 72,
    parameters: [],
    culture: newCultureConfig("STOOL"),
  },
  {
    code: "PCS",
    name: "Pus / Wound Swab Culture & Sensitivity",
    department: "Microbiology",
    sampleType: "SWAB",
    method: "Aerobic culture; Kirby-Bauer disk diffusion",
    tatHours: 72,
    parameters: [],
    culture: newCultureConfig("SWAB"),
  },
];

export const STARTER_PANELS: StarterPanel[] = [
  {
    code: "BHC",
    name: "Basic Health Checkup",
    department: "Health Packages",
    sampleType: "SERUM",
    tatHours: 24,
    testCodes: ["CBC", "FBS", "LIPID", "LFT", "KFT", "TSH", "URINE"],
  },
];
