export const createConditionalCollector = (
  name: string,
  trustLevel: "passive_proven" | "passive_probable" | "rejected"
) => ({
  name,
  trustLevel,
  async *start() {
    if (trustLevel !== "passive_proven") {
      return;
    }
  },
});
