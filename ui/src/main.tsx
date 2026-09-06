import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "@/App";
import "@/styles/app.css";

// A monitoring tool is read while something is happening, so a stale answer is
// worth showing at once and correcting a moment later. One retry is enough:
// past that the operator can see the error and decide for themselves.
const queries = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 2000, retry: 1, refetchOnWindowFocus: true },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
