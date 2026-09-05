import { Route, Routes } from "react-router-dom";
import { Rail } from "@/components/Rail";
import { Agents, AgentDetail } from "@/pages/Agents";
import { Overview } from "@/pages/Overview";
import { RunDetail } from "@/pages/RunDetail";
import { Runs } from "@/pages/Runs";
import { Settings } from "@/pages/Settings";

export function App() {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Rail />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-7xl">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/runs" element={<Runs />} />
            <Route path="/runs/:boardId" element={<RunDetail />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/agents/:name" element={<AgentDetail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-raised p-8">
      <h1 className="type-title text-text-primary">No such page</h1>
      <p className="type-small text-text-secondary">
        The rail on the left has every section this platform has.
      </p>
    </div>
  );
}
