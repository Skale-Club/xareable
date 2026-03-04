import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Seo, buildPageTitle } from "@/components/seo";
import { useAppName } from "@/lib/app-settings";
import { useTranslation } from "@/hooks/useTranslation";

export default function NotFound() {
  const appName = useAppName();
  const { t } = useTranslation();

  return (
    <>
      <Seo
        title={buildPageTitle(t("Page Not Found"), appName)}
        description={t("The page you requested could not be found.")}
        path={window.location.pathname}
        noindex
      />
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2" data-testid="text-404">{t("Page Not Found")}</h1>
            <p className="text-sm text-muted-foreground mb-4">
              {t("The page you're looking for doesn't exist.")}
            </p>
            <Link href="/">
              <Button data-testid="button-go-home">{t("Go Home")}</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
