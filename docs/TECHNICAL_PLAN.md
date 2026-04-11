# Strait of Hormuz — Technical Implementation Plan (Prototype v0.1)

## 1. Tech Stack Recommendation

- **Engine**: Unity (2022 LTS or newer)
- **Language**: C#
- **Target**: PC (Windows) first
- **Map Data**: OpenStreetMap-derived coastline/shape data (simplified and baked)

Rationale: fast iteration for a small team, good 2D/3D hybrid tooling, mature pathfinding and UI ecosystem.

## 2. Architecture Overview

Use a lightweight entity-component style with clear gameplay systems.

### Core Runtime Layers

1. **Simulation Layer**
   - Time step, movement, threat spawning, damage ticks
2. **Combat Layer**
   - Detection, target assignment, interception, hit resolution
3. **Traffic Layer**
   - Queue management at terminals, lane occupancy, convoy release cadence
4. **Mission Layer**
   - Objectives, score, win/loss evaluation, timer
5. **Presentation Layer**
   - Icons, VFX/SFX, HUD, alerts

## 3. Prototype Systems Breakdown

## 3.0 Input Abstraction System (New Requirement)

Support three active input contexts from day one:

1. Keyboard-only (PC)
2. Controller + keyboard hybrid (PC)
3. Touchscreen (phone/tablet)

Implementation approach:

- Use Unity Input System action maps with shared gameplay actions:
  - `Select`
  - `CycleSelection`
  - `MoveCommand`
  - `SetEscortPosture`
  - `SetThreatPriority`
  - `ActivateDamageControl`
  - `CameraPan`
  - `CameraZoom`
- Bind each action to keyboard/gamepad/touch schemes.
- Keep gameplay systems action-driven, never device-driven.

Technical note: command handlers consume abstract actions/events so control schemes can be swapped without gameplay code changes.

## 3.1 World/Map System

- Build a simplified strait map with:
  - Navigable polygons/lane corridors
  - Shoreline threat zones
  - Spawn points for terminal queues and hostile launch cells
- Keep geometry low-complexity for deterministic behavior.

## 3.2 Unit System

Common ship data model:

- `id`, `faction`, `type`, `hp`, `maxHp`
- `speed`, `turnRate`, `position`, `heading`
- `statusEffects` (`Burning`, `Disabled`, etc.)

Specialized behavior:

- Tanker: path follower + damage control receiver
- Destroyer: threat detector + interceptor shooter + escort bonus provider

## 3.3 Threat System

- Missile entities with target lock and flight path
- Drone entities with swarm grouping behavior
- Spawn controller driven by wave config asset:
  - Frequency
  - Threat composition
  - Launch zones

## 3.4 Combat Resolution

- Detection check by distance + line of sight abstraction
- Intercept attempts consume rate-limited defensive fire slots
- On threat impact:
  - Apply direct damage
  - Roll ignition chance

## 3.5 Fire & Damage Control System

- Burning status with intensity levels 1–3
- Tick-based damage every `T` seconds
- Damage control action:
  - Adds suppression over time
  - Requires cooldown
  - Increased effectiveness if escorted nearby
- Sinking when HP <= 0 or catastrophic burn threshold reached

## 3.6 Traffic & Convoy Flow

- Two FIFO terminal queues
- Convoy generator releases groups based on lane occupancy and mission tempo
- Collision-lite spacing rules to avoid overlap
- Obstruction flag when vessel sinks in lane

## 3.7 Mission/Scoring System

- Mission timer
- Delivery counter
- Loss counter
- Score service with weighted events:
  - Tanker delivered / lost
  - Escort lost
  - Fire extinguished quickly bonus

## 4. Data-Driven Content

Use ScriptableObjects (or equivalent data assets) for:

- Ship stats
- Threat stats
- Wave tables
- Mission parameters
- Scoring weights

Benefit: fast balancing without code edits.

## 5. Suggested Project Structure

```text
Assets/
  Scripts/
    Core/
      GameLoop.cs
      TimeService.cs
      InputRouter.cs
    Simulation/
      UnitModel.cs
      MovementSystem.cs
      StatusEffectSystem.cs
    Combat/
      DetectionSystem.cs
      InterceptSystem.cs
      DamageSystem.cs
    Traffic/
      QueueSystem.cs
      ConvoySystem.cs
    Mission/
      MissionController.cs
      ScoreSystem.cs
    UI/
      HudController.cs
      AlertFeed.cs
      TouchCommandPanel.cs
      GamepadFocusNavigator.cs
    Input/
      InputActions.inputactions
      InputProfiles.cs
  Data/
    Ships/
    Threats/
    Missions/
```

## 6. Milestone Plan

## Milestone 0 — Repo + Skeleton (0.5 day)

- Unity project initialized
- Folder structure created
- Empty scene with camera + test ocean plane
- Input System package enabled with keyboard/gamepad/touch control schemes

## Milestone 1 — Movement & Convoys (1–2 days)

- Tanker and destroyer prefabs
- Waypoint movement
- Terminal queue spawn/release

## Milestone 2 — Threats & Intercepts (2 days)

- Missile/drone spawning
- Detection radius
- Basic interception logic

## Milestone 3 — Damage/Fire/Sinking (1–2 days)

- HP system
- Burning escalation
- Damage control command
- Sinking and lane obstruction

## Milestone 4 — Mission Loop + UI (1–2 days)

- Win/loss checks
- Score calculation
- HUD indicators and alerts
- Input-specific UI layer:
  - Touch command panel + radial menu
  - Gamepad focus navigation + button hints
  - Keyboard-only hotkey discoverability overlay

## Milestone 5 — Balance Pass + Playtest (1 day)

- Tune wave cadence and ship survivability
- Fix priority bugs from first external playtest

## 7. Definition of Done (Prototype)

- Player can escort multiple tanker convoys end-to-end
- Hostile missiles and drones reliably attack during transit
- Tankers can burn, be suppressed, and sink if untreated
- Mission has clear success/failure states
- One full 10+ minute playable scenario runs without critical errors
- Full playability confirmed in all three control contexts:
  - Keyboard-only
  - Controller + keyboard
  - Touchscreen

## 8. Risks & Mitigations

- **Risk**: Scope creep (submarines, carriers too early)
  - **Mitigation**: lock v0.1 to destroyers + missiles + drones + mines-lite
- **Risk**: Pathfinding complexity in narrow lanes
  - **Mitigation**: lane corridors + spacing rules instead of full navmesh traffic AI
- **Risk**: Intercept mechanics feel unfair
  - **Mitigation**: telegraphed threats + visible cooldown/readiness UI

## 9. Immediate Next Tasks

1. Initialize Unity project and commit baseline.
2. Create placeholder prefabs for tanker/destroyer/missile/drone.
3. Implement mission scene with two terminal queues and one transit lane.
4. Add basic missile wave script and HP/fire prototype.
