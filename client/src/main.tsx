import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import App from "./App";
import "./index.css";
import { initializeSupabase } from "./lib/supabase";

const root = createRoot(document.getElementById("root")!);

initializeSupabase().then(() => {
  root.render(
    <>
      <App />
      <Analytics />
    </>
  );
}).catch((error) => {
  console.error("Failed to initialize Supabase:", error);

  root.render(
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="max-w-lg w-full rounded-lg border border-border bg-card p-6 space-y-3">
        <h1 className="text-lg font-semibold">Application failed to start</h1>
        <p className="text-sm text-muted-foreground">
          Could not load runtime configuration from <code>/api/config</code>.
        </p>
        <p className="text-sm text-muted-foreground">
          Try refreshing the page in a minute. If the issue persists, check the Vercel deployment logs.
        </p>
      </div>
    </div>
  );
});
