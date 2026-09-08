/** Matter TemperatureMeasurement uses hundredths of a degree Celsius. */
export function fahrenheitToCelsiusHundredths(tempF: number): number {
  const celsius = ((tempF - 32) * 5) / 9;
  return Math.round(celsius * 100);
}

/** Assume °F when unit is missing or looks like Fahrenheit (ThermalTrace default). */
export function toCelsiusHundredths(
  value: number,
  unit: string | null | undefined,
): number {
  const u = (unit ?? "°F").toLowerCase();
  if (u.includes("c") && !u.includes("f")) {
    return Math.round(value * 100);
  }
  return fahrenheitToCelsiusHundredths(value);
}

/** Matter RelativeHumidityMeasurement uses hundredths of a percent. */
export function humidityToMatterHundredths(pct: number): number {
  const clamped = Math.max(0, Math.min(100, pct));
  return Math.round(clamped * 100);
}
