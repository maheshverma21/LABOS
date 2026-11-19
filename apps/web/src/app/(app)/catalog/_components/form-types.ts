import { newCultureConfig, type ParameterInput, ReferenceRangeInput, TestDetail, TestInput } from "@lms/shared";

export type TestFormValues = TestInput;

export const blankRange = (): ReferenceRangeInput => ({
  sex: "ANY",
  ageMinDays: null,
  ageMaxDays: null,
  low: null,
  high: null,
  criticalLow: null,
  criticalHigh: null,
  text: "",
});

export const blankParameter = (): ParameterInput => ({
  code: "",
  name: "",
  unit: "",
  method: "",
  resultType: "NUMERIC",
  decimals: 1,
  options: [],
  formula: "",
  ranges: [blankRange()],
});

export function newTestValues(isPanel: boolean): TestFormValues {
  return {
    code: "",
    name: "",
    departmentId: "",
    isPanel,
    sampleType: (isPanel ? "SERUM" : "") as TestFormValues["sampleType"],
    container: "",
    method: "",
    tatHours: 24,
    pricePaise: 0,
    reportNotes: "",
    interpretation: "",
    reportKind: "STANDARD",
    cultureConfig: null,
    parameters: isPanel ? [] : [blankParameter()],
    panelTestIds: [],
  };
}

export function testToFormValues(t: TestDetail): TestFormValues {
  return {
    code: t.code,
    name: t.name,
    departmentId: t.departmentId,
    isPanel: t.isPanel,
    sampleType: t.sampleType as TestFormValues["sampleType"],
    container: t.container ?? "",
    method: t.method ?? "",
    tatHours: t.tatHours,
    pricePaise: t.pricePaise,
    reportNotes: t.reportNotes ?? "",
    interpretation: t.interpretation ?? "",
    reportKind: t.reportKind ?? "STANDARD",
    cultureConfig: t.cultureConfig,
    parameters: t.parameters.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      unit: p.unit ?? "",
      method: p.method ?? "",
      resultType: p.resultType,
      decimals: p.decimals,
      options: p.options,
      formula: p.formula ?? "",
      ranges: p.ranges.map((r) => ({
        sex: r.sex,
        ageMinDays: r.ageMinDays,
        ageMaxDays: r.ageMaxDays,
        low: r.low,
        high: r.high,
        criticalLow: r.criticalLow,
        criticalHigh: r.criticalHigh,
        text: r.text ?? "",
      })),
    })),
    panelTestIds: t.panelTests.map((pt) => pt.id),
  };
}

export { newCultureConfig };
