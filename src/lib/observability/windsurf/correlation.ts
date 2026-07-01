import {
  createEmptyCascadeState,
  type CanonicalObservedEvent,
  type CascadeState,
} from "./types";

export const reduceCascadeSignals = (events: CanonicalObservedEvent[]): CascadeState => {
  const state = createEmptyCascadeState();

  for (const event of events) {
    if (event.name === "StartCascade") state.startCascade = true;
    if (event.name === "SendUserCascadeMessage") state.sendUserCascadeMessage = true;
    if (event.name === "AssistantResponseObserved") state.assistantResponse = true;
    if (typeof event.metadata.sessionId === "string" && event.metadata.sessionId.length > 0) {
      state.sessionId = event.metadata.sessionId;
    }
    if (event.metadata.traceCount > state.traceCount) {
      state.traceCount = event.metadata.traceCount;
    }
  }

  return state;
};
