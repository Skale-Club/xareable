import { z } from "zod";

export const profileSchema = z.object({
  id: z.string().uuid(),
  api_key: z.string().nullable(),
  created_at: z.string(),
});
export type Profile = z.infer<typeof profileSchema>;

export const brandSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  company_name: z.string(),
  company_type: z.string(),
  color_1: z.string(),
  color_2: z.string(),
  color_3: z.string(),
  mood: z.string(),
  logo_url: z.string().nullable(),
  created_at: z.string(),
});
export type Brand = z.infer<typeof brandSchema>;

export const insertBrandSchema = z.object({
  company_name: z.string().min(1, "Company name is required"),
  company_type: z.string().min(1, "Company type is required"),
  color_1: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color"),
  color_2: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color"),
  color_3: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color"),
  mood: z.string().min(1, "Select a mood"),
  logo_url: z.string().nullable().optional(),
});
export type InsertBrand = z.infer<typeof insertBrandSchema>;

export const postSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  image_url: z.string().nullable(),
  caption: z.string().nullable(),
  ai_prompt_used: z.string().nullable(),
  status: z.string(),
  created_at: z.string(),
});
export type Post = z.infer<typeof postSchema>;

export const generateRequestSchema = z.object({
  reference_text: z.string().optional(),
  post_profile: z.enum(["promo", "info", "clean", "vibrant"]),
  copy_text: z.string().min(1, "Enter the text you want on the image"),
  aspect_ratio: z.enum(["1:1", "16:9", "9:16"]),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const generateResponseSchema = z.object({
  image_url: z.string(),
  caption: z.string(),
  headline: z.string(),
  subtext: z.string(),
  post_id: z.string(),
});
export type GenerateResponse = z.infer<typeof generateResponseSchema>;

export type User = {
  id: string;
  username: string;
  password: string;
};
export type InsertUser = Pick<User, "username" | "password">;
