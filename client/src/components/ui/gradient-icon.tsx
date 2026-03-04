import type { LucideIcon } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/utils";

interface GradientIconProps {
  icon: LucideIcon;
  className?: string;
}

export function GradientIcon({ icon: Icon, className }: GradientIconProps) {
  const id = useId();
  // Using softer, less saturated colors (violet-400, pink-400, orange-400)
  return (
    <>
      <svg width="0" height="0" className="absolute">
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop stopColor="#a78bfa" offset="0%" />
          <stop stopColor="#f472b6" offset="50%" />
          <stop stopColor="#fb923c" offset="100%" />
        </linearGradient>
      </svg>
      <Icon className={cn(className)} style={{ stroke: `url(#${id})` }} />
    </>
  );
}
