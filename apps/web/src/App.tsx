import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { MerchandiserShell } from "./components/Shell";
import { SkeletonRows } from "./components/States";
import { useSession } from "./lib/session";
import type { Role } from "./lib/types";
import SignIn from "./screens/SignIn";

// Split by audience, so a supervisor's low-memory phone never parses merchandiser screens.
const Board = lazy(() => import("./screens/Board"));
const RunwayPage = lazy(() => import("./screens/RunwayPage"));
const OrderDetail = lazy(() => import("./screens/OrderDetail"));
const NewOrder = lazy(() => import("./screens/NewOrder"));
const Notes = lazy(() => import("./screens/Notes"));
const BuyerLinks = lazy(() => import("./screens/BuyerLinks"));
const ScenarioLab = lazy(() => import("./screens/ScenarioLab"));
const Floor = lazy(() => import("./screens/Floor"));
const BuyerView = lazy(() => import("./screens/BuyerView"));

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
            <Route path="/runway" element={<RunwayPage />} />
            <Route path="/orders/new" element={<NewOrder />} />
            <Route path="/orders/:id" element={<OrderDetail />} />
            <Route path="/notes" element={<Notes />} />
            <Route path="/links" element={<BuyerLinks />} />
            <Route path="/scenarios" element={<ScenarioLab />} />
          </Route>
          <Route
            path="/floor"
            element={
              <Require role="SUPERVISOR">
                <Floor />
              </Require>
            }
          />
          <Route path="/buyer" element={<BuyerView />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
