import { z } from "zod";

// ---------------------------------------------------------------------------
// Analyzers that send results to LabOS
// ---------------------------------------------------------------------------

export const INSTRUMENT_PROTOCOLS = ["ASTM", "HL7"] as const;
export type InstrumentProtocol = (typeof INSTRUMENT_PROTOCOLS)[number];

export const INSTRUMENT_CONNECTIONS = ["LISTEN", "CONNECT"] as const;
export type InstrumentConnection = (typeof INSTRUMENT_CONNECTIONS)[number];

export const INSTRUMENT_PROTOCOL_LABEL: Record<InstrumentProtocol, string> = {
  ASTM: "ASTM (E1381 / E1394)",
  HL7: "HL7 v2",
};

export const INSTRUMENT_CONNECTION_LABEL: Record<InstrumentConnection, string> = {
  LISTEN: "The analyzer connects to this PC",
  CONNECT: "This PC connects to the analyzer",
};

export const INSTRUMENT_CONNECTION_HINT: Record<InstrumentConnection, string> = {
  LISTEN: "Most analyzers work this way. On the analyzer's LIS settings, enter this PC's IP address and the port below.",
  CONNECT: "For analyzers set up as a server. Enter the analyzer's IP address and the port shown in its LIS settings.",
};

const optionalLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v || null);

export const instrumentSchema = z
  .object({
    name: z.string().trim().min(2, "Give it a name").max(60),
    model: optionalLine(80),
    protocol: z.enum(INSTRUMENT_PROTOCOLS),
    connection: z.enum(INSTRUMENT_CONNECTIONS),
    host: optionalLine(255),
    port: z.coerce.number().int().min(1024, "Use a port from 1024 to 65535").max(65535, "Use a port from 1024 to 65535"),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.connection === "CONNECT" && !v.host) {
      ctx.addIssue({ code: "custom", path: ["host"], message: "Enter the analyzer's IP address" });
    }
  });
export type InstrumentInput = z.input<typeof instrumentSchema>;

export const instrumentMappingSchema = z.object({
  analyzerCode: z.string().trim().min(1, "Enter the analyzer's code").max(40),
  parameterId: z.uuid("Pick a test parameter"),
  factor: z.number().positive("Use a number above 0").nullable().optional().transform((v) => v ?? null),
});
export const instrumentMappingsSchema = z.object({ mappings: z.array(instrumentMappingSchema).max(500) });
export type InstrumentMappingInput = z.input<typeof instrumentMappingSchema>;

export interface InstrumentItem {
  id: string;
  name: string;
  model: string | null;
  protocol: InstrumentProtocol;
  connection: InstrumentConnection;
  host: string | null;
  port: number;
  isActive: boolean;
  lastSeenAt: string | null;
  mappingCount: number;
  messagesToday: number;
}

export interface InstrumentMappingItem {
  analyzerCode: string;
  parameterId: string;
  factor: number | null;
  parameter: { code: string; name: string; unit: string | null; test: string } | null;
}

/** A parameter that a machine value can fill, for the mapping picker. */
export interface MappableParameter {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  testCode: string;
  testName: string;
}

export const INSTRUMENT_MESSAGE_STATUSES = ["APPLIED", "PARTIAL", "NOT_APPLIED", "ERROR"] as const;
export type InstrumentMessageStatus = (typeof INSTRUMENT_MESSAGE_STATUSES)[number];
export const INSTRUMENT_MESSAGE_LABEL: Record<InstrumentMessageStatus, string> = {
  APPLIED: "Filled in",
  PARTIAL: "Partly filled in",
  NOT_APPLIED: "Not filled in",
  ERROR: "Couldn't read",
};

/** What happened to one value in a message. */
export interface InstrumentValueOutcome {
  code: string;
  value: string;
  unit: string | null;
  applied: boolean;
  /** Where it went, e.g. "CBC · Haemoglobin". */
  target: string | null;
  /** Why it didn't, e.g. "No test parameter for this code". */
  reason: string | null;
}

export interface InstrumentMessageItem {
  id: string;
  sampleId: string | null;
  orderId: string | null;
  orderNo: string | null;
  status: InstrumentMessageStatus;
  summary: string | null;
  detail: InstrumentValueOutcome[];
  raw: string;
  createdAt: string;
}

export interface InterfaceKeyItem {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export const interfaceKeySchema = z.object({ name: z.string().trim().min(2, "Give it a name, e.g. the PC it runs on").max(60) });

/** What the interface program needs to know: which analyzers to listen for. */
export interface InterfaceConfig {
  lab: string;
  instruments: Pick<InstrumentItem, "id" | "name" | "protocol" | "connection" | "host" | "port">[];
}

/** One message from the interface program: the analyzer's text, as received. */
export const interfaceMessageSchema = z.object({
  instrumentId: z.uuid(),
  raw: z.string().min(1).max(512 * 1024),
  receivedAt: z.iso.datetime().optional(),
});

export const interfaceHeartbeatSchema = z.object({
  /** Analyzers with an open connection right now. */
  connected: z.array(z.uuid()).max(100),
});
