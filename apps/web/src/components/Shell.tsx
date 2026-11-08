import { CalendarRange, LayoutList, Link2, LogOut, MessageSquareText } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { Brand } from "./Brand";
import { NotificationBell } from "./NotificationBell";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import type { Issue } from "../lib/types";
import { useLoad } from "../lib/useLoad";

/** The merchandiser's frame. The count keeps notes waiting for review in sight from every screen. */
export function MerchandiserShell() {
  const { user, signOut } = useSession();
  const pending = useLoad(() => api<{ issues: Issue[] }>("/issues?status=PENDING"), "pending");
  const waiting = pending.data?.issues.length ?? 0;

  return (
    <div className="frame">
      <header className="rail">
        <div className="rail-top">
          <Link to="/board" className="brand">
            <Brand />
          </Link>
          <NotificationBell />
        </div>
        <nav className="nav" aria-label="Main">
          <NavLink to="/board">
            <LayoutList size={18} aria-hidden="true" />
            Order board
          </NavLink>
          <NavLink to="/runway">
            <CalendarRange size={18} aria-hidden="true" />
            Runway
          </NavLink>
          <NavLink to="/notes">
            <MessageSquareText size={18} aria-hidden="true" />
            Notes to review
            {waiting > 0 && <span className="count">{waiting}</span>}
          </NavLink>
          <NavLink to="/links">
            <Link2 size={18} aria-hidden="true" />
            Buyer links
          </NavLink>
        </nav>
        <div className="user">
          <span>{user?.name}</span>
          <button type="button" className="linklike" onClick={() => void signOut()}>
            <LogOut size={14} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </header>
      <div>
        <Outlet context={{ refreshPending: pending.reload }} />
      </div>
    </div>
  );
}

export interface ShellContext {
  refreshPending(): Promise<void>;
}
