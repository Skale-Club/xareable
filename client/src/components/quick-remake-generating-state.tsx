import { GeneratingLoader } from "@/components/ui/generating-loader";
import { Progress } from "@/components/ui/progress";
import { useTranslation } from "@/hooks/useTranslation";

interface QuickRemakeGeneratingStateProps {
  progress: number;
  message: string;
}

export function QuickRemakeGeneratingState({ progress, message }: QuickRemakeGeneratingStateProps) {
  const { t } = useTranslation();

  return (
    <div className="w-full max-w-sm text-center">
      <div className="mb-6">
        <GeneratingLoader size={0.6} />
      </div>
      <h2 className="text-xl font-semibold mb-2">{t("Creating Your Post")}</h2>
      <p className="text-sm text-muted-foreground mb-6">
        {message ? t(message) : ""}
      </p>
      <Progress value={progress} className="h-2" />
      <p className="text-xs text-muted-foreground mt-2">
        {Math.round(progress)}%
      </p>
    </div>
  );
}
