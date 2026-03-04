/**
 * AdminPage - Main admin dashboard page
 * 
 * This component serves as the main container for admin functionality.
 * All tab components have been extracted to client/src/components/admin/
 * for better maintainability and code organization.
 */

import { useState, useEffect } from "react";
import {
  UsersTab,
  LandingPageTab,
  PricingTab,
  PostCreationTab,
  SeoTab,
  AppSettingsTab,
} from "@/components/admin";

export default function AdminPage({ initialTab = "users" }: { initialTab?: string }) {
  // Handle legacy "styles" tab name by mapping to "post-creation"
  const normalizedInitialTab = initialTab === "styles" ? "post-creation" : initialTab;
  const [activeTab, setActiveTab] = useState(normalizedInitialTab);

  useEffect(() => {
    // Update active tab when initialTab changes (from URL)
    setActiveTab(normalizedInitialTab);
  }, [normalizedInitialTab]);

  // Render the appropriate tab based on activeTab state
  const renderTab = () => {
    switch (activeTab) {
      case "users":
        return <UsersTab />;
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
      default:
        return <UsersTab />;
    }
  };

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6" data-testid="admin-page">
      {renderTab()}
    </div>
  );
}
