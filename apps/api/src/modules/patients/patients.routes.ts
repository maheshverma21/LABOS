import { Router, type Request } from "express";
import { parseListFilters } from "../../lib/list-filters";
import {
  createPatientSchema,
  doctorSchema,
  doctorPriceListSchema,
  doctorStatusSchema,
  normalizeIndianMobile,
  patientSchema,
} from "@lms/shared";
import { authenticate, ctx, requirePermission } from "../../middleware/auth";
import { resolveBranchId } from "../../middleware/branch";
import { validateBody } from "../../middleware/validate";
import { badRequest } from "../../lib/errors";
import * as patients from "./patients.service";
import * as doctors from "./doctors.service";

async function actor(req: Request): Promise<patients.Actor> {
  const { auth } = ctx(req);
  return {
    tenantId: auth.tenantId,
    userId: auth.userId,
    branchId: await resolveBranchId(req),
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

const intParam = (v: unknown, fallback: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
};

const read = requirePermission("patients:read");
const write = requirePermission("patients:write");

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------

export const patientsRouter = Router();
patientsRouter.use(authenticate);

patientsRouter.get("/", read, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  res.json(
    await patients.searchPatients(
      ctx(req).db,
      q,
      intParam(req.query.page, 1, 10_000),
      intParam(req.query.pageSize, 25, 100),
      parseListFilters(req.query),
    ),
  );
});

patientsRouter.get("/next-id", read, async (req, res) => {
  res.json({ uhid: await patients.peekNextUhid(ctx(req).db) });
});

patientsRouter.get("/by-phone/:phone", read, async (req, res) => {
  const phone = normalizeIndianMobile(String(req.params.phone));
  if (!phone) throw badRequest("Enter a 10-digit mobile number");
  res.json({ patients: await patients.patientsByPhone(ctx(req).db, phone) });
});

patientsRouter.get("/:id", read, async (req, res) => {
  const patient = await patients.getPatient(ctx(req).db, String(req.params.id));
  patients.auditView(await actor(req), patient.id);
  res.json({ patient });
});

patientsRouter.post("/", write, validateBody(createPatientSchema), async (req, res) => {
  res.status(201).json({ patient: await patients.createPatient(ctx(req).db, await actor(req), req.body) });
});

patientsRouter.put("/:id", write, validateBody(patientSchema), async (req, res) => {
  res.json({ patient: await patients.updatePatient(ctx(req).db, await actor(req), String(req.params.id), req.body) });
});

// ---------------------------------------------------------------------------
// Referring doctors
// ---------------------------------------------------------------------------

export const doctorsRouter = Router();
doctorsRouter.use(authenticate);

doctorsRouter.get("/", read, async (req, res) => {
  res.json({
    doctors: await doctors.listDoctors(ctx(req).db, {
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      includeInactive: req.query.includeInactive === "true",
    }),
  });
});

doctorsRouter.post("/", write, validateBody(doctorSchema), async (req, res) => {
  res.status(201).json({ doctor: await doctors.createDoctor(ctx(req).db, await actor(req), req.body) });
});

doctorsRouter.put("/:id", write, validateBody(doctorSchema), async (req, res) => {
  res.json({ doctor: await doctors.updateDoctor(ctx(req).db, await actor(req), String(req.params.id), req.body) });
});

doctorsRouter.get("/:id/price-list", read, async (req, res) => {
  res.json({ priceList: await doctors.getDoctorPriceList(ctx(req).db, String(req.params.id)) });
});

doctorsRouter.put("/:id/price-list", write, validateBody(doctorPriceListSchema), async (req, res) => {
  res.json({ priceList: await doctors.saveDoctorPriceList(ctx(req).db, await actor(req), String(req.params.id), req.body) });
});

doctorsRouter.patch("/:id/status", write, validateBody(doctorStatusSchema), async (req, res) => {
  await doctors.setDoctorActive(ctx(req).db, await actor(req), String(req.params.id), req.body.isActive);
  res.status(204).end();
});
