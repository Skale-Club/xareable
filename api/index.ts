import "dotenv/config";

export default async function handler(_req: any, res: any) {
  // This is a fallback handler for routes not matched by other serverless functions
  // Most routes should be handled by Vercel's SPA fallback to index.html
  return res.status(404).json({
    error: "Not Found",
    message: "This API endpoint is not implemented as a serverless function yet.",
    hint: "For full functionality, you need to migrate all API routes from server/routes.ts to individual serverless functions in the api/ directory."
  });
}
