import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { LandingPage } from "./pages/LandingPage";
import { DashboardPage } from "./pages/DashboardPage";
import { NewApplicationPage } from "./pages/NewApplicationPage";
import { ApplicationDetailPage } from "./pages/ApplicationDetailPage";
import { DemoPage } from "./pages/DemoPage";
import { VaultPage } from "./pages/VaultPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { ReportPage } from "./pages/ReportPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<LandingPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="applications/new" element={<NewApplicationPage />} />
        <Route path="applications/:id" element={<ApplicationDetailPage />} />
        <Route path="applications/:id/report" element={<ReportPage />} />
        <Route path="demo" element={<DemoPage />} />
        <Route path="vault" element={<VaultPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
