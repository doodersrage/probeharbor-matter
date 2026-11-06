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
      normalizeShareToken("https://probeharbor.dev/share/family-live-xyz"),
    ).toBe("family-live-xyz");
  });
});

describe("buildShareReadingsUrl", () => {
  it("builds the share readings path", () => {
    expect(buildShareReadingsUrl("https://probeharbor.dev/", "tok")).toBe(
      "https://probeharbor.dev/api/share/tok/readings",
    );
  });

  it("rejects empty token", () => {
    expect(() => buildShareReadingsUrl("https://probeharbor.dev", "")).toThrow(
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
    expect(buildInboundUrl("https://probeharbor.dev/", "wh_abc")).toBe(
      "https://probeharbor.dev/api/inbound/wh_abc",
    );
  });

  it("HMAC signs body", () => {
    const sig = signInboundBody("secret", '{"action":"snooze","hours":24}');
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("names and identity", () => {
  const reading = (device: string, label: string | null, key = "temp-air", kind = "temperature") => ({
    device,
    key,
    label,
    kind,
    unit: "°F",
    value_num: 70,
    value_bool: null,
    value_text: null,
    recorded_at: "2026-11-06T00:00:00Z",
  });

  it("doesn't repeat the device name in the label controllers show", () => {
    expect(planFromReading(reading("House ESP32-S3", "House ESP32-S3"))?.label).toBe("House ESP32-S3");
    expect(
      planFromReading(reading("House ESP32-S3", "House ESP32-S3 humidity", "humidity-air", "humidity"))?.label,
    ).toBe("House ESP32-S3 humidity");
    expect(planFromReading(reading("Garage", "Bay avg"))?.label).toBe("Garage Bay avg");
    expect(planFromReading(reading("Garage", null, "temp1"))?.label).toBe("Garage temp1");
  });

  it("keeps labels within Matter's 32 characters", () => {
    const label = planFromReading(reading("Garage Door Probe", "Garage Door Probe Garage Door Temperature"))?.label;
    expect(label!.length).toBeLessThanOrEqual(32);
  });

  // The long name and serial feed Matterbridge's uniqueId. Changing them makes
  // controllers (e.g. Google Home) see every sensor as a new device.
  it("keeps the 0.1.0 name and serial, so paired devices keep their identity", () => {
    const plan = planFromReading(reading("House ESP32-S3", "House ESP32-S3"));
    expect(plan?.name).toBe("House ESP32-S3 House ESP32-S3");
    expect(plan?.serial).toBe("TT-HOUSE-ESP32-S3-TEMP-AIR-TEMPE");
    expect(plan?.id).toBe("house-esp32-s3__temp-air__temperature");
  });
});
