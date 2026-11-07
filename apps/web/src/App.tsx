import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { MerchandiserShell } from "./components/Shell";
import { SkeletonRows } from "./components/States";
import { useSession } from "./lib/session";
import type { Role } from "./lib/types";
import SignIn from "./screens/SignIn";

// Split by audience, so a supervisor's low-memory phone never parses merchandiser screens.
const Board = lazy(() => import("./screens/Board"));

const Fallback = (
  <div className="page">
    <SkeletonRows />
  </div>
);

function homeFor(role: Role) {
  return role === "SUPERVISOR" ? "/floor" : "/board";
}

function Require({ role, children }: { role: Role; children: ReactNode }) {
  const { user, loading } = useSession();
  if (loading) return Fallback;
  if (!user) return <SignIn />;
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}

function Home() {
  const { user, loading } = useSession();
  if (loading) return Fallback;
  if (!user) return <SignIn />;
  return <Navigate to={homeFor(user.role)} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={Fallback}>
        <Routes>
          <Route
            element={
              <Require role="MERCHANDISER">
                <MerchandiserShell />
              </Require>
            }
          >
            <Route path="/board" element={<Board />} />
          </Route>
          <Route path="*" element={<Home />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
