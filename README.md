# Strait of Hormuz

Naval convoy defense game prototype.

## Vision

Escort commercial oil tankers through the Strait of Hormuz under sustained asymmetric attack.

The player commands allied naval assets (starting with destroyers) to protect convoys from:

- Shore-launched anti-ship missiles
- Drone swarms
- Naval mines
- Fast attack craft

Tankers can ignite when damaged. If a tanker burns too long, it sinks and blocks traffic lanes.

## Core Gameplay Loop (Prototype)

1. Form a convoy from a terminal traffic queue.
2. Assign escorts and route through the strait.
3. Detect and intercept inbound threats.
4. Manage damage control and firefighting on tankers.
5. Deliver as many tankers as possible before time expires or losses exceed threshold.

## Prototype Scope (v0.1)

- Play area based on a simplified real-world strait layout
- 1 player-controlled allied task group
- AI-controlled tanker traffic queues at both ends
- Missile + drone attacks from shoreline zones
- Fire escalation and sinking system for tankers
- Score based on successful escorts, losses, and response efficiency
- Multi-input support targets:
  - Keyboard-only play on PC
  - Gamepad + keyboard hybrid play on PC
  - Touchscreen controls for phones/tablets

## Input & Platform Accessibility (New Requirement)

To keep gameplay consistent across devices, the prototype should use a unified command model with per-device input mappings:

- **Keyboard-only (PC)**: full command coverage without mouse dependency
- **Controller + keyboard (PC)**: gamepad for movement/selection + keyboard for advanced hotkeys
- **Touch (mobile)**: tap/drag radial command UI with larger hit targets and simplified command layers

## Repository Setup

```bash
git init
git branch -M main
git remote add origin git@github.com:bobdude247/strait-of-hormuz.git
```

## Next Docs

- `docs/GDD.md` for design detail
- `docs/TECHNICAL_PLAN.md` for implementation plan

## GitHub Pages Hosting

This repo includes an automated GitHub Pages workflow at `.github/workflows/deploy-pages.yml`.

### One-time GitHub setup

1. Open repository **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Save.

### Deploy flow

- Every push to `main` runs the Pages deploy workflow.
- The site publishes from repository root (this includes `index.html` and `src/*`).

### Expected URL

- `https://bobdude247.github.io/strait-of-hormuz/`

## Live Traffic Enrichment (Optional)

This prototype now supports an **optional ambient AIS-style traffic layer**.

### Important API reality check

- VesselFinder and similar providers typically require paid/commercial plans for API access.
- Free/public tiers (if any) are usually rate-limited and may not allow direct browser calls.
- CORS and API key exposure make direct frontend integration unsafe for private keys.

### Recommended architecture

1. Use a small backend proxy (Cloudflare Worker, Vercel function, Netlify function, or tiny Node service).
2. Proxy fetches traffic from provider API server-side using private API key.
3. Proxy returns normalized vessel rows to the game frontend.

Example normalized payload:

```json
[
  { "name": "Vessel A", "lon": 56.24, "lat": 25.88, "cog": 102, "sog": 11.2, "type": "Tanker" }
]
```

### Frontend hook

- Set `window.SOH_TRAFFIC_ENDPOINT` before loading the game script.
- If unset/unavailable, the game falls back to simulated ambient traffic.

Example:

```html
<script>
  window.SOH_TRAFFIC_ENDPOINT = "https://your-proxy.example.com/traffic";
</script>
```
