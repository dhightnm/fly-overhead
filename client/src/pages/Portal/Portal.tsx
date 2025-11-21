import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../../contexts/AuthContext";
import Sidebar, { type SidebarSection } from "../../components/portal/Sidebar";
import AccountOverview from "../../components/portal/AccountOverview";
import AircraftTable from "../../components/portal/AircraftTable";
import ApiKeysSection from "../../components/portal/ApiKeysSection";
import FeederStatus from "../../components/portal/FeederStatus";
import { portalService } from "../../services/portal.service";
import type { Aircraft, UserPlane, CreatePlaneRequest } from "../../types";
import type { Feeder } from "../../services/portal.service";
import "./Portal.css";
import YourPlanesCard from "../../components/portal/YourPlanesCard";

const sortPlanes = (list: UserPlane[]): UserPlane[] => {
  return [...list].sort((a, b) => {
    const nameA = (a.displayName || a.tailNumber).toLowerCase();
    const nameB = (b.displayName || b.tailNumber).toLowerCase();
    return nameA.localeCompare(nameB);
  });
};

const PLANES_CACHE_KEY = "portalPlanes";

const getCachedPlanes = (): UserPlane[] => {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = localStorage.getItem(PLANES_CACHE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch (error) {
    console.warn("Failed to parse cached planes", error);
    return [];
  }
};

const Portal: React.FC = () => {
  const { user, isAuthenticated } = useAuth();
  const [activeSection, setActiveSection] =
    useState<SidebarSection>("dashboard");
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [planes, setPlanes] = useState<UserPlane[]>(getCachedPlanes);
  const [feeders, setFeeders] = useState<Feeder[]>([]);
  const [stats, setStats] = useState<{
    totalAircraft: number;
    activeFeeders: number;
    totalApiKeys: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const previousSection = useRef<SidebarSection>("dashboard");
  const hasFetchedOnce = useRef<boolean>(false);

  const fetchPortalData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [feedersResult, aircraftResult, statsResult, planesResult] =
        await Promise.allSettled([
          portalService.getUserFeeders(),
          portalService.getUserAircraft(),
          portalService.getPortalStats(),
          portalService.getUserPlanes(),
        ]);

      if (feedersResult.status === "fulfilled") {
        setFeeders(feedersResult.value);
      } else {
        console.warn("Failed to load feeders", feedersResult.reason);
      }

      if (aircraftResult.status === "fulfilled") {
        setAircraft(aircraftResult.value.aircraft || []);
      } else {
        console.warn("Failed to load aircraft", aircraftResult.reason);
      }

      if (statsResult.status === "fulfilled") {
        setStats({
          totalAircraft: statsResult.value.totalAircraft,
          activeFeeders: statsResult.value.activeFeeders,
          totalApiKeys: statsResult.value.totalApiKeys,
        });
      } else {
        console.warn("Failed to load stats", statsResult.reason);
      }

      if (planesResult.status === "fulfilled") {
        const sortedPlanes = sortPlanes(planesResult.value);
        setPlanes(sortedPlanes);
        if (typeof window !== "undefined") {
          localStorage.setItem(PLANES_CACHE_KEY, JSON.stringify(sortedPlanes));
        }
      } else {
        console.warn("Failed to load planes", planesResult.reason);
      }

      setLastSyncedAt(new Date());
      hasFetchedOnce.current = true;
    } catch (err) {
      console.error("Error fetching portal data:", err);
      setError("Failed to load portal data. Please try again later.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchPortalData();
    }
  }, [isAuthenticated, fetchPortalData]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    if (
      previousSection.current !== activeSection &&
      activeSection === "dashboard" &&
      hasFetchedOnce.current
    ) {
      fetchPortalData();
    }
    previousSection.current = activeSection;
  }, [activeSection, isAuthenticated, fetchPortalData]);

  const handleCreatePlane = async (
    payload: CreatePlaneRequest
  ): Promise<UserPlane> => {
    const newPlane = await portalService.createUserPlane(payload);
    setPlanes((prev) => {
      const next = sortPlanes([
        ...prev.filter((existing) => existing.id !== newPlane.id),
        newPlane,
      ]);
      if (typeof window !== "undefined") {
        localStorage.setItem(PLANES_CACHE_KEY, JSON.stringify(next));
      }
      return next;
    });
    return newPlane;
  };

  const handleUpdatePlane = async (
    planeId: number,
    payload: CreatePlaneRequest
  ): Promise<UserPlane> => {
    const updatedPlane = await portalService.updateUserPlane(planeId, payload);
    setPlanes((prev) => {
      const next = sortPlanes(
        prev.map((plane) => (plane.id === planeId ? updatedPlane : plane))
      );
      if (typeof window !== "undefined") {
        localStorage.setItem(PLANES_CACHE_KEY, JSON.stringify(next));
      }
      return next;
    });
    return updatedPlane;
  };

  if (!isAuthenticated) {
    return (
      <div className="efb-container">
        <div className="auth-required">
          <h2>Authentication Required</h2>
          <p>Please sign in to access your portal.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="efb-container">
        <Sidebar activeSection="dashboard" onSectionChange={() => {}} />
        <div className="efb-main">
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading your portal...</p>
          </div>
        </div>
      </div>
    );
  }

  const lastSyncDisplay = lastSyncedAt
    ? lastSyncedAt.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "initializing";

  const currentTime = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const currentDate = new Date().toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const renderContent = () => {
    switch (activeSection) {
      case "dashboard":
        return (
          <div className="dashboard-grid">
            <AccountOverview user={user} stats={stats || undefined} />
            <YourPlanesCard
              planes={planes}
              onCreatePlane={handleCreatePlane}
              onUpdatePlane={handleUpdatePlane}
            />
            <div className="aircraft-preview">
              <AircraftTable aircraft={aircraft} compact={true} />
            </div>
          </div>
        );
      case "feeders":
        return <FeederStatus feeders={feeders} />;
      case "aircraft":
        return <AircraftTable aircraft={aircraft} compact={false} />;
      case "api-keys":
        return <ApiKeysSection />;
      case "flight-plan":
        return (
          <div className="efb-placeholder portal-card">
            <div className="placeholder-header">
              <h2>Flight Plan</h2>
              <p className="placeholder-subtitle">
                Plan and manage your flight routes
              </p>
            </div>
            <div className="placeholder-content">
              <p>Flight planning features coming soon:</p>
              <ul>
                <li>Create and edit flight plans</li>
                <li>Route optimization</li>
                <li>Weather integration</li>
                <li>NOTAMs and TFRs</li>
                <li>Fuel calculations</li>
                <li>Weight & balance</li>
              </ul>
            </div>
          </div>
        );
      case "flights":
        return (
          <div className="efb-placeholder portal-card">
            <div className="placeholder-header">
              <h2>Flights</h2>
              <p className="placeholder-subtitle">
                View and manage your flight history
              </p>
            </div>
            <div className="placeholder-content">
              <p>Flight tracking features coming soon:</p>
              <ul>
                <li>Flight history and logs</li>
                <li>Track playback</li>
                <li>Flight statistics</li>
                <li>Export flight data</li>
                <li>Share flights</li>
              </ul>
            </div>
          </div>
        );
      case "maps":
        return (
          <div className="efb-placeholder portal-card">
            <div className="placeholder-header">
              <h2>Maps & Sectional Charts</h2>
              <p className="placeholder-subtitle">
                Interactive aeronautical charts
              </p>
            </div>
            <div className="placeholder-content">
              <p>Aviation mapping features coming soon:</p>
              <ul>
                <li>Sectional charts</li>
                <li>IFR enroute charts</li>
                <li>Terminal area charts</li>
                <li>Weather overlays</li>
                <li>Airspace visualization</li>
                <li>Custom waypoints</li>
              </ul>
            </div>
          </div>
        );
      case "logbook":
        return (
          <div className="efb-placeholder portal-card">
            <div className="placeholder-header">
              <h2>Logbook</h2>
              <p className="placeholder-subtitle">Digital flight logbook</p>
            </div>
            <div className="placeholder-content">
              <p>Logbook features coming soon:</p>
              <ul>
                <li>Automatic flight logging</li>
                <li>Manual entry</li>
                <li>FAA 8710 export</li>
                <li>Currency tracking</li>
                <li>Endorsements</li>
                <li>Medical certificate tracking</li>
              </ul>
            </div>
          </div>
        );
      case "debriefs":
        return (
          <div className="efb-placeholder portal-card">
            <div className="placeholder-header">
              <h2>3D Flight Debriefs</h2>
              <p className="placeholder-subtitle">
                Interactive 3D flight analysis
              </p>
            </div>
            <div className="placeholder-content">
              <p>3D debrief features coming soon:</p>
              <ul>
                <li>3D flight replay</li>
                <li>Performance analysis</li>
                <li>Flight path visualization</li>
                <li>Altitude and speed graphs</li>
                <li>Landing analysis</li>
                <li>Share debriefs</li>
              </ul>
            </div>
          </div>
        );
      case "checklist":
        return (
          <div className="efb-placeholder portal-card">
            <div className="placeholder-header">
              <h2>Checklists</h2>
              <p className="placeholder-subtitle">
                Customizable aircraft checklists
              </p>
            </div>
            <div className="placeholder-content">
              <p>Checklist features coming soon:</p>
              <ul>
                <li>Pre-flight checklists</li>
                <li>In-flight procedures</li>
                <li>Emergency procedures</li>
                <li>Custom checklist creation</li>
                <li>Voice-activated checklists</li>
                <li>RightSeat AI transcription</li>
              </ul>
            </div>
          </div>
        );
      case "settings":
        return (
          <div className="efb-placeholder portal-card">
            <div className="placeholder-header">
              <h2>Settings</h2>
              <p className="placeholder-subtitle">
                Account and application preferences
              </p>
            </div>
            <div className="placeholder-content">
              <p>Settings features:</p>
              <ul>
                <li>Update profile information</li>
                <li>Manage subscription and billing</li>
                <li>Configure notification preferences</li>
                <li>Export your data</li>
                <li>Privacy settings</li>
                <li>Display preferences</li>
              </ul>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="efb-container">
      <Sidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
      />

      <div className="efb-main">
        <div className="efb-topbar">
          <div className="topbar-left">
            <div className="time-display">
              <span className="time">{currentTime}</span>
              <span className="date">{currentDate}</span>
            </div>
          </div>

          <div className="topbar-center">
            <div className="section-title">
              {activeSection === "dashboard" && "Command Deck"}
              {activeSection === "feeders" && "My Feeders"}
              {activeSection === "flight-plan" && "Flight Plan"}
              {activeSection === "flights" && "Flights"}
              {activeSection === "maps" && "Maps & Charts"}
              {activeSection === "logbook" && "Logbook"}
              {activeSection === "debriefs" && "3D Debriefs"}
              {activeSection === "checklist" && "Checklists"}
              {activeSection === "aircraft" && "Aircraft Fleet"}
              {activeSection === "api-keys" && "API Keys"}
              {activeSection === "settings" && "Settings"}
            </div>
          </div>

          <div className="topbar-right">
            <div className="status-badge">
              <span className="status-dot"></span>
              <span>Synced {lastSyncDisplay}</span>
            </div>
          </div>
        </div>

        {error && (
          <div className="error-banner" role="alert">
            <div className="error-indicator" aria-hidden="true"></div>
            <div>
              <p className="error-title">Unable to sync data</p>
              <p className="error-message">{error}</p>
            </div>
            <button type="button" onClick={fetchPortalData}>
              Retry Sync
            </button>
          </div>
        )}

        <div className="efb-content">{renderContent()}</div>
      </div>
    </div>
  );
};

export default Portal;
