import { describe, expect, it } from "vitest";
import {
  buildShareReadingsUrl,
  normalizeHost,
  normalizeShareToken,
} from "./shareClient.js";
import {
  contactStateValue,
  planFromReading,
  planReadings,
  readingDeviceId,
} from "./sensorMap.js";
import {
  fahrenheitToCelsiusHundredths,
  humidityToMatterHundredths,
  toCelsiusHundredths,
} from "./tempUnits.js";
import { buildInboundUrl, signInboundBody } from "./inboundSnooze.js";

describe("normalizeShareToken", () => {
  it("accepts bare tokens", () => {
    expect(normalizeShareToken(" abc123 ")).toBe("abc123");
  });

  it("extracts token from share URL", () => {
    expect(
      normalizeShareToken("https://thermaltrace.dev/share/family-live-xyz"),
    ).toBe("family-live-xyz");
  });
});

describe("buildShareReadingsUrl", () => {
  it("builds the share readings path", () => {
    expect(buildShareReadingsUrl("https://thermaltrace.dev/", "tok")).toBe(
      "https://thermaltrace.dev/api/share/tok/readings",
    );
  });

  it("rejects empty token", () => {
    expect(() => buildShareReadingsUrl("https://thermaltrace.dev", "")).toThrow(
      /shareToken/i,
    );
  });
});

describe("normalizeHost", () => {
  it("strips trailing slash", () => {
    expect(normalizeHost("https://example.com/")).toBe("https://example.com");
  });
});

describe("temp units", () => {
  it("converts Fahrenheit to Celsius hundredths", () => {
    // 32°F → 0°C
    expect(fahrenheitToCelsiusHundredths(32)).toBe(0);
    // 50°F → 10°C
    expect(fahrenheitToCelsiusHundredths(50)).toBe(1000);
  });

  it("passes Celsius through when unit says C", () => {
    expect(toCelsiusHundredths(21.5, "°C")).toBe(2150);
  });

  it("clamps humidity", () => {
    expect(humidityToMatterHundredths(45.2)).toBe(4520);
    expect(humidityToMatterHundredths(120)).toBe(10000);
  });
});

describe("sensor map", () => {
  it("maps temperature readings", () => {
    const plan = planFromReading({
      device: "Garage",
      key: "temp1",
      label: "Bay avg",
      kind: "temperature",
      unit: "°F",
      value_num: 50,
      value_bool: null,
      value_text: null,
      recorded_at: "2026-09-08T00:00:00Z",
    });
    expect(plan?.role).toBe("temperature");
    expect(plan?.measuredValue).toBe(1000);
    expect(plan?.name).toContain("Garage");
  });

  it("inverts door open to Matter closed contact", () => {
    expect(contactStateValue("door", true)).toBe(false);
    expect(contactStateValue("door", false)).toBe(true);
    expect(contactStateValue("power", true)).toBe(true);
  });

  it("maps flood wet to leak stateValue true", () => {
    const plan = planFromReading({
      device: "Garage",
      key: "leak1",
      label: "Water heater",
      kind: "flood",
      unit: null,
      value_num: null,
      value_bool: true,
      value_text: null,
      recorded_at: "2026-09-08T00:00:00Z",
    });
    expect(plan?.role).toBe("leak");
    expect(plan?.stateValue).toBe(true);
  });

  it("skips unsupported kinds", () => {
    expect(
      planFromReading({
        device: "Garage",
        key: "e1",
        label: "Wh",
        kind: "energy",
        unit: "W",
        value_num: 12,
        value_bool: null,
        value_text: null,
        recorded_at: "2026-09-08T00:00:00Z",
      }),
    ).toBeNull();
  });

  it("dedupes by device/key/kind", () => {
    const reading = {
      device: "Garage",
      key: "temp1",
      label: "Bay",
      kind: "temperature",
      unit: "°F",
      value_num: 40,
      value_bool: null,
      value_text: null,
      recorded_at: "2026-09-08T00:00:00Z",
    };
    const plans = planReadings([reading, { ...reading, value_num: 41 }]);
    expect(plans).toHaveLength(1);
    expect(readingDeviceId(reading)).toMatch(/garage__temp1__temperature/);
  });
});

describe("inbound snooze helpers", () => {
  it("builds inbound URL", () => {
    expect(buildInboundUrl("https://thermaltrace.dev/", "wh_abc")).toBe(
      "https://thermaltrace.dev/api/inbound/wh_abc",
    );
  });

  it("HMAC signs body", () => {
    const sig = signInboundBody("secret", '{"action":"snooze","hours":24}');
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });
});
