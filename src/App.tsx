import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Today from "./pages/Today";
import Calendar from "./pages/Calendar";
import Articles from "./pages/Articles";
import ArticleEditor from "./pages/ArticleEditor";
import Accounts from "./pages/Accounts";
import AccountDetail from "./pages/AccountDetail";
import CampaignDetail from "./pages/CampaignDetail";
import Stats from "./pages/Stats";
import Users from "./pages/Users";

export default function App() {
  const { session, loading, isAdmin } = useAuth();

  if (loading) {
    return <div className="center-screen muted">Loading…</div>;
  }

  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/today" element={<Today />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/articles" element={<Articles />} />
        <Route path="/articles/:articleId" element={<ArticleEditor />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/accounts/:accountId" element={<AccountDetail />} />
        <Route path="/campaigns/:campaignId" element={<CampaignDetail />} />
        {isAdmin && <Route path="/users" element={<Users />} />}
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Route>
    </Routes>
  );
}
