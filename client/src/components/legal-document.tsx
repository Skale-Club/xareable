import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Seo, buildPageTitle } from "@/components/seo";
import { useAppName, useAppSettings } from "@/lib/app-settings";
import { useTranslation } from "@/hooks/useTranslation";
import { LanguageToggle } from "@/components/ui/LanguageToggle";
import { Logo } from "@/components/logo";
import { useQuery } from "@tanstack/react-query";
import type { LandingContent } from "@shared/schema";

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

  const { data: content } = useQuery<LandingContent>({
    queryKey: ["/api/landing/content"],
    queryFn: () => fetch("/api/landing/content").then(res => res.json()),
  });

  const termsHref = settings?.terms_url || "/terms";
  const privacyHref = settings?.privacy_url || "/privacy";

  return (
    <div className="min-h-screen bg-background">
      <Seo
        title={buildPageTitle(title, appName)}
        description={summary}
        path={path}
        image={settings?.og_image_url || settings?.logo_url || "/favicon.png"}
      />

      {/* Global Header - Same as Landing Page */}
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 px-6 h-16">
          <Link href="/">
            <Logo
              logoUrl={content?.logo_url}
              altLogoUrl={content?.alt_logo_url}
            />
          </Link>
          <div className="flex items-center gap-3">
            <LanguageToggle />
            <Link href="/login?tab=signup">
              <Button
                size="sm"
                className="border-0 text-white font-semibold"
                style={{ background: "linear-gradient(45deg, #8b5cf6, #f472b6, #fb923c)" }}
              >
                {t("Get Started")}
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="px-6 py-12 md:py-16">
        <div className="mx-auto max-w-4xl">
          <div className="mb-12">
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

          <div className="space-y-10">
            {sections.map((section) => (
              <section key={section.title}>
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

      {/* Global Footer - Same as Landing Page */}
      <footer className="border-t">
        <div className="max-w-6xl mx-auto px-6 py-10">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="cursor-pointer">
                <Logo
                  logoUrl={content?.logo_url}
                  altLogoUrl={content?.alt_logo_url}
                  imageClassName="h-7 w-auto"
                  fallbackIconClassName="w-7 h-7 rounded-md"
                  fallbackSparklesClassName="w-3.5 h-3.5"
                  fallbackTextClassName="text-sm font-semibold"
                />
              </div>
              <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
                <span>{appName}</span>
                <a
                  href={privacyHref}
                  className="transition-colors hover:text-foreground"
                >
                  {t("Privacy Policy")}
                </a>
                <a
                  href={termsHref}
                  className="transition-colors hover:text-foreground"
                >
                  {t("Terms of Service")}
                </a>
              </div>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              &copy; {currentYear} {displayName}. {t("All rights reserved.")}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
