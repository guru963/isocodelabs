import { LayoutList, Link2, LogOut, MessageSquareText } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import type { Issue } from "../lib/types";
import { useLoad } from "../lib/useLoad";

/** A needle pulling a line of stitches, the product's idea in one small mark. */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2 18h3M8 18h3" stroke="#f0b429" strokeWidth="2" strokeLinecap="round" />
      <path d="M13 18C17 15 20 10 22 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="21" cy="6.5" r="0.9" fill="#0a3a45" />
    </svg>
  );
}

/** The merchandiser's frame. The count keeps notes waiting for review in sight from every screen. */
export function MerchandiserShell() {
  const { user, signOut } = useSession();
  const pending = useLoad(() => api<{ issues: Issue[] }>("/issues?status=PENDING"), "pending");
  const waiting = pending.data?.issues.length ?? 0;

  return (
    <div className="frame">
      <header className="rail">
        <Link to="/board" className="brand">
          <BrandMark />
          TNA Tracker
        </Link>
        <nav className="nav" aria-label="Main">
          <NavLink to="/board">
            <LayoutList size={18} aria-hidden="true" />
            Order board
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
