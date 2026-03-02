import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import type { LandingContent } from "@shared/schema";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.1, ease: "easeOut" },
  }),
};

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
      "Your colors, your mood, your style. Every generated post stays true to your brand guidelines automatically.",
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
      "Tell us your company name, pick your brand colors, choose a mood, and upload your logo. Takes under 2 minutes.",
  },
  {
    number: "02",
    title: "Describe Your Post",
    description:
      "Pick a style (Promo, Info, Clean, or Vibrant), type the text you want on the image, and choose a format.",
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
  const { data: content } = useQuery<LandingContent>({
    queryKey: ["/api/landing/content"],
    queryFn: () => fetch("/api/landing/content").then(res => res.json()),
  });

  return (
    <div className="min-h-screen bg-background" data-testid="landing-page">
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 px-6 h-16">
          <Link href="/">
            <div className="flex items-center gap-2.5 cursor-pointer" data-testid="link-logo">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(45deg, #c4b5fd, #fbcfe8, #fed7aa)" }}
              >
                <Sparkles className="w-4 h-4 text-violet-800" />
              </div>
              <span className="font-bold text-base tracking-tight hidden sm:inline">
                My Social Autopilot
              </span>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="outline" size="sm" data-testid="nav-login">
                Sign In
              </Button>
            </Link>
            <Link href="/login?tab=signup">
              <Button
                size="sm"
                className="border-0 text-white font-semibold"
                style={{ background: "linear-gradient(45deg, #8b5cf6, #f472b6, #fb923c)" }}
                data-testid="nav-signup"
              >
                Get Started
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

        <div className="max-w-6xl mx-auto px-6 pt-20 pb-24 md:pt-28 md:pb-32 text-center">
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
              AI-Powered Social Media Content
            </span>
          </motion.div>

          <motion.h1
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={1}
            className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.1] mb-6 max-w-3xl mx-auto"
          >
            {content?.hero_headline || "Create and Post Stunning Social Posts"}{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(45deg, #a78bfa, #f9a8d4, #fdba74)" }}
            >
              in Seconds
            </span>
          </motion.h1>

          <motion.p
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={2}
            className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed"
          >
            {content?.hero_subtext || "Generate brand-consistent social media images and captions with AI. Just type your message, pick a style, and let the AI do the rest."}
          </motion.p>

          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={3}
            className="flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            <Link href="/login?tab=signup">
              <Button
                size="lg"
                className="text-base px-8 border-0 text-white font-semibold shadow-lg"
                style={{ background: "linear-gradient(45deg, #8b5cf6, #f472b6, #fb923c)" }}
                data-testid="hero-cta"
              >
                {content?.hero_cta_text || "Start Creating for Free"}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <a href="#how-it-works">
              <Button variant="outline" size="lg" className="text-base px-8" data-testid="hero-learn-more">
                {content?.hero_secondary_cta_text || "See How It Works"}
              </Button>
            </a>
          </motion.div>

          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={4}
            className="mt-12 flex items-center justify-center gap-6 text-sm text-muted-foreground flex-wrap"
          >
            {[
              "No design skills needed",
              "Your brand, your colors",
              "Ready in under 30 seconds",
            ].map((text) => (
              <div key={text} className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-pink-300" />
                <span>{text}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="relative border-t bg-card/50">
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
              {content?.features_title || "Everything You Need to"}{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: "linear-gradient(45deg, #a78bfa, #f9a8d4, #fdba74)" }}
              >
                Automate Content
              </span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              {content?.features_subtitle || "From brand setup to publish-ready graphics, every feature is designed to save you time and keep your content on-brand."}
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
                    <h3 className="font-semibold text-base mb-2">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {feature.description}
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
              {content?.how_it_works_title || "How It Works"}
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              {content?.how_it_works_subtitle || "Three simple steps from idea to publish-ready social media content."}
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
                <h3 className="font-semibold text-lg mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {step.description}
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

      <section className="border-t bg-card/50">
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
              {content?.testimonials_title || "Loved by Marketers"}
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              {content?.testimonials_subtitle || "See what our users are saying about their experience."}
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <motion.div
                key={t.name}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-50px" }}
                variants={fadeUp}
                custom={i}
              >
                <Card className="h-full border-border/50">
                  <CardContent className="p-6">
                    <div className="flex gap-0.5 mb-3">
                      {Array.from({ length: t.stars }).map((_, j) => (
                        <Star
                          key={j}
                          className="w-4 h-4 fill-amber-300 text-amber-300"
                        />
                      ))}
                    </div>
                    <p className="text-sm leading-relaxed mb-4">"{t.text}"</p>
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-violet-800 text-xs font-bold flex-shrink-0"
                        style={{ background: "linear-gradient(45deg, #c4b5fd, #fbcfe8, #fed7aa)" }}
                      >
                        {t.name[0]}
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{t.name}</p>
                        <p className="text-xs text-muted-foreground">{t.role}</p>
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
            className="relative rounded-2xl p-10 md:p-16 text-center overflow-hidden"
            style={{ background: "linear-gradient(45deg, #e5e5e5, #f0f0f0, #fafafa)" }}
          >
            <div className="absolute inset-0">
              <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-white/30 blur-3xl" />
              <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full bg-white/20 blur-3xl" />
            </div>

            <div className="relative z-10">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight mb-4">
                {content?.cta_title || "Ready to Automate Your Content?"}
              </h2>
              <p className="text-gray-700 text-lg max-w-xl mx-auto mb-8">
                {content?.cta_subtitle || "Join thousands of marketers who create branded social media content in seconds, not hours."}
              </p>
              <Link href="/login?tab=signup">
                <Button
                  size="lg"
                  className="text-base px-8 border-0 text-white font-semibold shadow-md"
                  style={{ background: "linear-gradient(45deg, #8b5cf6, #f472b6, #fb923c)" }}
                  data-testid="cta-bottom"
                >
                  {content?.cta_button_text || "Get Started Free"}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      <footer className="border-t">
        <div className="max-w-6xl mx-auto px-6 py-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div
                className="w-7 h-7 rounded-md flex items-center justify-center"
                style={{ background: "linear-gradient(45deg, #c4b5fd, #fbcfe8, #fed7aa)" }}
              >
                <Sparkles className="w-3.5 h-3.5 text-violet-800" />
              </div>
              <span className="text-sm font-semibold">My Social Autopilot</span>
            </div>
            <p className="text-xs text-muted-foreground">
              mysocialautopilot.com
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
