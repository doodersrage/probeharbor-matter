import type { BasePlatformConfig, PlatformMatterbridge } from "matterbridge";
import {
  MatterbridgeDynamicPlatform,
  MatterbridgeEndpoint,
  bridgedNode,
  contactSensor,
  humiditySensor,
  occupancySensor,
  onOffLightSwitch,
  powerSource,
  temperatureSensor,
  waterLeakDetector,
} from "matterbridge";
import type { AnsiLogger, LogLevel } from "matterbridge/logger";
import {
  BooleanState,
  BridgedDeviceBasicInformation,
  OccupancySensing,
  OnOff,
  RelativeHumidityMeasurement,
  TemperatureMeasurement,
} from "matterbridge/matter/clusters";

import { postSnooze } from "./inboundSnooze.js";
import { planReadings, type BridgedSensorPlan } from "./sensorMap.js";
import { fetchShareReadings, normalizeShareToken } from "./shareClient.js";

export type ThermalTracePlatformConfig = BasePlatformConfig & {
  host?: string;
  shareToken?: string;
  pollIntervalSeconds?: number;
  enableSnoozeSwitch?: boolean;
  inboundWebhookToken?: string;
  inboundSigningSecret?: string;
  snoozeHours?: number;
  whiteList?: string[];
  blackList?: string[];
};

const SOFTWARE_VERSION = 101;
const SOFTWARE_VERSION_STRING = "0.1.1";
const VENDOR_NAME = "ProbeHarbor";
const PRODUCT_NAME = "ProbeHarbor Matter";

/**
 * Matterbridge DynamicPlatform that polls ProbeHarbor share readings and
 * exposes temperature, humidity, leak, door, power, and motion as Matter devices.
 *
 * Not CSA-certified. Runs on a LAN host (Pi / NAS / PC) — not on Cloudflare Workers.
 */
export class ThermalTracePlatform extends MatterbridgeDynamicPlatform {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly endpoints = new Map<string, MatterbridgeEndpoint>();
  private snoozeEndpoint: MatterbridgeEndpoint | undefined;
  private polling = false;

  constructor(
    matterbridge: PlatformMatterbridge,
    log: AnsiLogger,
    config: ThermalTracePlatformConfig,
  ) {
    super(matterbridge, log, config);

    if (
      typeof this.verifyMatterbridgeVersion !== "function" ||
      !this.verifyMatterbridgeVersion("3.10.0")
    ) {
      throw new Error(
        `matterbridge-thermaltrace requires Matterbridge >= 3.10.0 (found ${this.matterbridge.matterbridgeVersion}).`,
      );
    }

    this.log.info("Initializing ProbeHarbor Matter platform…");
  }

  private get ttConfig(): ThermalTracePlatformConfig {
    return this.config as ThermalTracePlatformConfig;
  }

  private get host(): string {
    return this.ttConfig.host?.trim() || "https://probeharbor.dev";
  }

  private get shareToken(): string {
    return normalizeShareToken(this.ttConfig.shareToken ?? "");
  }

  private get pollMs(): number {
    const sec = Number(this.ttConfig.pollIntervalSeconds ?? 120);
    const clamped = Number.isFinite(sec) ? Math.max(60, Math.min(3600, sec)) : 120;
    return clamped * 1000;
  }

  override async onStart(reason?: string): Promise<void> {
    this.log.info(`onStart called with reason: ${reason ?? "none"}`);
    await this.ready;
    await this.clearSelect();

    if (!this.shareToken) {
      this.log.error(
        "shareToken is empty. Create a family live share link at Dashboard → Share and paste the token.",
      );
      return;
    }

    await this.syncFromShare("startup");
    if (this.ttConfig.enableSnoozeSwitch) {
      await this.ensureSnoozeSwitch();
    }
  }

  override async onConfigure(): Promise<void> {
    await super.onConfigure();
    this.log.info("onConfigure called — starting share poll loop");
    await this.syncFromShare("configure");
    this.startPollLoop();
  }

  override async onChangeLoggerLevel(logLevel: LogLevel): Promise<void> {
    this.log.info(`Logger level → ${logLevel}`);
  }

  override async onShutdown(reason?: string): Promise<void> {
    this.stopPollLoop();
    await super.onShutdown(reason);
    this.log.info(`onShutdown called with reason: ${reason ?? "none"}`);
    if (this.config.unregisterOnShutdown) {
      await this.unregisterAllDevices();
    }
  }

  private startPollLoop(): void {
    this.stopPollLoop();
    this.pollTimer = setInterval(() => {
      void this.syncFromShare("poll");
    }, this.pollMs);
    this.log.info(`Polling share readings every ${this.pollMs / 1000}s`);
  }

  private stopPollLoop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async syncFromShare(reason: string): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const payload = await fetchShareReadings(this.host, this.shareToken);
      const plans = planReadings(payload.readings ?? []);
      this.log.info(
        `Share sync (${reason}): ${plans.length} Matter-mappable reading(s) from scope=${payload.scope}`,
      );
      for (const plan of plans) {
        await this.upsertSensor(plan);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`Share sync failed (${reason}): ${message}`);
    } finally {
      this.polling = false;
    }
  }

  private async upsertSensor(plan: BridgedSensorPlan): Promise<void> {
    this.setSelectDevice(plan.serial, plan.name);
    if (!this.validateDevice([plan.name, plan.serial])) {
      return;
    }

    let endpoint = this.endpoints.get(plan.id);
    if (!endpoint) {
      endpoint = this.createEndpoint(plan);
      await this.registerDevice(endpoint);
      this.endpoints.set(plan.id, endpoint);
      this.log.notice(`Registered ${plan.role} device: ${plan.name}`);
      await this.applyNodeLabel(endpoint, plan);
    }

    await this.applyPlan(endpoint, plan);
  }

  private createEndpoint(plan: BridgedSensorPlan): MatterbridgeEndpoint {
    const debug = Boolean(this.config.debug);
    const vendorId = this.matterbridge.aggregatorVendorId;

    if (plan.role === "temperature") {
      return new MatterbridgeEndpoint(
        [temperatureSensor, bridgedNode, powerSource],
        { id: plan.id },
        debug,
      )
        .createDefaultIdentifyClusterServer()
        .createDefaultBridgedDeviceBasicInformationClusterServer(
          plan.name,
          plan.serial,
          vendorId,
          VENDOR_NAME,
          PRODUCT_NAME,
          SOFTWARE_VERSION,
          SOFTWARE_VERSION_STRING,
        )
        .createDefaultPowerSourceWiredClusterServer()
        .createDefaultTemperatureMeasurementClusterServer(plan.measuredValue ?? 0)
        .addRequiredClusterServers();
    }

    if (plan.role === "humidity") {
      return new MatterbridgeEndpoint(
        [humiditySensor, bridgedNode, powerSource],
        { id: plan.id },
        debug,
      )
        .createDefaultIdentifyClusterServer()
        .createDefaultBridgedDeviceBasicInformationClusterServer(
          plan.name,
          plan.serial,
          vendorId,
          VENDOR_NAME,
          PRODUCT_NAME,
          SOFTWARE_VERSION,
          SOFTWARE_VERSION_STRING,
        )
        .createDefaultPowerSourceWiredClusterServer()
        .createDefaultRelativeHumidityMeasurementClusterServer(
          plan.measuredValue ?? 0,
        )
        .addRequiredClusterServers();
    }

    if (plan.role === "leak") {
      return new MatterbridgeEndpoint(
        [waterLeakDetector, bridgedNode, powerSource],
        { id: plan.id },
        debug,
      )
        .createDefaultIdentifyClusterServer()
        .createDefaultBridgedDeviceBasicInformationClusterServer(
          plan.name,
          plan.serial,
          vendorId,
          VENDOR_NAME,
          PRODUCT_NAME,
          SOFTWARE_VERSION,
          SOFTWARE_VERSION_STRING,
        )
        .createDefaultPowerSourceWiredClusterServer()
        .createDefaultBooleanStateClusterServer(plan.stateValue ?? false)
        .addRequiredClusterServers();
    }

    if (plan.role === "contact") {
      return new MatterbridgeEndpoint(
        [contactSensor, bridgedNode, powerSource],
        { id: plan.id },
        debug,
      )
        .createDefaultIdentifyClusterServer()
        .createDefaultBridgedDeviceBasicInformationClusterServer(
          plan.name,
          plan.serial,
          vendorId,
          VENDOR_NAME,
          PRODUCT_NAME,
          SOFTWARE_VERSION,
          SOFTWARE_VERSION_STRING,
        )
        .createDefaultPowerSourceWiredClusterServer()
        .createDefaultBooleanStateClusterServer(plan.stateValue ?? true)
        .addRequiredClusterServers();
    }

    // occupancy
    return new MatterbridgeEndpoint(
      [occupancySensor, bridgedNode, powerSource],
      { id: plan.id },
      debug,
    )
      .createDefaultIdentifyClusterServer()
      .createDefaultBridgedDeviceBasicInformationClusterServer(
        plan.name,
        plan.serial,
        vendorId,
        VENDOR_NAME,
        PRODUCT_NAME,
        SOFTWARE_VERSION,
        SOFTWARE_VERSION_STRING,
      )
      .createDefaultPowerSourceWiredClusterServer()
      .createDefaultOccupancySensingClusterServer(plan.occupied ?? false)
      .addRequiredClusterServers();
  }

  /**
   * The endpoint is created with the long name so its uniqueId (built from the
   * name) stays the same as in 0.1.0 and controllers keep the pairing. The
   * shorter name only replaces the nodeLabel that controllers display.
   */
  private async applyNodeLabel(
    endpoint: MatterbridgeEndpoint,
    plan: BridgedSensorPlan,
  ): Promise<void> {
    if (plan.label === plan.name.slice(0, 32)) return;
    try {
      await endpoint.setAttribute(
        BridgedDeviceBasicInformation,
        "nodeLabel",
        plan.label,
        this.log,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn(`Failed to set the label for ${plan.name}: ${message}`);
    }
  }

  private async applyPlan(
    endpoint: MatterbridgeEndpoint,
    plan: BridgedSensorPlan,
  ): Promise<void> {
    try {
      if (plan.role === "temperature" && plan.measuredValue != null) {
        await endpoint.setAttribute(
          TemperatureMeasurement,
          "measuredValue",
          plan.measuredValue,
          this.log,
        );
      } else if (plan.role === "humidity" && plan.measuredValue != null) {
        await endpoint.setAttribute(
          RelativeHumidityMeasurement,
          "measuredValue",
          plan.measuredValue,
          this.log,
        );
      } else if (
        (plan.role === "leak" || plan.role === "contact") &&
        plan.stateValue != null
      ) {
        await endpoint.setAttribute(
          BooleanState,
          "stateValue",
          plan.stateValue,
          this.log,
        );
      } else if (plan.role === "occupancy" && plan.occupied != null) {
        await endpoint.setAttribute(
          OccupancySensing,
          "occupancy",
          { occupied: plan.occupied },
          this.log,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn(`Failed to update ${plan.name}: ${message}`);
    }
  }

  private async ensureSnoozeSwitch(): Promise<void> {
    const token = this.ttConfig.inboundWebhookToken?.trim();
    const secret = this.ttConfig.inboundSigningSecret?.trim();
    if (!token || !secret) {
      this.log.warn(
        "enableSnoozeSwitch is on but inboundWebhookToken / inboundSigningSecret are missing — skipping snooze switch.",
      );
      return;
    }

    const name = "ProbeHarbor Snooze";
    const serial = "TT-SNOOZE";
    this.setSelectDevice(serial, name);
    if (!this.validateDevice([name, serial])) return;

    const debug = Boolean(this.config.debug);
    const vendorId = this.matterbridge.aggregatorVendorId;
    const hours = Number(this.ttConfig.snoozeHours ?? 24);

    const endpoint = new MatterbridgeEndpoint(
      [onOffLightSwitch, bridgedNode, powerSource],
      { id: "thermaltrace-snooze" },
      debug,
    )
      .createDefaultIdentifyClusterServer()
      .createDefaultBridgedDeviceBasicInformationClusterServer(
        name,
        serial,
        vendorId,
        VENDOR_NAME,
        "ProbeHarbor Snooze",
        SOFTWARE_VERSION,
        SOFTWARE_VERSION_STRING,
      )
      .createDefaultPowerSourceWiredClusterServer()
      .createDefaultOnOffClusterServer(false)
      .addRequiredClusterServers()
      .addCommandHandler("on", async () => {
        this.log.notice(`Snooze switch ON → posting ${hours}h snooze`);
        try {
          await postSnooze({
            host: this.host,
            inboundToken: token,
            signingSecret: secret,
            hours,
          });
          this.log.notice("Snooze accepted by ProbeHarbor");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log.error(`Snooze failed: ${message}`);
        } finally {
          try {
            await endpoint.setAttribute(OnOff, "onOff", false, this.log);
          } catch {
            // ignore reset failures
          }
        }
      })
      .addCommandHandler("off", () => {
        this.log.debug("Snooze switch OFF (no-op)");
      });

    await this.registerDevice(endpoint);
    this.snoozeEndpoint = endpoint;
    this.log.notice("Registered ProbeHarbor Snooze switch (momentary)");
  }
}
