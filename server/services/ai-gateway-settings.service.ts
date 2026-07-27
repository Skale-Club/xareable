/**
 * AI Gateway Settings (Phase 21 — GATE-04, GATE-07)
 * Reads/writes the two object-shaped platform_settings rows that control
 * gateway routing (per-call-class openrouter/direct rollback) and fallback
 * model chains. Uses the direct-query pattern established by
 * quota.ts's getPlatformSettingNumber/getMarkupMultiplier — NOT
 * getPlatformSetting (that helper JSON.stringifies objects, forcing a
 * redundant re-parse; see 21-RESEARCH.md "GATE-04 — reading object-shaped
 * platform_settings").
 *
 * No caching: admin toggles (especially the GATE-07 rollback switch) must
 * take effect immediately, matching getPlatformSetting's existing no-cache
 * precedent — a stale cache would undermine "emergency rollback without a
 * deploy."
 */

import { createAdminSupabase } from "../supabase.js";

export type CallClass = "planning" | "image" | "transcription";
export type RoutingMode = "openrouter" | "direct";
export type FallbackCallClass = "text" | "image" | "transcription";

const DEFAULT_ROUTING: Record<CallClass, RoutingMode> = {
  planning: "openrouter",
  image: "openrouter",
  transcription: "openrouter",
};

const DEFAULT_FALLBACKS: Record<FallbackCallClass, string[]> = {
  text: [],
  image: [],
  transcription: [],
};

/** GATE-07: resolve whether `callClass` should route through OpenRouter or the direct legacy Gemini path. */
export async function getCallRouting(callClass: CallClass): Promise<RoutingMode> {
  const sb = createAdminSupabase();
  const { data } = await sb
    .from("platform_settings")
    .select("setting_value")
    .eq("setting_key", "ai_gateway_routing")
    .maybeSingle();
  const value = data?.setting_value as Partial<Record<CallClass, RoutingMode>> | null;
  const mode = value?.[callClass];
  return mode === "direct" ? "direct" : DEFAULT_ROUTING[callClass];
}

/** GATE-04: resolve the ordered fallback model-slug chain for `callClass`. Empty array = no fallback configured (single-shot, no retry-on-different-model). */
export async function getFallbackChain(callClass: FallbackCallClass): Promise<string[]> {
  const sb = createAdminSupabase();
  const { data } = await sb
    .from("platform_settings")
    .select("setting_value")
    .eq("setting_key", "ai_model_fallbacks")
    .maybeSingle();
  const value = data?.setting_value as Partial<Record<FallbackCallClass, string[]>> | null;
  const chain = value?.[callClass];
  return Array.isArray(chain) ? chain.filter((v): v is string => typeof v === "string") : DEFAULT_FALLBACKS[callClass];
}

/** Admin write path (GATE-07). Read-modify-write since routing is a single JSONB row holding all 3 call classes. */
export async function setCallRouting(callClass: CallClass, mode: RoutingMode): Promise<void> {
  const sb = createAdminSupabase();
  const { data } = await sb
    .from("platform_settings")
    .select("setting_value")
    .eq("setting_key", "ai_gateway_routing")
    .maybeSingle();
  const current = (data?.setting_value as Partial<Record<CallClass, RoutingMode>> | null) ?? {};
  const updated = { ...DEFAULT_ROUTING, ...current, [callClass]: mode };
  const { error } = await sb
    .from("platform_settings")
    .upsert({ setting_key: "ai_gateway_routing", setting_value: updated }, { onConflict: "setting_key" });
  if (error) throw new Error(`setCallRouting(${callClass}): ${error.message}`);
}

/** Admin write path (GATE-04). Same read-modify-write pattern as setCallRouting. */
export async function setFallbackChain(callClass: FallbackCallClass, chain: string[]): Promise<void> {
  const sb = createAdminSupabase();
  const { data } = await sb
    .from("platform_settings")
    .select("setting_value")
    .eq("setting_key", "ai_model_fallbacks")
    .maybeSingle();
  const current = (data?.setting_value as Partial<Record<FallbackCallClass, string[]>> | null) ?? {};
  const updated = { ...DEFAULT_FALLBACKS, ...current, [callClass]: chain };
  const { error } = await sb
    .from("platform_settings")
    .upsert({ setting_key: "ai_model_fallbacks", setting_value: updated }, { onConflict: "setting_key" });
  if (error) throw new Error(`setFallbackChain(${callClass}): ${error.message}`);
}
