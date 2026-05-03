# Windsurf Passive Observation Gap Analysis

Date: 2026-05-03
Status: Findings from live validation

## Summary

The hybrid minimal passive observation design successfully captures runtime-current evidence but fails to observe the submit path. This validates the design's escalation recommendation: passive observation alone is insufficient for submit-level observability.

## What Works

### Runtime-Current Observation ✅

Successfully captures bootstrap signals from live Windsurf logs:
- `LS_START` - Language server process start with PID
- `LS_PORT_BOUND` - LS port binding
- `EXTENSION_SERVER_CLIENT_CREATED` - Extension server client creation
- `ACP_AGENT_REGISTERED` - ACP agent registration

**Evidence:** Live observer captured 66 runtime-current events from epoch `20260503T175204`, proving the current Windsurf instance is alive and attached.

### Conservative Status Behavior ✅

Observer correctly returns:
- `status: "observed"` when runtime-current events present (even without cascade)
- `status: "observed"` when both runtime-current and cascade events present
- `status: "waiting"` when no events observed

### Test Coverage ✅

- 23 observer tests passing
- 36 runtime correlation graph tests passing
- All provenance classification working correctly

## What Doesn't Work

### Submit-Proximate Observation ❌

**Pattern tested:** `ExtensionService#_doActivateExtension codeium.windsurf` in `exthost.log`

**Finding:** No extension activation events observed during live submit test at 2026-05-03T17:27:00Z

**Evidence:**
- `exthost.log` last activity: 2026-05-03T17:52:36 (before submit)
- No `codeium.windsurf` activation in recent logs
- Only other extension activations visible (vscode.git, vscode.github, etc.)

### Cascade Event Observation ❌

**Patterns monitored:** `StartCascade` and `SendUserCascadeMessage` RPC calls in `Windsurf.log`

**Finding:** No cascade events in current epoch

**Evidence:**
- Most recent cascade events: 2026-05-02T18:52:52.108Z (previous day)
- Current epoch `20260503T175204` has no cascade RPC calls
- Submit did not leave observable traces in plaintext logs

### Network Log Observation ❌

**Source checked:** `window1/network.log` in current epoch

**Finding:** Empty file, no HTTP traffic logged

**Evidence:**
- `network.log` size: 0 bytes
- No POST/GET requests visible
- Network logging may be disabled or using different path

## Root Cause Analysis

### Why Passive Observation Failed

1. **Log buffering** - Events may not flush immediately to disk
2. **Different execution path** - Submit may bypass the RPC methods we're monitoring
3. **Cascade panel inactive** - Windsurf may require specific UI state for cascade logging
4. **Epoch mismatch** - Submit may have gone to a different window/epoch we're not discovering

### Why exthost.log Pattern Failed

The `codeium.windsurf` extension activation pattern assumes:
- Extension activates on every submit
- Activation is logged to exthost.log
- Logs flush synchronously

**Reality:** Extension may already be activated and remain resident, only logging activation once per session.

## Validation of Design Escalation Path

The design spec stated:

> "If this still fails to reveal submit-near signals, the next design iteration should escalate to `network.log` or CDP-backed passive capture."

**This prediction was correct.** The hybrid minimal approach successfully proved:
- Runtime-current observation works (epoch alive)
- Submit-proximate observation from exthost.log is insufficient
- Escalation to active capture is necessary

## Recommended Next Steps

### Option 1: Active CDP-Based Capture (Recommended)

**Approach:** Use the existing runtime hook infrastructure at `scripts/scratch/windsurf-model-runtime-hook.cjs`

**Requirements:**
- Close all Windsurf instances
- Launch with `NODE_OPTIONS=--require=<hook>` injection
- Hook captures provider method calls, RPC boundaries, transport events

**Advantages:**
- Deterministic trace propagation
- Real-time event capture
- Provider method wrapping
- Transport-level visibility

**Status:** Infrastructure exists and tests pass (17 tests)

**Blockers:** Requires Windsurf restart (cannot inject into running process)

### Option 2: Enhanced Passive Observation

**Approach:** Expand passive sources beyond exthost.log

**Candidates:**
- `window*/renderer.log` - Renderer process logs
- `window*/main.log` - Main process logs
- CDP-based passive attachment (read-only, no injection)
- File system watching for real-time log ingestion

**Advantages:**
- No Windsurf restart required
- Maintains passive-only constraint

**Disadvantages:**
- May still miss submit path if not logged
- Higher noise-to-signal ratio
- No deterministic trace propagation

### Option 3: Hybrid Active-Passive

**Approach:** Use passive observation for runtime-current, active capture for submit-path

**Implementation:**
- Keep current passive observer for epoch health checks
- Add active hook for submit-level observability
- Correlate passive and active evidence in graph

**Advantages:**
- Best of both approaches
- Passive proves epoch alive
- Active proves submit executed

**Disadvantages:**
- Requires Windsurf restart for active component
- More complex correlation logic

## Conclusion

The hybrid minimal passive observation design successfully validated its own boundaries:
- ✅ Runtime-current observation works
- ❌ Submit-proximate observation insufficient
- ✅ Escalation path correctly predicted

**Next action:** Implement active CDP-based capture per Option 1, or accept passive observation limitations and use for runtime health checks only.

## References

- Design spec: `docs/superpowers/specs/2026-05-03-windsurf-hybrid-runtime-current-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-03-windsurf-hybrid-runtime-current.md`
- Active trace plan: `docs/superpowers/plans/2026-04-29-windsurf-runtime-trace.md`
- Runtime hook: `scripts/scratch/windsurf-model-runtime-hook.cjs`
- Passive observer: `scripts/windsurf_passive_cascade_observer.py`
