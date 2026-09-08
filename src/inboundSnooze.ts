import { createHmac } from "node:crypto";
import { normalizeHost } from "./shareClient.js";

export type SnoozeRequest = {
  host: string;
  inboundToken: string;
  signingSecret: string;
  hours: number;
};

export function buildInboundUrl(host: string, token: string): string {
  const origin = normalizeHost(host);
  const t = token.trim();
  if (!t) throw new Error("inboundWebhookToken is required");
  return `${origin}/api/inbound/${encodeURIComponent(t)}`;
}

export function signInboundBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export async function postSnooze(
  req: SnoozeRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; members?: number }> {
  const hours = Number.isFinite(req.hours) ? Math.max(1, Math.min(168, req.hours)) : 24;
  const body = JSON.stringify({ action: "snooze", hours });
  const url = buildInboundUrl(req.host, req.inboundToken);
  const secret = req.signingSecret.trim();
  if (!secret) throw new Error("inboundSigningSecret is required for snooze");

  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "matterbridge-thermaltrace/0.1.0",
      "X-ThermalTrace-Signature": signInboundBody(secret, body),
      "X-Signature": signInboundBody(secret, body),
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Inbound snooze HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
  }

  return (await res.json()) as { ok: true; members?: number };
}
