import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/hooks/useTranslation";
import { Search, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface GoogleFont {
  family: string;
  category: string;
}

const FONT_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "sans-serif", label: "Sans" },
  { id: "serif", label: "Serif" },
  { id: "display", label: "Display" },
  { id: "handwriting", label: "Handwriting" },
  { id: "monospace", label: "Mono" },
] as const;

const POPULAR_GOOGLE_FONTS: GoogleFont[] = [
  { family: "Inter", category: "sans-serif" },
  { family: "Poppins", category: "sans-serif" },
  { family: "Montserrat", category: "sans-serif" },
  { family: "Roboto", category: "sans-serif" },
  { family: "Open Sans", category: "sans-serif" },
  { family: "Lato", category: "sans-serif" },
  { family: "Nunito", category: "sans-serif" },
  { family: "Raleway", category: "sans-serif" },
  { family: "Playfair Display", category: "serif" },
  { family: "Lora", category: "serif" },
  { family: "Merriweather", category: "serif" },
  { family: "DM Serif Display", category: "serif" },
  { family: "Crimson Text", category: "serif" },
  { family: "EB Garamond", category: "serif" },
  { family: "Libre Baskerville", category: "serif" },
  { family: "Abril Fatface", category: "serif" },
  { family: "Oswald", category: "sans-serif" },
  { family: "Quicksand", category: "sans-serif" },
  { family: "Space Grotesk", category: "sans-serif" },
  { family: "Sora", category: "sans-serif" },
  { family: "DM Sans", category: "sans-serif" },
  { family: "Plus Jakarta Sans", category: "sans-serif" },
  { family: "Manrope", category: "sans-serif" },
  { family: "Urbanist", category: "sans-serif" },
  { family: "Outfit", category: "sans-serif" },
  { family: "Albert Sans", category: "sans-serif" },
  { family: "Figtree", category: "sans-serif" },
  { family: "Geist", category: "sans-serif" },
  { family: "Geist Mono", category: "monospace" },
  { family: "Instrument Sans", category: "sans-serif" },
  { family: "Bricolage Grotesque", category: "sans-serif" },
  { family: "Dancing Script", category: "handwriting" },
  { family: "Pacifico", category: "handwriting" },
  { family: "Great Vibes", category: "handwriting" },
  { family: "Sacramento", category: "handwriting" },
  { family: "Satisfy", category: "handwriting" },
  { family: "Caveat", category: "handwriting" },
  { family: "Kalam", category: "handwriting" },
  { family: "Indie Flower", category: "handwriting" },
  { family: "Shadows Into Light", category: "handwriting" },
  { family: "Permanent Marker", category: "handwriting" },
  { family: "Rock Salt", category: "handwriting" },
  { family: "Bangers", category: "display" },
  { family: "Bebas Neue", category: "display" },
  { family: "Righteous", category: "display" },
  { family: "Press Start 2P", category: "display" },
  { family: "Orbitron", category: "display" },
  { family: "Rajdhani", category: "sans-serif" },
  { family: "Exo 2", category: "sans-serif" },
  { family: "Poiret One", category: "display" },
  { family: "Lobster", category: "display" },
  { family: "Rubik", category: "sans-serif" },
  { family: "Work Sans", category: "sans-serif" },
  { family: "Space Mono", category: "monospace" },
  { family: "Fira Code", category: "monospace" },
  { family: "JetBrains Mono", category: "monospace" },
  { family: "Source Code Pro", category: "monospace" },
  { family: "Courier Prime", category: "monospace" },
  { family: "IBM Plex Mono", category: "monospace" },
  { family: "Archivo", category: "sans-serif" },
  { family: "Archivo Black", category: "sans-serif" },
  { family: "Barlow", category: "sans-serif" },
  { family: "Barlow Condensed", category: "sans-serif" },
  { family: "Josefin Sans", category: "sans-serif" },
  { family: "Karla", category: "sans-serif" },
  { family: "Mulish", category: "sans-serif" },
  { family: "Titillium Web", category: "sans-serif" },
  { family: "Varela Round", category: "sans-serif" },
  { family: "Mukta", category: "sans-serif" },
  { family: "Hind", category: "sans-serif" },
  { family: "Catamaran", category: "sans-serif" },
  { family: "Nunito Sans", category: "sans-serif" },
  { family: "Fira Sans", category: "sans-serif" },
  { family: "Ubuntu", category: "sans-serif" },
  { family: "PT Sans", category: "sans-serif" },
  { family: "Signika", category: "sans-serif" },
  { family: "Source Sans 3", category: "sans-serif" },
  { family: "Libre Franklin", category: "sans-serif" },
  { family: "Overpass", category: "sans-serif" },
  { family: "Red Hat Display", category: "sans-serif" },
  { family: "Satoshi", category: "sans-serif" },
  { family: "General Sans", category: "sans-serif" },
  { family: "Clash Display", category: "display" },
  { family: "SF Pro Display", category: "sans-serif" },
  { family: "Circular Std", category: "sans-serif" },
  { family: "Brandon Grotesque", category: "sans-serif" },
  { family: "Proxima Nova", category: "sans-serif" },
  { family: "Gotham", category: "sans-serif" },
  { family: "Avenir", category: "sans-serif" },
  { family: "Futura PT", category: "sans-serif" },
  { family: "Neue Haas Grotesk", category: "sans-serif" },
  { family: "TT Norms", category: "sans-serif" },
  { family: "Gilroy", category: "sans-serif" },
  { family: "Cera Pro", category: "sans-serif" },
  { family: "Onest", category: "sans-serif" },
  { family: "Unbounded", category: "display" },
  { family: "Montserrat Alternates", category: "sans-serif" },
  { family: "Cormorant Garamond", category: "serif" },
  { family: "Cormorant", category: "serif" },
  { family: "Spectral", category: "serif" },
  { family: "Alegreya", category: "serif" },
  { family: "Alegreya Sans", category: "sans-serif" },
  { family: "Vollkorn", category: "serif" },
  { family: "Zilla Slab", category: "serif" },
  { family: "Bitter", category: "serif" },
  { family: "Volkhov", category: "serif" },
  { family: "Cardo", category: "serif" },
  { family: "Cinzel", category: "serif" },
  { family: "Cinzel Decorative", category: "display" },
  { family: "Prata", category: "serif" },
  { family: "Playfair Display SC", category: "serif" },
  { family: "Yeseva One", category: "serif" },
  { family: "Marcellus", category: "serif" },
  { family: "Lisu Bosa", category: "serif" },
  { family: "Fraunces", category: "serif" },
  { family: "Literata", category: "serif" },
  { family: "Bodoni Moda", category: "serif" },
  { family: "DM Mono", category: "monospace" },
  { family: "Red Hat Mono", category: "monospace" },
  { family: "Anonymous Pro", category: "monospace" },
  { family: "Roboto Mono", category: "monospace" },
  { family: "Kaushan Script", category: "handwriting" },
  { family: "Gloria Hallelujah", category: "handwriting" },
  { family: "Patrick Hand", category: "handwriting" },
  { family: "Architects Daughter", category: "handwriting" },
  { family: "Comic Neue", category: "handwriting" },
  { family: "Handlee", category: "handwriting" },
  { family: "Reenie Beanie", category: "handwriting" },
  { family: "Yellowtail", category: "handwriting" },
  { family: "Homemade Apple", category: "handwriting" },
  { family: "Walter Turncoat", category: "handwriting" },
  { family: "Mrs Saint Delafield", category: "handwriting" },
  { family: "Pinyon Script", category: "handwriting" },
  { family: "Allura", category: "handwriting" },
  { family: "Alex Brush", category: "handwriting" },
  { family: "Parisienne", category: "handwriting" },
  { family: "Style Script", category: "handwriting" },
  { family: "Lavishly Yours", category: "handwriting" },
  { family: "Niconne", category: "handwriting" },
  { family: "Italiana", category: "serif" },
  { family: "Marck Script", category: "handwriting" },
  { family: "Petit Formal Script", category: "handwriting" },
  { family: "Mr Dafoe", category: "handwriting" },
  { family: "League Script", category: "handwriting" },
  { family: "Fascinate", category: "display" },
  { family: "Fascinate Inline", category: "display" },
  { family: "Monoton", category: "display" },
  { family: "Rubik Glitch", category: "display" },
  { family: "Rubik Mono One", category: "display" },
  { family: "Silkscreen", category: "display" },
  { family: "VT323", category: "monospace" },
  { family: "DotGothic16", category: "monospace" },
  { family: "Pixelify Sans", category: "display" },
  { family: "Bungee", category: "display" },
  { family: "Bungee Shade", category: "display" },
  { family: "Bungee Outline", category: "display" },
  { family: "Staatliches", category: "display" },
  { family: "Black Ops One", category: "display" },
  { family: "Bowlby One SC", category: "display" },
  { family: "Bungee Straight", category: "display" },
  { family: "Dela Gothic One", category: "display" },
  { family: "Kanit", category: "sans-serif" },
  { family: "Prompt", category: "sans-serif" },
  { family: "Kantumruy Pro", category: "sans-serif" },
  { family: "Jost", category: "sans-serif" },
  { family: "Lexend", category: "sans-serif" },
  { family: "Atkinson Hyperlegible", category: "sans-serif" },
  { family: "Chakra Petch", category: "sans-serif" },
  { family: "Audiowide", category: "display" },
  { family: "Audiowide", category: "display" },
  { family: "Michroma", category: "display" },
  { family: "Aldrich", category: "sans-serif" },
  { family: "Electrolize", category: "sans-serif" },
  { family: "Syncopate", category: "display" },
  { family: "Russo One", category: "sans-serif" },
  { family: "Teko", category: "sans-serif" },
  { family: "Anton", category: "sans-serif" },
  { family: "Pathway Gothic One", category: "sans-serif" },
  { family: "Chakra Petch", category: "sans-serif" },
];

const SAMPLE_TEXT = "The quick brown fox jumps over the lazy dog";

interface GoogleFontsPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedFontFamily?: string | null;
  onSelect: (font: { family: string; category: string }) => void;
}

const loadedFonts = new Set<string>();

function loadFont(family: string) {
  if (loadedFonts.has(family)) return;
  const linkId = `gf-${family.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(linkId)) {
    loadedFonts.add(family);
    return;
  }
  const link = document.createElement("link");
  link.id = linkId;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;700&display=swap`;
  document.head.appendChild(link);
  loadedFonts.add(family);
}

export function GoogleFontsPickerSheet({
  open,
  onOpenChange,
  selectedFontFamily,
  onSelect,
}: GoogleFontsPickerSheetProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [visibleRange, setVisibleRange] = useState(40);
  const scrollRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const filteredFonts = useMemo(() => {
    let fonts = POPULAR_GOOGLE_FONTS;

    if (activeCategory !== "all") {
      fonts = fonts.filter((f) => f.category === activeCategory);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      fonts = fonts.filter((f) => f.family.toLowerCase().includes(q));
    }

    return fonts;
  }, [search, activeCategory]);

  const visibleFonts = useMemo(
    () => filteredFonts.slice(0, visibleRange),
    [filteredFonts, visibleRange]
  );

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      setVisibleRange((prev) => Math.min(prev + 30, filteredFonts.length));
    }
  }, [filteredFonts.length]);

  useEffect(() => {
    setVisibleRange(40);
  }, [search, activeCategory]);

  useEffect(() => {
    if (open) {
      setSearch("");
      setActiveCategory("all");
      setVisibleRange(40);
    }
  }, [open]);

  const handleSearchChange = useCallback((value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(value);
    }, 200);
  }, []);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>{t("Custom Fonts")}</SheetTitle>
          <SheetDescription>{t("Browse and pick any Google Font")}</SheetDescription>
        </SheetHeader>

        <div className="space-y-3 border-b px-5 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t("Search fonts...")}
              className="pl-9 border-border bg-background/50"
              onChange={(e) => handleSearchChange(e.target.value)}
              defaultValue={search}
            />
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {FONT_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                  activeCategory === cat.id
                    ? "bg-violet-400 text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {t(cat.label)}
              </button>
            ))}
          </div>
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-5 py-3"
        >
          <div className="space-y-1">
            {visibleFonts.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("No fonts found")}
              </div>
            )}
            {visibleFonts.map((font) => {
              const isSelected = font.family === selectedFontFamily;
              return (
                <button
                  key={font.family}
                  type="button"
                  onClick={() => {
                    loadFont(font.family);
                    onSelect({ family: font.family, category: font.category });
                  }}
                  onMouseEnter={() => loadFont(font.family)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-all",
                    isSelected
                      ? "border-violet-400 bg-violet-400/8"
                      : "border-transparent hover:bg-muted/50"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-muted-foreground">
                      {font.category}
                    </div>
                    <div
                      className="truncate text-base"
                      style={{ fontFamily: `'${font.family}', sans-serif` }}
                    >
                      {font.family}
                    </div>
                    <div
                      className="truncate text-xs text-muted-foreground"
                      style={{ fontFamily: `'${font.family}', sans-serif` }}
                    >
                      {SAMPLE_TEXT.slice(0, 36)}...
                    </div>
                  </div>
                  {isSelected && (
                    <div className="ml-3 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-400 text-white">
                      <Check className="h-3.5 w-3.5" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
