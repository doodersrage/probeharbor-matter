/** Supported ThermalTrace sensor kinds for Matter mapping. */
export const MATTER_SENSOR_KINDS = [
  "temperature",
  "humidity",
  "flood",
  "door",
  "motion",
  "power",
] as const;

export type MatterSensorKind = (typeof MATTER_SENSOR_KINDS)[number];

export function isMatterSensorKind(kind: string): kind is MatterSensorKind {
  return (MATTER_SENSOR_KINDS as readonly string[]).includes(kind);
}

export type ShareReading = {
  device: string;
  key: string;
  label: string;
  kind: string;
  unit: string | null;
  value_num: number | null;
  value_bool: boolean | null;
  value_text: string | null;
  recorded_at: string;
};

export type ShareReadingsResponse = {
  scope: string;
  label: string | null;
  expires_at: string | null;
  readings: ShareReading[];
  devices?: Array<{
    name: string;
    last_seen_at: string | null;
    source: string;
    space: string | null;
  }>;
};

/** Extract share token from a bare token or full /share/… URL. */
export function normalizeShareToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    if (trimmed.includes("://") || trimmed.startsWith("/")) {
      const url = trimmed.includes("://")
        ? new URL(trimmed)
        : new URL(trimmed, "https://thermaltrace.dev");
      const parts = url.pathname.split("/").filter(Boolean);
      const shareIdx = parts.indexOf("share");
      if (shareIdx >= 0 && parts[shareIdx + 1]) {
        return parts[shareIdx + 1].replace(/\/+$/, "");
      }
    }
  } catch {
    // fall through to bare token
  }
  return trimmed.replace(/^\/+|\/+$/g, "");
}

export function normalizeHost(host: string): string {
  const trimmed = host.trim() || "https://thermaltrace.dev";
  return trimmed.replace(/\/+$/, "");
}

export function buildShareReadingsUrl(host: string, token: string): string {
  const origin = normalizeHost(host);
  const shareToken = normalizeShareToken(token);
  if (!shareToken) {
    throw new Error("shareToken is required");
  }
  return `${origin}/api/share/${encodeURIComponent(shareToken)}/readings`;
}

export async function fetchShareReadings(
  host: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ShareReadingsResponse> {
  const url = buildShareReadingsUrl(host, token);
  const res = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "matterbridge-thermaltrace/0.1.0",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Share readings HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }
  return (await res.json()) as ShareReadingsResponse;
}
