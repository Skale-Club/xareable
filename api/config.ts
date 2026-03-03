import "dotenv/config";

export default async function handler(_req: any, res: any) {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  res.status(200).json({
    supabaseUrl,
    supabaseAnonKey,
  });
}
