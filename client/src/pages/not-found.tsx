import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Seo, buildPageTitle } from "@/components/seo";
import { useAppName } from "@/lib/app-settings";

export default function NotFound() {
  const appName = useAppName();

  return (
    <>
      <Seo
        title={buildPageTitle("Page Not Found", appName)}
        description="The page you requested could not be found."
        path={window.location.pathname}
        noindex
      />
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2" data-testid="text-404">Page Not Found</h1>
            <p className="text-sm text-muted-foreground mb-4">
              The page you're looking for doesn't exist.
            </p>
            <Link href="/">
              <Button data-testid="button-go-home">Go Home</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
