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

## Repository Setup

```bash
git init
git branch -M main
git remote add origin git@github.com:bobdude247/strait-of-hormuz.git
```

## Next Docs

- `docs/GDD.md` for design detail
- `docs/TECHNICAL_PLAN.md` for implementation plan
