import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "@/App";
import { SessionProvider } from "@/lib/session";
import "@/styles/app.css";

// A monitoring tool is read while something is happening, so a stale answer is
// worth showing at once and correcting a moment later. One retry is enough:
// past that the operator can see the error and decide for themselves.
const queries = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2000,
      refetchOnWindowFocus: true,
      // A refused request is not a flaky one. Retrying a 401 or a 403 asks the
      // platform the same question it just answered, three times, before the
      // reader is told anything.
      retry: (attempt, error) => {
        const status = (error as { status?: number }).status ?? 0;
        return status >= 500 && attempt < 1;
      },
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      <BrowserRouter>
        {/* Inside the router, because signing in redirects and the provider
            invalidates on the way through. */}
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
