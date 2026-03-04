import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LanguageToggle } from "@/components/ui/LanguageToggle";
import {
  Sparkles,
  Zap,
  Image as ImageIcon,
  Palette,
  Type,
  ArrowRight,
  CheckCircle2,
  Layers,
  Wand2,
  Star,
} from "lucide-react";
import { motion, useReducedMotion, useMotionValue, useMotionTemplate, useTransform } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import type { LandingContent } from "@shared/schema";
import { useAppName, useAppSettings } from "@/lib/app-settings";
import { Seo } from "@/components/seo";
import { useTranslation } from "@/hooks/useTranslation";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.1, ease: "easeOut" },
  }),
};

const heroHighlightGradientStyle = {
  backgroundImage: "linear-gradient(45deg, #a78bfa, #f9a8d4, #fdba74)",
};

function isExternalLink(href: string) {
  return /^https?:\/\//i.test(href);
}

const FEATURES = [
  {
    icon: Wand2,
    title: "AI-Powered Design",
    description:
      "Generate professional social media graphics in seconds. Our AI understands your brand and creates visuals that match your identity.",
  },
  {
    icon: Type,
    title: "Smart Copy Engine",
    description:
      "Just type your message. The AI splits it into a punchy headline and subtext, and writes an engaging caption with hashtags.",
  },
  {
    icon: Palette,
    title: "Brand-Consistent Output",
    description:
      "Your colors, your brand style, your post mood. Every generated post stays true to your brand guidelines automatically.",
  },
  {
    icon: Layers,
    title: "Multiple Formats",
    description:
      "Square for feeds, landscape for covers, portrait for stories. Choose your format and get perfectly sized content.",
  },
  {
    icon: ImageIcon,
    title: "Text-on-Image Rendering",
    description:
      "No more editing in Canva. The AI natively renders your headline and subtext directly onto the generated image.",
  },
  {
    icon: Zap,
    title: "One-Click Workflow",
    description:
      "From idea to publish-ready asset in a single click. Download instantly or save to your post history for later.",
  },
];

const STEPS = [
  {
    number: "01",
    title: "Set Up Your Brand",
    description:
      "Tell us your company name, pick your brand colors, choose a style, and upload your logo. Takes under 2 minutes.",
  },
  {
    number: "02",
    title: "Describe Your Post",
    description:
      "Pick a post mood, type the text you want on the image, and choose a format.",
  },
  {
    number: "03",
    title: "Generate & Download",
    description:
      "Hit Generate. The AI creates a stunning branded graphic with your text, plus a social media caption with hashtags.",
  },
];

const TESTIMONIALS = [
  {
    name: "Sarah Chen",
    role: "Marketing Director",
    text: "We used to spend hours per post with our design team. Now we generate branded content in seconds.",
    stars: 5,
  },
  {
    name: "James Mitchell",
    role: "Small Business Owner",
    text: "I don't have a designer on staff. This tool lets me create professional social media content that actually looks good.",
    stars: 5,
  },
  {
    name: "Priya Sharma",
    role: "Social Media Manager",
    text: "The brand consistency is incredible. Every post feels like it came from the same design system.",
    stars: 5,
  },
];

export default function LandingPage() {
  const appName = useAppName();
  const { settings } = useAppSettings();
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const currentYear = new Date().getFullYear();
  const termsHref = settings?.terms_url || "/terms";
  const privacyHref = settings?.privacy_url || "/privacy";
  const termsExternal = isExternalLink(termsHref);
  const privacyExternal = isExternalLink(privacyHref);
  const { data: content } = useQuery<LandingContent>({
    queryKey: ["/api/landing/content"],
    queryFn: () => fetch("/api/landing/content").then(res => res.json()),
  });
  const description =
    content?.hero_subtext ||
    settings?.meta_description ||
    settings?.app_description ||
    undefined;
  const title = settings?.meta_title || settings?.app_name || undefined;

  const mouseX = useMotionValue(0.5);
  const mouseY = useMotionValue(0.5);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Normalize to a 0-1 range
      mouseX.set(e.clientX / window.innerWidth);
      mouseY.set(e.clientY / window.innerHeight);
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [mouseX, mouseY]);

  // Map mouse movement to a wider range so smaller movements are more noticeable.
  // Using backgroundSize 300% means we have enough room to move without hitting edges
  // The usable range for a 300% background is roughly 0% to 100%
  const bgX = useTransform(mouseX, [0, 1], [0, 100]);
  const bgY = useTransform(mouseY, [0, 1], [0, 100]);
  const backgroundPosition = useMotionTemplate`${bgX}% ${bgY}%`;

  // Moderately sensitive rotation
  const bgAngle = useTransform(mouseX, [0, 1], [0, 90]);
  const backgroundImage = useMotionTemplate`linear-gradient(${bgAngle}deg, #a78bfa 0%, #f9a8d4 50%, #fdba74 100%)`;

  const renderHeroHighlight = (text: string) => (
    <motion.span
      className="inline-block bg-clip-text text-transparent"
      style={{
        backgroundImage,
        backgroundSize: "300% 300%",
        backgroundPosition,
      }}
    >
      {text}
    </motion.span>
  );
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: appName,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      url: window.location.origin,
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: appName,
      url: window.location.origin,
      description,
      logo: settings?.logo_url || settings?.og_image_url || `${window.location.origin}/favicon.png`,
    },
  ];

  return (
    <div className="min-h-screen bg-background" data-testid="landing-page">
      <Seo
        title={title}
        description={description}
        path="/"
        image={settings?.og_image_url || settings?.logo_url || "/favicon.png"}
        favicon={content?.icon_url || settings?.favicon_url || "/favicon.png"}
        jsonLd={structuredData}
      />
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 px-6 h-16">
          <Link href="/">
            <div className="flex items-center gap-2.5 cursor-pointer group" data-testid="link-logo">
              {content?.logo_url ? (
                <img
                  src={content.logo_url}
                  alt={appName}
                  className="h-8 w-auto object-contain"
                />
              ) : (
                <>
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300 group-hover:shadow-[0_0_15px_rgba(244,114,182,0.5)]"
                    style={{ background: "linear-gradient(45deg, #c4b5fd, #fbcfe8, #fed7aa)" }}
                  >
                    <Sparkles className="w-4 h-4 text-violet-800 transition-colors duration-300 group-hover:text-pink-600" />
                  </div>
                  <span className="font-bold text-base tracking-tight hidden sm:inline transition-colors duration-300 group-hover:bg-clip-text group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:from-violet-500 group-hover:via-pink-500 group-hover:to-orange-500">
                    {appName}
                  </span>
                </>
              )}
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <LanguageToggle />
            <Link href="/login">
              <Button variant="outline" size="sm" data-testid="nav-login">
                {t("Sign In")}
              </Button>
            </Link>
            <Link href="/login?tab=signup">
              <Button
                size="sm"
                className="border-0 text-white font-semibold"
                style={{ background: "linear-gradient(45deg, #8b5cf6, #f472b6, #fb923c)" }}
                data-testid="nav-signup"
              >
                {t("Get Started")}
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-[-80px] left-[10%] w-[500px] h-[500px] rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(196,181,253,0.18) 0%, transparent 70%)" }} />
          <div className="absolute top-[120px] right-[5%] w-[400px] h-[400px] rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(251,207,232,0.15) 0%, transparent 70%)" }} />
          <div className="absolute bottom-0 left-1/2 w-[600px] h-[300px] rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(254,215,170,0.12) 0%, transparent 70%)" }} />
        </div>

        <div className="max-w-6xl mx-auto px-6 pt-10 pb-12 md:pt-14 md:pb-16">
          <div className="grid grid-cols-1 lg:grid-cols-[7fr_3fr] md:grid-cols-[2fr_1fr] gap-8 lg:gap-12 items-center">
            <div className="text-center md:text-left">
              <motion.div
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                custom={0}
                className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium mb-6 border border-transparent"
                style={{
                  background: "linear-gradient(var(--background), var(--background)) padding-box, linear-gradient(45deg, #c4b5fd, #fbcfe8, #fed7aa) border-box",
                }}
	              >
	                <Sparkles className="w-3.5 h-3.5 text-pink-300" />
	                <span
	                  className="font-semibold bg-clip-text text-transparent"
	                  style={{ backgroundImage: "linear-gradient(45deg, #a78bfa, #f9a8d4, #fdba74)" }}
	                >
	                  {t("AI-Powered Social Media Content")}
	                </span>
	              </motion.div>

              <motion.h1
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                custom={1}
                className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.1] mb-6 max-w-3xl mx-auto md:mx-0"
	              >
	                {(() => {
	                  const fullText = t(content?.hero_headline || "Create and Post Stunning Social Posts in Seconds");

                  if (fullText.includes("**")) {
                    const parts = fullText.split("**");
                    return (
                      <>
                        {parts[0]}
                        {renderHeroHighlight(parts[1])}
                        {parts[2]}
                      </>
                    );
                  }

                  const words = fullText.trim().split(" ");
                  if (words.length <= 2) {
                    return (
                      renderHeroHighlight(fullText)
                    );
                  }
                  const lastTwo = words.slice(-2).join(" ");
                  const rest = words.slice(0, -2).join(" ");
                  return (
                    <>
                      {rest}{" "}
                      {renderHeroHighlight(lastTwo)}
                    </>
                  );
                })()}
              </motion.h1>

	              <motion.p
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                custom={2}
                className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto md:mx-0 mb-10 leading-relaxed"
	              >
	                {t(content?.hero_subtext || "Generate brand-consistent social media images and captions with AI. Just type your message, pick a style, and let the AI do the rest.")}
	              </motion.p>

              <motion.div
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                custom={3}
                className="flex flex-col sm:flex-row items-center justify-center md:justify-start gap-3"
              >
                <Link href="/login?tab=signup">
                  <motion.div
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: "spring", stiffness: 400, damping: 10 }}
                  >
                    <Button
                      size="lg"
                      className="text-base px-8 border-0 text-white font-semibold shadow-lg"
                      style={{ background: "linear-gradient(45deg, #8b5cf6, #f472b6, #fb923c)" }}
	                      data-testid="hero-cta"
	                    >
	                      <span className="inline-flex items-center gap-2">
	                        {t(content?.hero_cta_text || "Start Creating for Free")}
	                        <ArrowRight className="w-4 h-4" />
	                      </span>
                    </Button>
                  </motion.div>
                </Link>
	                <a href="#how-it-works">
	                  <Button variant="outline" size="lg" className="text-base px-8 hover-elevate" data-testid="hero-learn-more">
	                    {t(content?.hero_secondary_cta_text || "See How It Works")}
	                  </Button>
	                </a>
              </motion.div>

              {/* Mobile Hero Image */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.8, delay: 0.4 }}
                className="md:hidden mt-8 mb-4 flex justify-center"
              >
                {content?.hero_image_url && (
                  <img
                    src={content.hero_image_url}
                    alt="Platform Preview"
                    className="max-h-[400px] w-auto object-contain drop-shadow-[0_20px_50px_rgba(139,92,246,0.3)]"
                  />
                )}
              </motion.div>

              <motion.div
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                custom={4}
                className="mt-12 flex items-center justify-center md:justify-start gap-6 text-sm text-muted-foreground flex-wrap"
              >
	                {[
	                  "No design skills needed",
	                  "Your brand, your colors",
	                  "Ready in under 30 seconds",
	                ].map((text) => (
	                  <div key={text} className="flex items-center gap-1.5">
	                    <CheckCircle2 className="w-4 h-4 text-pink-300" />
	                    <span>{t(text)}</span>
	                  </div>
	                ))}
              </motion.div>
            </div>

            <div className="hidden md:block relative mt-1 lg:mt-2 xl:mt-3 -ml-20 lg:-ml-32 xl:-ml-48 min-w-[420px] lg:min-w-[480px] xl:min-w-[540px] z-10">
              <motion.div
                initial={{ opacity: 0, scale: 0.9, x: 40 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
                className="relative z-10"
              >
                {content?.hero_image_url ? (
                  <div className="relative flex justify-center lg:justify-end">
                    <motion.div
                      animate={prefersReducedMotion ? undefined : { y: [0, -22, 0] }}
                      transition={prefersReducedMotion ? undefined : { duration: 5, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <img
                        src={content.hero_image_url}
                        alt="Platform Preview"
                        className="w-[340px] lg:w-[400px] xl:w-[450px] h-auto object-contain drop-shadow-[0_20px_50px_rgba(139,92,246,0.3)]"
                      />
                    </motion.div>
                  </div>
                ) : (
                  <div className="aspect-square rounded-2xl bg-gradient-to-br from-violet-500/10 via-pink-500/10 to-orange-500/10 border border-dashed border-white/20 flex items-center justify-center p-12">
                    <ImageIcon className="w-16 h-16 text-muted-foreground/20 animate-pulse" />
                  </div>
                )}
              </motion.div>

              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-violet-600/5 rounded-full blur-[120px] -z-10 animate-pulse" />
            </div>
          </div>
        </div>
      </section>

      <section className="relative border-t bg-slate-50 dark:bg-white/[0.03]">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUp}
            custom={0}
            className="text-center mb-14"
          >
	            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
	              {(() => {
	                const fullText = t(content?.features_title || "Everything You Need to Automate Content");

                if (fullText.includes("**")) {
                  const parts = fullText.split("**");
                  return (
                    <>
                      {parts[0]}
                      {renderHeroHighlight(parts[1])}
                      {parts[2]}
                    </>
                  );
                }

                const words = fullText.trim().split(" ");
                if (words.length <= 2) {
                  return (
                    renderHeroHighlight(fullText)
                  );
                }
                const lastTwo = words.slice(-2).join(" ");
                const rest = words.slice(0, -2).join(" ");
                return (
                  <>
                    {rest}{" "}
                    {renderHeroHighlight(lastTwo)}
                  </>
                );
              })()}
	            </h2>
	            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
	              {t(content?.features_subtitle || "From brand setup to publish-ready graphics, every feature is designed to save you time and keep your content on-brand.")}
	            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-50px" }}
                variants={fadeUp}
                custom={i}
              >
                <Card className="h-full hover-elevate border-border/50">
                  <CardContent className="p-6">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center mb-4"
                      style={{ background: "linear-gradient(45deg, rgba(196,181,253,0.25), rgba(251,207,232,0.25), rgba(254,215,170,0.25))" }}
                    >
                      <feature.icon className="w-5 h-5 text-pink-300" />
                    </div>
	                    <h3 className="font-semibold text-base mb-2">{t(feature.title)}</h3>
	                    <p className="text-sm text-muted-foreground leading-relaxed">
	                      {t(feature.description)}
	                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-t relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute left-0 top-1/2 w-[400px] h-[400px] rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(196,181,253,0.1) 0%, transparent 70%)" }} />
          <div className="absolute right-0 top-1/3 w-[300px] h-[300px] rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(254,215,170,0.1) 0%, transparent 70%)" }} />
        </div>
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUp}
            custom={0}
            className="text-center mb-14"
          >
	            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
	              {t(content?.how_it_works_title || "How It Works")}
	            </h2>
	            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
	              {t(content?.how_it_works_subtitle || "Three simple steps from idea to publish-ready social media content.")}
	            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {STEPS.map((step, i) => (
              <motion.div
                key={step.number}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-50px" }}
                variants={fadeUp}
                custom={i}
                className="relative"
              >
                <div
                  className="text-6xl font-extrabold mb-3 tracking-tight bg-clip-text text-transparent"
                  style={{ backgroundImage: "linear-gradient(45deg, #c4b5fd, #fbcfe8, #fed7aa)" }}
                >
                  {step.number}
                </div>
	                <h3 className="font-semibold text-lg mb-2">{t(step.title)}</h3>
	                <p className="text-sm text-muted-foreground leading-relaxed">
	                  {t(step.description)}
	                </p>
                {i < STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-8 -right-4 w-8">
                    <ArrowRight className="w-5 h-5 text-muted-foreground/30" />
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t bg-slate-50 dark:bg-white/[0.03]">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUp}
            custom={0}
            className="text-center mb-14"
          >
	            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
	              {t(content?.testimonials_title || "Loved by Everybody")}
	            </h2>
	            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
	              {t(content?.testimonials_subtitle || "See what our users are saying about their experience.")}
	            </p>
          </motion.div>

	          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
	            {TESTIMONIALS.map((testimonial, i) => (
	              <motion.div
	                key={testimonial.name}
	                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-50px" }}
                variants={fadeUp}
                custom={i}
              >
	                <Card className="h-full border-border/50">
	                  <CardContent className="p-6">
	                    <div className="flex gap-0.5 mb-3">
	                      {Array.from({ length: testimonial.stars }).map((_, j) => (
	                        <Star
                          key={j}
                          className="w-4 h-4 fill-amber-300 text-amber-300"
	                        />
	                      ))}
	                    </div>
	                    <p className="text-sm leading-relaxed mb-4">"{t(testimonial.text)}"</p>
	                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-violet-800 text-xs font-bold flex-shrink-0"
                        style={{ background: "linear-gradient(45deg, #c4b5fd, #fbcfe8, #fed7aa)" }}
                      >
	                        {testimonial.name[0]}
	                      </div>
	                      <div>
	                        <p className="text-sm font-semibold">{testimonial.name}</p>
	                        <p className="text-xs text-muted-foreground">{t(testimonial.role)}</p>
	                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUp}
            custom={0}
            className="relative max-w-3xl mx-auto rounded-2xl px-8 md:px-12 pt-12 pb-6 md:py-2 transition-all duration-500 bg-gray-50 border border-border/50"
          >
            <div className="absolute inset-0 pointer-events-none -z-10 bg-gradient-to-br from-gray-50 to-gray-100/50" />

	            <div className="relative z-10 grid grid-cols-1 md:grid-cols-[7fr_3fr] gap-4 items-center">
	              <div className="text-center md:text-left">
	                <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-2 text-slate-900">
	                  {t(content?.cta_title || "Ready to Automate Your Content?")}
	                </h2>
	                <p className="text-lg text-slate-700 mb-4">
	                  {t(content?.cta_subtitle || "Join thousands of marketers who create branded social media content in seconds, not hours.")}
	                </p>

                <motion.div
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 400, damping: 10 }}
                  className="inline-block"
                >
                  <Button
                    size="lg"
                    className="text-base px-8 border-0 text-white font-semibold shadow-md"
                    style={{ background: "linear-gradient(45deg, #8b5cf6, #f472b6, #fb923c)" }}
                    data-testid="cta-bottom"
                    asChild
	                  >
	                    <Link href="/login?tab=signup">
	                      <div className="flex items-center gap-2 cursor-pointer w-full h-full justify-center">
	                        {t(content?.cta_button_text || "Get Started Free")}
	                        <ArrowRight className="w-4 h-4 ml-1" />
	                      </div>
                    </Link>
                  </Button>
                </motion.div>
              </div>

              {content?.cta_image_url && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, x: 20 }}
                  whileInView={{ opacity: 1, scale: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.8, delay: 0.2 }}
                  className="flex justify-center md:justify-end"
                >
                  <motion.div
                    animate={prefersReducedMotion ? undefined : { y: [0, -15, 0] }}
                    transition={prefersReducedMotion ? undefined : { duration: 6, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <img
                      src={content.cta_image_url}
                      alt="CTA Preview"
                      className="w-full max-w-[200px] md:max-w-none md:w-[260px] lg:w-[300px] h-auto object-contain drop-shadow-[0_20px_50px_rgba(139,92,246,0.2)] -mb-28 md:-mt-16 md:-mb-24 md:-mr-20 lg:-mr-24"
                    />
                  </motion.div>
                </motion.div>
              )}
            </div>
          </motion.div>
        </div>
      </section>

      <footer className="border-t">
        <div className="max-w-6xl mx-auto px-6 py-10">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2.5 group cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                {content?.logo_url ? (
                  <img
                    src={content.logo_url}
                    alt={appName}
                    className="h-7 w-auto object-contain"
                  />
                ) : (
                  <>
                    <div
                      className="w-7 h-7 rounded-md flex items-center justify-center transition-all duration-300 group-hover:shadow-[0_0_15px_rgba(244,114,182,0.5)]"
                      style={{ background: "linear-gradient(45deg, #c4b5fd, #fbcfe8, #fed7aa)" }}
                    >
                      <Sparkles className="w-3.5 h-3.5 text-violet-800 transition-colors duration-300 group-hover:text-pink-600" />
                    </div>
                    <span className="text-sm font-semibold transition-colors duration-300 group-hover:bg-clip-text group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:from-violet-500 group-hover:via-pink-500 group-hover:to-orange-500">{appName}</span>
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
                <span>{appName}</span>
                <a
                  href={privacyHref}
                  className="transition-colors hover:text-foreground"
                  target={privacyExternal ? "_blank" : undefined}
                  rel={privacyExternal ? "noreferrer noopener" : undefined}
	                >
	                  {t("Privacy Policy")}
	                </a>
                <a
                  href={termsHref}
                  className="transition-colors hover:text-foreground"
                  target={termsExternal ? "_blank" : undefined}
                  rel={termsExternal ? "noreferrer noopener" : undefined}
	                >
	                  {t("Terms of Service")}
	                </a>
	              </div>
	            </div>
	            <p className="text-center text-xs text-muted-foreground">
	              &copy; {currentYear} {appName || t("This Service")}. {t("All rights reserved.")}
	            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
