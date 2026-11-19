import type { WhatsappSettings } from "@lms/shared";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { decryptSecret } from "../../lib/secrets";
import { logger } from "../../lib/logger";
import { moduleDisabled } from "../../lib/limits";

/** Stored in tenant.settings.whatsapp. The key is encrypted. */
export interface StoredWhatsapp {
  enabled?: boolean;
  provider?: "own" | "shared";
  apiKeyEnc?: string | null;
  apiKeyHint?: string | null;
  campaignName?: string | null;
}

export const sharedAvailable = () => !!(env.AISENSY_API_KEY && env.AISENSY_CAMPAIGN);

type Settings = Record<string, unknown> & { whatsapp?: StoredWhatsapp; reportHeader?: unknown };

export async function readStored(tenantId: string): Promise<{ all: Settings; whatsapp: StoredWhatsapp }> {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  const all = (t.settings && typeof t.settings === "object" && !Array.isArray(t.settings) ? t.settings : {}) as Settings;
  return { all, whatsapp: all.whatsapp ?? {} };
}

export function toPublic(w: StoredWhatsapp): WhatsappSettings {
  return {
    enabled: !!w.enabled,
    provider: w.provider ?? "shared",
    campaignName: w.campaignName ?? null,
    apiKeyHint: w.apiKeyHint ?? null,
    sharedAvailable: sharedAvailable(),
  };
}

/** The AiSensy account to send with, or why there isn't one. */
export async function resolveAccount(
  tenantId: string,
): Promise<{ ok: true; apiKey: string; campaignName: string } | { ok: false; reason: string }> {
  if (await moduleDisabled(tenantId, "whatsapp")) return { ok: false, reason: "WhatsApp delivery isn't included for this lab. Contact support." };
  const { whatsapp: w } = await readStored(tenantId);
  if (!w.enabled) return { ok: false, reason: "WhatsApp isn't turned on for this lab. Turn it on in Settings, Lab profile." };
  if ((w.provider ?? "shared") === "shared") {
    if (!sharedAvailable()) return { ok: false, reason: "The shared WhatsApp account isn't set up on this server" };
    return { ok: true, apiKey: env.AISENSY_API_KEY!, campaignName: env.AISENSY_CAMPAIGN! };
  }
  const apiKey = decryptSecret(w.apiKeyEnc);
  if (!apiKey) return { ok: false, reason: "Add your AiSensy API key in Settings, Lab profile" };
  if (!w.campaignName) return { ok: false, reason: "Add your AiSensy campaign name in Settings, Lab profile" };
  return { ok: true, apiKey, campaignName: w.campaignName };
}

/**
 * Sends a campaign message through AiSensy's API campaign endpoint.
 * The campaign's template takes {{1}} patient name and {{2}} lab name, with a document header.
 */
export async function sendAisensy(input: {
  apiKey: string;
  campaignName: string;
  mobile: string;
  userName: string;
  templateParams: string[];
  media: { url: string; filename: string };
}): Promise<{ ok: true; ref: string | null } | { ok: false; error: string }> {
  try {
    const res = await fetch(env.AISENSY_API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKey: input.apiKey,
        campaignName: input.campaignName,
        destination: `91${input.mobile}`,
        userName: input.userName,
        source: "lab-report",
        templateParams: input.templateParams,
        media: input.media,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Not JSON; keep the raw text for the error message.
    }
    if (!res.ok || body.success === false || body.success === "false") {
      const msg = String(body.message ?? body.errorMessage ?? (text.slice(0, 200) || `HTTP ${res.status}`));
      return { ok: false, error: `WhatsApp provider: ${msg}` };
    }
    const ref = body.submitted_message_id ?? body.messageId ?? body.id;
    return { ok: true, ref: ref == null ? null : String(ref) };
  } catch (err) {
    logger.warn({ err }, "aisensy request failed");
    return { ok: false, error: err instanceof Error && err.name === "TimeoutError" ? "WhatsApp provider timed out" : "Couldn't reach the WhatsApp provider" };
  }
}
