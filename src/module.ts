/**
 * Matterbridge plugin entry: ProbeHarbor share-link → Matter sensors.
 */
import type { PlatformMatterbridge } from "matterbridge";
import type { AnsiLogger } from "matterbridge/logger";

import {
  ThermalTracePlatform,
  type ThermalTracePlatformConfig,
} from "./platform.js";

export default function initializePlugin(
  matterbridge: PlatformMatterbridge,
  log: AnsiLogger,
  config: ThermalTracePlatformConfig,
): ThermalTracePlatform {
  return new ThermalTracePlatform(matterbridge, log, config);
}

export { ThermalTracePlatform };
export type { ThermalTracePlatformConfig };
