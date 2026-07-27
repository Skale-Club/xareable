import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, rename, cp } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  // Rename index.html → _app.html so Vercel doesn't auto-serve the raw
  // template for "/". The SSR serverless function reads _app.html instead,
  // and the catch-all rewrite in vercel.json points to /_app.html.
  await rename("dist/public/index.html", "dist/public/_app.html");
  console.log("renamed dist/public/index.html → _app.html");

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    // Emit a sourcemap so production stack traces (with `node --enable-source-maps`)
    // point at the original TS, not the minified bundle.
    sourcemap: true,
    external: externals,
    logLevel: "info",
  });

  // Phase 23 (TYPO-04): the runner stage only copies dist/, and esbuild does not
  // bundle binary assets — copy the bundled Inter weights into the output tree so
  // typography-compositor.service.ts can register them from the runner's filesystem.
  await cp("server/assets/fonts", "dist/assets/fonts", { recursive: true });
  console.log("copied server/assets/fonts → dist/assets/fonts");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
