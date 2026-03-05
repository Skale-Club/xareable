import { useState } from "react";
import { Sparkles } from "lucide-react";
import { motion, useMotionTemplate, useMotionValue } from "framer-motion";
import { useAppName } from "@/lib/app-settings";
import { cn } from "@/lib/utils";

interface LogoProps {
    logoUrl?: string | null;
    altLogoUrl?: string | null;
    imageClassName?: string;
    containerClassName?: string;
    fallbackIconClassName?: string;
    fallbackSparklesClassName?: string;
    fallbackTextClassName?: string;
    showFallbackText?: boolean;
}

export function Logo({
    logoUrl,
    altLogoUrl,
    imageClassName = "h-8 w-auto",
    containerClassName = "flex items-center gap-2.5 cursor-pointer group relative",
    fallbackIconClassName = "w-8 h-8 rounded-lg",
    fallbackSparklesClassName = "w-4 h-4",
    fallbackTextClassName = "font-bold text-base tracking-tight hidden sm:inline",
    showFallbackText = true,
}: LogoProps) {
    const appName = useAppName();
    const [isHoveringLogo, setIsHoveringLogo] = useState(false);
    const logoMouseX = useMotionValue(0);
    const logoMouseY = useMotionValue(0);

    const logoRevealMask = useMotionTemplate`radial-gradient(45px circle at ${logoMouseX}px ${logoMouseY}px, black 0%, transparent 100%)`;

    const handleLogoMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        logoMouseX.set(e.clientX - rect.left);
        logoMouseY.set(e.clientY - rect.top);
    };

    return (
        <div
            className={cn("group relative", containerClassName)}
            data-testid="link-logo"
        >
            {logoUrl ? (
                <div
                    className="relative inline-block"
                    onMouseEnter={() => setIsHoveringLogo(true)}
                    onMouseLeave={() => setIsHoveringLogo(false)}
                    onMouseMove={handleLogoMouseMove}
                >
                    <img
                        src={logoUrl}
                        alt={appName}
                        className={cn(imageClassName, "object-contain block relative z-0")}
                    />
                    {altLogoUrl && (
                        <motion.img
                            src={altLogoUrl}
                            alt={appName}
                            className="object-contain absolute inset-0 h-full w-full z-10 pointer-events-none transition-opacity duration-300"
                            style={{
                                opacity: isHoveringLogo ? 1 : 0,
                                maskImage: logoRevealMask,
                                WebkitMaskImage: logoRevealMask, // Safari compatibility
                            }}
                        />
                    )}
                </div>
            ) : (
                <>
                    <div
                        className={`${fallbackIconClassName} flex items-center justify-center flex-shrink-0 transition-all duration-300 group-hover:shadow-[0_0_15px_rgba(244,114,182,0.5)]`}
                        style={{ background: "linear-gradient(45deg, #c4b5fd, #fbcfe8, #fed7aa)" }}
                    >
                        <Sparkles className={`${fallbackSparklesClassName} text-violet-800 transition-colors duration-300 group-hover:text-pink-600`} />
                    </div>
                    {showFallbackText && (
                        <span className={`${fallbackTextClassName} transition-colors duration-300 group-hover:bg-clip-text group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:from-violet-500 group-hover:via-pink-500 group-hover:to-orange-500`}>
                            {appName}
                        </span>
                    )}
                </>
            )}
        </div>
    );
}
