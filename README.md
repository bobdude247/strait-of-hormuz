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
