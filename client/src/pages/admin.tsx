/**
 * AdminPage - Main admin dashboard page
 * 
 * This component serves as the main container for admin functionality.
 * All tab components have been extracted to client/src/components/admin/
 * for better maintainability and code organization.
 */

import { useState, useEffect } from "react";
import {
  DashboardTab,
  UsersTab,
  LandingPageTab,
  PricingTab,
  PostCreationTab,
  SeoTab,
  AppSettingsTab,
  IntegrationsTab,
} from "@/components/admin";
import { GenerationsTab } from "@/components/admin/generations-tab";

export default function AdminPage({ initialTab = "dashboard" }: { initialTab?: string }) {
  // Handle legacy tab names by mapping to current tabs.
  const normalizedInitialTab =
    initialTab === "styles"
      ? "post-creation"
      : (
        [
          "token-spend",
          "token-spend-overview",
          "spend-overview",
          "usage-overview",
        ].includes(initialTab)
          ? "pricing"
          : initialTab
      );
  const [activeTab, setActiveTab] = useState(normalizedInitialTab);

  useEffect(() => {
    // Update active tab when initialTab changes (from URL)
    setActiveTab(normalizedInitialTab);
  }, [normalizedInitialTab]);

  // Render the appropriate tab based on activeTab state
  const renderTab = () => {
    switch (activeTab) {
      case "dashboard":
        return <DashboardTab />;
      case "users":
        return <UsersTab />;
      case "generations":
        return <GenerationsTab />;
      case "landing":
        return <LandingPageTab />;
      case "pricing":
        return <PricingTab />;
      case "post-creation":
        return <PostCreationTab />;
      case "seo":
        return <SeoTab />;
      case "settings":
        return <AppSettingsTab />;
      case "integrations":
        return <IntegrationsTab />;
      default:
        return <DashboardTab />;
    }
  };

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6" data-testid="admin-page">
      {renderTab()}
    </div>
  );
}
