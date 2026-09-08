import {
  isMatterSensorKind,
  type MatterSensorKind,
  type ShareReading,
} from "./shareClient.js";
import {
  humidityToMatterHundredths,
  toCelsiusHundredths,
} from "./tempUnits.js";

export type BridgedSensorRole =
  | "temperature"
  | "humidity"
  | "leak"
  | "contact"
  | "occupancy";

export type BridgedSensorPlan = {
  /** Stable Matter storage / serial id */
  id: string;
  /** Human-readable name for Apple Home / Matterbridge select */
  name: string;
  kind: MatterSensorKind;
  role: BridgedSensorRole;
  serial: string;
  /** Numeric Matter attribute payload when applicable */
  measuredValue?: number;
  /** BooleanState.stateValue or occupancy */
  stateValue?: boolean;
  occupied?: boolean;
};

function sanitizeIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "x";
}

export function readingDeviceId(reading: ShareReading): string {
  return [
    sanitizeIdPart(reading.device),
    sanitizeIdPart(reading.key),
    sanitizeIdPart(reading.kind),
  ].join("__");
}

export function readingDisplayName(reading: ShareReading): string {
  const label = reading.label?.trim() || reading.key;
  return `${reading.device} ${label}`.trim();
}

export function readingSerial(reading: ShareReading): string {
  const id = readingDeviceId(reading).replace(/__/g, "-").toUpperCase();
  return `TT-${id}`.slice(0, 32);
}

/**
 * Matter Contact Sensor BooleanState: TRUE = closed/contact.
 * ThermalTrace door true = open → invert.
 * ThermalTrace power true = powered → keep (closed when on).
 */
export function contactStateValue(
  kind: "door" | "power",
  value: boolean,
): boolean {
  if (kind === "door") return !value;
  return value;
}

export function planFromReading(reading: ShareReading): BridgedSensorPlan | null {
  if (!isMatterSensorKind(reading.kind)) return null;

  const id = readingDeviceId(reading);
  const name = readingDisplayName(reading);
  const serial = readingSerial(reading);
  const kind = reading.kind;

  if (kind === "temperature") {
    if (reading.value_num == null || !Number.isFinite(reading.value_num)) {
      return null;
    }
    return {
      id,
      name,
      kind,
      role: "temperature",
      serial,
      measuredValue: toCelsiusHundredths(reading.value_num, reading.unit),
    };
  }

  if (kind === "humidity") {
    if (reading.value_num == null || !Number.isFinite(reading.value_num)) {
      return null;
    }
    return {
      id,
      name,
      kind,
      role: "humidity",
      serial,
      measuredValue: humidityToMatterHundredths(reading.value_num),
    };
  }

  if (kind === "flood") {
    if (reading.value_bool == null) return null;
    return {
      id,
      name,
      kind,
      role: "leak",
      serial,
      stateValue: reading.value_bool,
    };
  }

  if (kind === "door" || kind === "power") {
    if (reading.value_bool == null) return null;
    return {
      id,
      name,
      kind,
      role: "contact",
      serial,
      stateValue: contactStateValue(kind, reading.value_bool),
    };
  }

  if (kind === "motion") {
    if (reading.value_bool == null) return null;
    return {
      id,
      name,
      kind,
      role: "occupancy",
      serial,
      occupied: reading.value_bool,
    };
  }

  return null;
}

export function planReadings(readings: ShareReading[]): BridgedSensorPlan[] {
  const plans: BridgedSensorPlan[] = [];
  const seen = new Set<string>();
  for (const reading of readings) {
    const plan = planFromReading(reading);
    if (!plan) continue;
    if (seen.has(plan.id)) continue;
    seen.add(plan.id);
    plans.push(plan);
  }
  return plans;
}
