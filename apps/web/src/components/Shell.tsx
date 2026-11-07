import { NavLink, Link, Outlet } from "react-router-dom";
import { api } from "../lib/api";
import type { Issue } from "../lib/types";
import { useSession } from "../lib/session";
import { useLoad } from "../lib/useLoad";

/** The merchandiser's frame. The count keeps notes waiting for review in sight from every screen. */
export function MerchandiserShell() {
  const { user, signOut } = useSession();
  const pending = useLoad(() => api<{ issues: Issue[] }>("/issues?status=PENDING"), "pending");
  const waiting = pending.data?.issues.length ?? 0;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/board" className="brand">
            TNA Tracker
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/board">Order board</NavLink>
            <NavLink to="/notes">
              Notes to review
              {waiting > 0 && <span className="count">{waiting}</span>}
            </NavLink>
            <NavLink to="/links">Buyer links</NavLink>
          </nav>
          <div className="user">
            <span>{user?.name}</span>
            <button type="button" className="linklike" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <Outlet context={{ refreshPending: pending.reload }} />
    </>
  );
}

export interface ShellContext {
  refreshPending(): Promise<void>;
}
