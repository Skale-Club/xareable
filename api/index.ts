import "dotenv/config";

export default async function handler(req: any, res: any) {
  res.status(404).json({
    message: `No serverless handler is configured for ${req.method} ${req.url}`,
  });
}
