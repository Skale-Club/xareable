import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initializeSupabase } from "./lib/supabase";

initializeSupabase().then(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
