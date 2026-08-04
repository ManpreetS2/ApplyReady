import type { ReactNode } from "react";
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
import { useConfig } from "./lib/config";

function PublicDemoRedirect({ children }: { children: ReactNode }) {
  const { publicDemoMode } = useConfig();
  if (publicDemoMode) return <Navigate to="/demo" replace />;
  return children;
}

export default function App() {
  const { publicDemoMode } = useConfig();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<LandingPage />} />
        <Route
          path="dashboard"
          element={
            <PublicDemoRedirect>
              <DashboardPage />
            </PublicDemoRedirect>
          }
        />
        <Route
          path="applications/new"
          element={
            <PublicDemoRedirect>
              <NewApplicationPage />
            </PublicDemoRedirect>
          }
        />
        <Route path="applications/:id" element={<ApplicationDetailPage />} />
        <Route path="applications/:id/report" element={<ReportPage />} />
        <Route path="demo" element={<DemoPage />} />
        <Route
          path="vault"
          element={
            <PublicDemoRedirect>
              <VaultPage />
            </PublicDemoRedirect>
          }
        />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route
          path="*"
          element={<Navigate to={publicDemoMode ? "/demo" : "/"} replace />}
        />
      </Route>
    </Routes>
  );
}
