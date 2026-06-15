import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Layout() {
  const { signOut, session, isAdmin } = useAuth();
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Cipher Content</h1>
        <nav>
          <NavLink to="/today">Today</NavLink>
          <NavLink to="/calendar">Calendar</NavLink>
          <NavLink to="/articles">Articles</NavLink>
          <NavLink to="/stats">Stats</NavLink>
          <NavLink to="/accounts">Accounts</NavLink>
          {isAdmin && <NavLink to="/users">Users</NavLink>}
        </nav>
        <div className="spacer" />
        <div className="sidebar-email" title={session?.user.email}>
          {session?.user.email}
        </div>
        <button onClick={() => void signOut()}>Sign out</button>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
