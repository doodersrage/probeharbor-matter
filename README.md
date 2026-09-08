# ThermalTrace Matter bridge

[![CI](https://github.com/doodersrage/thermaltrace-matter/actions/workflows/ci.yml/badge.svg)](https://github.com/doodersrage/thermaltrace-matter/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-slategray)](./LICENSE)

**Matterbridge plugin** that polls a ThermalTrace [family live share link](https://thermaltrace.dev/dashboard/share/links) and exposes garage / workshop probes to **Apple Home**, **Google Home**, **Alexa**, and other Matter controllers.

Product guide: [thermaltrace.dev/integrations/matter](https://thermaltrace.dev/integrations/matter)

> This bridge is **not CSA-certified**. It is a DIY companion for households that already use ThermalTrace. Probes stay on ESP/Arduino (or HTTPS feeds); this plugin only signs into your share link and mirrors sensors over Matter on your LAN.

## What you get

| ThermalTrace kind | Matter device |
| --- | --- |
| `temperature` | Temperature Sensor (°C; values converted from °F when needed) |
| `humidity` | Humidity Sensor |
| `flood` | Water Leak Detector |
| `door` | Contact Sensor (open → open / closed → closed) |
| `power` | Contact Sensor (on = closed / powered) |
| `motion` | Occupancy Sensor |

Optional (Pro): a momentary **Snooze** On/Off switch that POSTs `/api/inbound/{token}` with HMAC signing — same path as the Home Assistant integration.

**Not mapped in v1:** energy, level, CO₂ / PM2.5 / VOC, time-to-freeze (no honest native Matter type). Freeze SMS still comes from ThermalTrace push ingest; this poll is for glance + Home automations.

## Prerequisites

1. A ThermalTrace account and a **family live** share link ([Dashboard → Share](https://thermaltrace.dev/dashboard/share/links)). Free includes one.
2. [Matterbridge](https://matterbridge.io/) on a always-on LAN host (Raspberry Pi, NAS, home PC). Matter pairing needs local mDNS — this does **not** run on Cloudflare Workers.
3. Node.js matching Matterbridge’s engine range (20 / 22 / 24 / 26 LTS lines).

## Install

### From GitHub (recommended while unpublished to npm)

```bash
# On the host that already runs Matterbridge:
cd ~/matterbridge-plugins   # or any folder you prefer
git clone https://github.com/doodersrage/thermaltrace-matter.git
cd thermaltrace-matter
npm install
npm run build
matterbridge --add .
```

Restart Matterbridge (or use the frontend **Restart**). Open the plugin config and set:

| Field | Value |
| --- | --- |
| **Share link token** | The `YOUR_TOKEN` part of `https://thermaltrace.dev/share/YOUR_TOKEN` |
| **Host** | `https://thermaltrace.dev` (or your self-hosted origin) |
| **Poll interval** | `120` seconds (minimum `60`) |

Pair the Matterbridge QR code in Apple Home / Google Home / Alexa as usual.

### Snooze switch (Pro)

1. Create an inbound webhook under Dashboard → Share and copy the token + signing secret.
2. In plugin config: enable **Snooze switch**, paste token + secret, set **Snooze hours** (default 24).
3. Toggling the switch **on** POSTs snooze, then resets to off (momentary).

## How it works

```
ESP / Arduino ──push──► ThermalTrace (Cloudflare)
                              │
                     GET /api/share/{token}/readings
                              │
                     Matterbridge + this plugin (LAN)
                              │
                     Matter fabric → Apple / Google / Alexa
```

Poll cadence matches the HACS integration mindset: fine for dashboards and Home automations; time-critical freeze alerts should stay on ThermalTrace push + SMS/email.

Share readings are rate-limited (~60 req/min). A 60–300 s poll is safe.

## Development

```bash
npm install
npm run build
npm test
npm run typecheck
```

Pure mapping / HTTP helpers are unit-tested without a live Matter fabric. Platform code expects Matterbridge ≥ 3.10 as a peer.

## Related

- App: [thermaltrace.dev](https://thermaltrace.dev)
- Home Assistant (HACS): [thermaltrace-home-assistant](https://github.com/doodersrage/thermaltrace-home-assistant)
- Companion apps: [thermaltrace.dev/apps](https://thermaltrace.dev/apps)
- Matterbridge: [matterbridge.io](https://matterbridge.io/)

## License

[MIT](./LICENSE)
