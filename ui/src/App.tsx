/**
 * Where each address goes.
 *
 * Four places, all of them addressable. The index carries its whole query in
 * the URL, a board is a path, and settings is a route rather than a drawer, so
 * every view in this product is a link someone can send.
 */
import { Navigate, Route, Routes } from "react-router-dom";
import { Agents } from "@/routes/Agents";
import { Board } from "@/routes/Board";
import { Boards } from "@/routes/Boards";
import { Settings } from "@/routes/Settings";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Boards />} />
      <Route path="/boards/:boardId" element={<Board />} />
      <Route path="/agents" element={<Agents />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
