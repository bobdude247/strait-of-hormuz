# Strait of Hormuz — Game Design Document (Draft v0.1)

## 1. Game Summary

`Strait of Hormuz` is a tactical naval escort game where the player protects oil tanker convoys through a narrow, high-threat maritime chokepoint.

### Pillars

1. **Protection under pressure** — Keep vulnerable tankers alive through layered defense.
2. **Threat prioritization** — Decide which threats to engage first with limited weapons and time.
3. **Traffic management** — Move convoys through congested lanes without creating bottlenecks.

## 2. Player Fantasy

You are the allied naval commander orchestrating destroyers and support assets to keep global energy lifelines open.

## 3. Core Loop

1. Select convoy and launch window from queued tankers.
2. Assign escort posture (tight screen, distributed picket, aggressive forward defense).
3. Transit through threat zones while detecting and intercepting incoming attacks.
4. Conduct damage control on struck tankers and escorts.
5. Deliver surviving tankers to the destination queue and score performance.

## 4. Play Session Structure

- **Mode**: Single mission scenario (prototype)
- **Session length**: 10–20 minutes target
- **End conditions**:
  - Win: meet minimum delivered tanker quota before timer ends
  - Loss: exceed tanker losses, or mission timer expires with insufficient deliveries

## 5. Map & Environment

## 5.1 Geography

- Simplified representation of the Strait of Hormuz with two terminal zones:
  - Western traffic staging zone
  - Eastern traffic staging zone
- Narrow lanes and island/shoreline threat arcs create natural chokepoints.

## 5.2 Lanes & Congestion

- Tankers spawn into queues at either end.
- Lanes support limited concurrent vessels.
- Damaged/sunk ships can obstruct movement and rerouting.

## 6. Factions

## 6.1 Allied (Player)

- Destroyers (initial controllable combat platform)
- Tankers (high-value protected units)
- Optional future: frigates, carriers, helicopters, submarines

## 6.2 Hostile (AI)

- Shore missile batteries
- Drone launch cells
- Fast attack boats (future v0.2)
- Mine layers / midget submarines (future v0.2+)

## 7. Unit Roles

## 7.1 Tankers

- Slow, lightly defended, mission-critical
- Health states:
  - Intact
  - Damaged
  - Burning
  - Sunk
- Burning state accumulates over time; unresolved fire causes eventual sinking.

## 7.2 Destroyers

- Multi-role defense platform
- Primary functions:
  - Detect threats (radar envelope)
  - Intercept missiles/drones (AA/CIWS abstraction)
  - Engage surface attackers
  - Assist tanker damage control via proximity support bonus

## 8. Threats

## 8.1 Anti-Ship Missiles

- Launched from shoreline zones at intervals or scripted waves.
- High lethality vs tankers, moderate vs escorts.
- Interceptable by escort defensive systems.

## 8.2 Drone Swarms

- Lower per-hit damage but high saturation pressure.
- Can exhaust interceptor capacity and open windows for missiles.

## 8.3 Naval Mines (Prototype-light)

- Static hazards in predefined subzones.
- Trigger on transit; cause immediate damage and possible fire start chance.

## 9. Damage, Fire, and Sinking

## 9.1 Damage Model (v0.1)

- Each ship has HP and status effects.
- Incoming hits apply:
  - Immediate HP loss
  - Chance to trigger `Burning`

## 9.2 Fire Escalation

- Burning applies periodic HP loss.
- Fire intensity levels (1–3) increase damage per tick.
- High intensity raises sink probability if untreated.

## 9.3 Firefighting Gameplay

- Player may issue `Damage Control` command to a burning tanker.
- Effects:
  - Temporarily reduces speed
  - Consumes limited cooldown/resource
  - Gradually reduces fire intensity if escort support is nearby

## 10. Player Commands (Prototype UX)

- Select ship/group
- Set waypoint / route
- Set escort formation mode
- Prioritize target class (missile/drone/surface)
- Trigger damage control on selected tanker

## 10.1 Input Modalities (New Requirement)

The game must support three control contexts from the prototype stage:

1. **Keyboard-only (PC)**
2. **Controller + keyboard hybrid (PC)**
3. **Touchscreen (phone/tablet)**

Design constraint: all three modalities must expose the same gameplay command set, even if UI presentation differs.

## 10.2 Input UX Goals

- No command should require mouse-only interaction.
- Core actions (select, move, prioritize threat, activate damage control) must be reachable in <=2 interactions.
- Touch UI must prioritize larger targets and low-precision gestures.
- Controller navigation must support snapping between relevant entities and HUD widgets.

## 10.3 Baseline Control Mapping

### Keyboard-only

- Group cycling: `Tab` / `Shift+Tab`
- Unit selection shortcuts: number keys
- Command mode: `Q` (move), `E` (escort posture), `R` (target priority), `F` (damage control)
- Confirm/cancel: `Enter` / `Backspace`
- Camera pan/zoom: `WASD` / `+ -`

### Controller + Keyboard Hybrid

- Left stick: camera pan
- Right stick: selection cursor / focus shift
- `A/Cross`: confirm/select
- `B/Circle`: cancel/back
- `X/Square` and `Y/Triangle`: cycle command categories
- D-pad: quick target priority changes
- Keyboard remains valid for advanced direct hotkeys

### Touchscreen

- Tap: select ship/group
- Drag: set move waypoint
- Long-press: open contextual radial command menu
- Two-finger drag/pinch: camera pan/zoom
- Dedicated bottom action bar for priority commands and damage control

## 11. Progression & Difficulty

## 11.1 Mission Difficulty Drivers

- Attack wave frequency
- Threat mix complexity
- Weather/visibility modifiers (future)
- Traffic density at terminals

## 11.2 Scoring

- + points per tanker delivered
- − points per tanker lost
- − points for escort losses
- + efficiency bonus for low average tanker damage and quick fire suppression

## 12. Win/Loss Conditions (Detailed)

### Win

- Deliver `N` of `M` tankers within mission time.

### Loss

- Tanker losses exceed threshold `L`, **or**
- Mission timer reaches zero with deliveries below target.

## 13. AI Behavior (v0.1)

- Shore batteries choose nearest high-value convoy target.
- Drone waves prefer saturating nearest escort umbrella edge.
- Hostile attack cadence uses weighted random + scripted spikes.

## 14. Audio/Visual Direction (Prototype)

- Top-down tactical map with clean iconography
- Clear threat telegraph lines for missile trajectories
- Visible burning/smoke states on tankers
- Distinct alert audio for missile lock, fire outbreak, and critical hull

### Accessibility/Readability Notes

- Minimum touch target size for mobile command buttons
- High-contrast threat indicators for small displays
- Optional icon+text labels for controller-focused navigation

## 15. Out of Scope (v0.1)

- Playable aircraft carriers
- Full anti-submarine warfare simulation
- Complex logistics/economy meta-layer
- Multiplayer

## 16. Future Expansion Hooks

- Allied aviation assets (helo patrols, AEW)
- Submarine threats and sonar gameplay
- Minesweeping operations
- Dynamic political event modifiers
- Campaign mode across multiple chokepoints
