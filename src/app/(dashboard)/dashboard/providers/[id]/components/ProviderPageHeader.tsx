"use client";

// Phase 1t.1 extraction — Issue #3501
import Link from "next/link";
import ProviderIcon from "@/shared/components/ProviderIcon";
import Button from "@/shared/components/Button";
import { getHeaderIconProviderId } from "../providerPageHelpers";
import type { ProviderMessageTranslator } from "../providerPageHelpers";

interface ProviderInfo {
  id: string;
  name: string;
  website?: string;
  color: string;
  apiType?: string;
}

interface ProviderPageHeaderProps {
  providerId: string;
  providerInfo: ProviderInfo;
  connectionsCount: number;
  isOpenAICompatible: boolean;
  isAnthropicProtocolCompatible: boolean;
  onOpenTutorial: () => void;
  onExportProvider?: () => void;
  onImportProvider?: () => void;
  t: ProviderMessageTranslator;
}

export default function ProviderPageHeader({
  providerId,
  providerInfo,
  connectionsCount,
  isOpenAICompatible,
  isAnthropicProtocolCompatible,
  onOpenTutorial,
  onExportProvider,
  onImportProvider,
  t,
}: ProviderPageHeaderProps) {
  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/dashboard/providers"
            className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary transition-colors mb-4"
          >
            <span className="material-symbols-outlined text-lg">arrow_back</span>
            {t("backToProviders")}
          </Link>
          <div className="flex items-center gap-4">
            <div
              className="rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${providerInfo.color}15` }}
            >
              <ProviderIcon
                providerId={getHeaderIconProviderId(
                  isOpenAICompatible,
                  isAnthropicProtocolCompatible,
                  providerInfo.id,
                  providerInfo.apiType
                )}
                size={48}
                type="color"
              />
            </div>
            <div>
              {providerInfo.website ? (
                <a
                  href={providerInfo.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-3xl font-semibold tracking-tight hover:underline inline-flex items-center gap-2"
                  style={{ color: providerInfo.color }}
                >
                  {providerInfo.name}
                  <span className="material-symbols-outlined text-lg opacity-60">open_in_new</span>
                </a>
              ) : (
                <h1 className="text-3xl font-semibold tracking-tight">{providerInfo.name}</h1>
              )}
              <div className="flex items-center gap-2">
                <p className="text-text-muted">
                  {t("connectionCountLabel", { count: connectionsCount })}
                </p>
                {providerId === "adapta-web" && (
                  <button
                    onClick={onOpenTutorial}
                    className="text-sm font-medium underline underline-offset-2 opacity-70 hover:opacity-100 transition-opacity"
                    style={{ color: providerInfo.color }}
                  >
                    Tutorial
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onExportProvider && (
            <Button variant="secondary" size="sm" icon="download" onClick={onExportProvider}>
              {t("exportProvider")}
            </Button>
          )}
          {onImportProvider && (
            <Button variant="secondary" size="sm" icon="upload_file" onClick={onImportProvider}>
              {t("importProvider")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
