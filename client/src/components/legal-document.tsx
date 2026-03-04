import type { ReactNode } from "react";
import { Link } from "wouter";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Seo, buildPageTitle } from "@/components/seo";
import { useAppName, useAppSettings } from "@/lib/app-settings";
import { useTranslation } from "@/hooks/useTranslation";

const LAST_UPDATED = "2026-03-03";

type LegalSection = {
  title: string;
  content: ReactNode;
};

interface LegalDocumentProps {
  title: string;
  summary: string;
  path: string;
  sections: LegalSection[];
}

export function LegalDocument({
  title,
  summary,
  path,
  sections,
}: LegalDocumentProps) {
  const appName = useAppName();
  const { settings } = useAppSettings();
  const { language, t } = useTranslation();
  const currentYear = new Date().getFullYear();
  const displayName = appName || t("This Service");
  const locale = language === "pt" ? "pt-BR" : language === "es" ? "es-ES" : "en-US";
  const [lastUpdatedYear, lastUpdatedMonth, lastUpdatedDay] = LAST_UPDATED.split("-").map(Number);
  const lastUpdated = new Date(lastUpdatedYear, lastUpdatedMonth - 1, lastUpdatedDay).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-background">
      <Seo
        title={buildPageTitle(title, appName)}
        description={summary}
        path={path}
        image={settings?.og_image_url || settings?.logo_url || "/favicon.png"}
      />

      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-6">
          <Link href="/">
            <div className="flex cursor-pointer items-center gap-2.5" data-testid="legal-home-link">
              {settings?.logo_url ? (
                <img
                  src={settings.logo_url}
                  alt={displayName}
                  className="h-8 w-auto object-contain"
                />
              ) : (
                <>
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-lg"
                    style={{ background: "linear-gradient(45deg, #c4b5fd, #fbcfe8, #fed7aa)" }}
                  >
                    <Sparkles className="h-4 w-4 text-violet-800" />
                  </div>
                  <span className="hidden text-base font-bold tracking-tight sm:inline">
                    {displayName}
                  </span>
                </>
              )}
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <a
              href="/privacy"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("Privacy")}
            </a>
            <a
              href="/terms"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("Terms")}
            </a>
            <Link href="/login">
              <Button variant="outline" size="sm">
                {t("Sign In")}
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="px-6 py-12 md:py-16">
        <div className="mx-auto max-w-4xl">
          <div className="rounded-3xl border bg-card/60 p-8 shadow-sm md:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {t("Last updated")} {lastUpdated}
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-5xl">
              {title}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg">
              {summary}
            </p>
          </div>

          <div className="mt-10 space-y-8">
            {sections.map((section) => (
              <section
                key={section.title}
                className="rounded-2xl border bg-card/40 p-6 shadow-sm md:p-8"
              >
                <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
                  {section.title}
                </h2>
                <div className="mt-4 space-y-4 text-sm leading-7 text-muted-foreground md:text-base">
                  {section.content}
                </div>
              </section>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto max-w-5xl px-6 py-8 text-sm text-muted-foreground">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>{displayName}</p>
            <div className="flex items-center gap-4">
              <a href="/privacy" className="transition-colors hover:text-foreground">
                {t("Privacy Policy")}
              </a>
              <a href="/terms" className="transition-colors hover:text-foreground">
                {t("Terms of Service")}
              </a>
            </div>
          </div>
          <p className="mt-3 text-xs">&copy; {currentYear} {displayName}. {t("All rights reserved.")}</p>
        </div>
      </footer>
    </div>
  );
}
