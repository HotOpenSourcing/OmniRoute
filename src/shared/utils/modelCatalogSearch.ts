export type ModelCatalogSource =
  | "system"
  | "custom"
  | "imported"
  | "fallback"
  | "alias"
  | "acp-runtime"
  | "session-runtime"
  | "local-catalog";

type ModelCatalogTarget = {
  modelId?: string | null;
  modelName?: string | null;
  alias?: string | null;
  source?: string | null;
};

function normalizeText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeModelCatalogSource(source?: string | null): ModelCatalogSource {
  const normalized = normalizeText(source);

  if (
    normalized === "api-sync" ||
    normalized === "synced" ||
    normalized === "auto-sync" ||
    normalized === "imported"
  ) {
    return "imported";
  }
  if (normalized === "fallback") return "fallback";
  if (normalized === "alias") return "alias";
  if (normalized === "acp_runtime" || normalized === "acp-runtime") return "acp-runtime";
  if (normalized === "session_runtime" || normalized === "session-runtime") {
    return "session-runtime";
  }
  if (normalized === "local_catalog" || normalized === "local-catalog") return "local-catalog";
  if (normalized === "custom" || normalized === "manual") {
    return "custom";
  }

  return "system";
}

export function getModelCatalogSourceLabel(source?: string | null): string {
  switch (normalizeModelCatalogSource(source)) {
    case "imported":
      return "Imported";
    case "custom":
      return "Custom";
    case "fallback":
      return "Fallback";
    case "alias":
      return "Alias";
    case "acp-runtime":
      return "Runtime ACP";
    case "session-runtime":
      return "Session Runtime";
    case "local-catalog":
      return "Static Catalog";
    case "system":
    default:
      return "Built-in";
  }
}

function getModelCatalogSourceSearchText(source?: string | null): string {
  switch (normalizeModelCatalogSource(source)) {
    case "imported":
      return "synced api imported discovered";
    case "custom":
      return "custom manual imported";
    case "fallback":
      return "fallback compatible";
    case "alias":
      return "alias shortcut";
    case "acp-runtime":
      return "runtime acp live session discovered windsurf";
    case "session-runtime":
      return "session runtime live fallback discovered windsurf";
    case "local-catalog":
      return "static catalog offline bootstrap cached windsurf";
    case "system":
    default:
      return "built-in builtin official catalog";
  }
}

export function matchesModelCatalogQuery(query: string, target: ModelCatalogTarget): boolean {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;

  const haystacks = [
    normalizeText(target.modelId),
    normalizeText(target.modelName),
    normalizeText(target.alias),
    getModelCatalogSourceSearchText(target.source),
  ].filter(Boolean);

  return haystacks.some((value) => value.includes(normalizedQuery));
}
