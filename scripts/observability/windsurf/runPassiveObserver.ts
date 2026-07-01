import {
  createPassiveObservabilityEngine,
  type CanonicalObservedEvent,
} from "@/lib/observability/windsurf";

import { outputPaths } from "./outputPaths";

export const createRunnerArtifacts = () => outputPaths;

export const reduceEventsToLatestState = (events: CanonicalObservedEvent[]) => {
  const engine = createPassiveObservabilityEngine();
  let latest = engine.ingest(events[0]!);

  for (const event of events.slice(1)) {
    latest = engine.ingest(event);
  }

  return latest;
};
