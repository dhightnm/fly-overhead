import React, {
  useState,
  useContext,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import PlaneMarker from "../../components/PlaneMarker";
import SatMarker from "../../components/SatMarker";
import AirportMarker from "../../components/AirportMarker";
import HeatmapLayer from "../../components/HeatmapLayer";
import FlightPlanRouteOverlay from "../../components/FlightPlanRouteOverlay";
import { PlaneContext } from "../../contexts/PlaneContext";
import { useAuth } from "../../contexts/AuthContext";
import MapFlyToHandler from "../../components/MapFlyToHandler";
import MapResizeHandler from "../../components/MapResizeHandler";
import FlightHistoryModal from "../../components/FlightHistoryModal";
import WebSocketHandler from "../../components/WebSocketHandler";
import PremiumModal from "../../components/PremiumModal";
import MapDataFetcher from "./MapDataFetcher";
import { useRouteData } from "../../hooks/useRouteData";
import { useAircraftData } from "../../hooks/useAircraftData";
import { aircraftService } from "../../services";
import { mergePlaneRecords } from "../../utils/aircraftMerge";
import type { Aircraft, StarlinkSatellite, Route } from "../../types";
import type { AirportSearchResult } from "../../types";
import "./Home.css";
import { inferAircraftCategory } from "../../utils/aircraft";

const MOVING_VELOCITY_THRESHOLD = 2; // knots
const STALE_SEARCH_THRESHOLD_SECONDS = 6 * 60 * 60; // 6 hours

const Home: React.FC = () => {
  const { isPremium } = useAuth();

  // Use hooks for data management
  const {
    planes,
    setPlanes,
    searchAircraft: searchAircraftInHook,
    updateAircraftCategory,
    upsertPlane,
  } = useAircraftData();
  const {
    routes,
    flightPlanRoutes,
    routeAvailabilityStatus,
    loadingRoutes,
    fetchRouteForAircraft,
    fetchFlightPlanRoute,
    setRoute,
  } = useRouteData();

  // Extract route data from aircraft responses and store in routes state
  // This ensures route data is available immediately without API calls
  useEffect(() => {
    planes.forEach((plane) => {
      if (plane.route && plane.icao24) {
        // Store route data from aircraft response in routes state
        // This makes it available for other components that use routes state
        setRoute(plane.icao24, {
          ...plane.route,
          icao24: plane.icao24,
          callsign: plane.callsign || null,
        });
      }
    });
  }, [planes, setRoute]);

  const [showFlightPlanRoute, setShowFlightPlanRoute] = useState(false);
  const [starlink, setStarlink] = useState<StarlinkSatellite[]>([]);
  const [airports, setAirports] = useState<AirportSearchResult[]>([]);
  const [userPosition, setUserPosition] = useState<[number, number] | null>(
    null
  );
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [airportSearch, setAirportSearch] = useState("");
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [highlightedAircraftIcao24, setHighlightedAircraftIcao24] = useState<
    string | null
  >(null);
  const [airportSearchResults, setAirportSearchResults] = useState<
    AirportSearchResult[]
  >([]);
  const [searchStatus, setSearchStatus] = useState<
    "searching" | "found" | "not-found" | "stale" | null
  >(null);
  const [showAirports, setShowAirports] = useState(true);
  const [showClosedAirports, setShowClosedAirports] = useState(false);
  const [selectedAirport, setSelectedAirport] =
    useState<AirportSearchResult | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedAircraft, setSelectedAircraft] = useState<{
    icao24: string;
    callsign: string;
  } | null>(null);
  const [websocketEnabled] = useState(true);
  const [websocketConnected, setWebsocketConnected] = useState(false);
  const fetchDataRef = useRef<(() => Promise<void>) | null>(null);
  const [manualPlanes, setManualPlanes] = useState<Record<string, Aircraft>>(
    {}
  );

  const contextValue = useContext(PlaneContext);
  const searchLatlng = contextValue ? contextValue.searchLatlng : userPosition;
  const position = searchLatlng || [35.104795500039565, -106.62620902061464];

  const normalizeAircraft = useCallback((aircraft: Aircraft): Aircraft => {
    const toNumber = (value: any) =>
      value === null || value === undefined || value === ""
        ? value
        : Number(value);

    const nowSeconds = Math.floor(Date.now() / 1000);
    const lastContact =
      typeof aircraft.last_contact === "number"
        ? aircraft.last_contact
        : typeof (aircraft as any).lastContact === "number"
        ? (aircraft as any).lastContact
        : typeof (aircraft as any).time_position === "number"
        ? (aircraft as any).time_position
        : null;
    const dataAgeSeconds =
      aircraft.data_age_seconds !== undefined &&
      aircraft.data_age_seconds !== null
        ? aircraft.data_age_seconds
        : lastContact !== null
        ? Math.max(0, nowSeconds - lastContact)
        : null;

    return {
      ...aircraft,
      latitude: toNumber(aircraft.latitude) ?? aircraft.latitude,
      longitude: toNumber(aircraft.longitude) ?? aircraft.longitude,
      baro_altitude: toNumber(aircraft.baro_altitude) ?? aircraft.baro_altitude,
      geo_altitude:
        toNumber((aircraft as any).geo_altitude) ??
        (aircraft as any).geo_altitude,
      velocity: toNumber(aircraft.velocity) ?? 0,
      true_track: toNumber(aircraft.true_track) ?? aircraft.true_track,
      vertical_rate: toNumber(aircraft.vertical_rate) ?? aircraft.vertical_rate,
      last_contact: lastContact,
      data_age_seconds: dataAgeSeconds ?? undefined,
      last_update_age_seconds: dataAgeSeconds ?? undefined,
      category:
        aircraft.category ??
        inferAircraftCategory(aircraft) ??
        aircraft.category,
      predicted: aircraft.predicted === true,
      prediction_confidence: aircraft.prediction_confidence,
      route: aircraft.route, // Preserve route data from backend
    } as Aircraft;
  }, []);

  // Unified smart merge with age-based cleanup
  const mergedPlanes = useMemo(() => {
    if (
      (!planes || planes.length === 0) &&
      Object.keys(manualPlanes).length === 0
    ) {
      return [] as Aircraft[];
    }

    const planeMap = new Map<string, Aircraft>();
    const currentTime = Math.floor(Date.now() / 1000);
    // 15 minute cleanup threshold to match display filter
    const maxAge = 15 * 60;

    // Add live planes
    planes.forEach((plane) => {
      if (plane?.icao24) {
        planeMap.set(plane.icao24, plane);
      }
    });

    // Merge manual planes (from search), preserving them if recent or selected/highlighted
    Object.values(manualPlanes).forEach((plane) => {
      if (plane?.icao24) {
        const isRecent =
          !plane.last_contact || currentTime - plane.last_contact <= maxAge;
        const isSelected = selectedAircraft?.icao24 === plane.icao24;
        const isHighlighted = highlightedAircraftIcao24 === plane.icao24;

        // Only keep manual planes that are recent OR actively selected/highlighted
        if (isRecent || isSelected || isHighlighted) {
          const existing = planeMap.get(plane.icao24);
          planeMap.set(
            plane.icao24,
            existing ? { ...existing, ...plane } : plane
          );
        }
      }
    });

    return Array.from(planeMap.values());
  }, [
    planes,
    manualPlanes,
    selectedAircraft?.icao24,
    highlightedAircraftIcao24,
  ]);

  const visiblePlaneEntries = useMemo(() => {
    if (!mergedPlanes || mergedPlanes.length === 0) {
      return [] as Array<{
        plane: Aircraft;
        route?: Route;
        derivedCategory?: number;
      }>;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    // 30 minute filter to show aircraft even when data is slightly stale
    // Backend polls every 10 minutes, but we want to show planes even if update is delayed
    const maxAge = 30 * 60; // 30 minutes

    const entries: Array<{
      plane: Aircraft;
      route?: Route;
      derivedCategory?: number;
    }> = [];

    mergedPlanes.forEach((plane) => {
      if (
        !plane ||
        plane.latitude === undefined ||
        plane.longitude === undefined
      ) {
        return;
      }

      // PRIORITY FIX: Prefer fresh user-fetched routes (routes state) over stale preloaded routes (plane.route)
      // This ensures clicking to fetch fresh data actually shows the fresh data
      // Only fall back to plane.route if no fresh route data has been fetched
      const route = routes[plane.icao24] || plane.route;
      const derivedCategory = inferAircraftCategory(plane, route);
      const isRotorcraft = derivedCategory === 7 || plane.category === 7;

      const isRecent =
        !plane.last_contact || currentTime - plane.last_contact <= maxAge;
      const isSelected = selectedAircraft?.icao24 === plane.icao24;
      const isHighlighted = highlightedAircraftIcao24 === plane.icao24;
      const isManuallyAdded = manualPlanes[plane.icao24] !== undefined;

      // Always show: selected, highlighted, manually searched, or rotorcraft
      // Otherwise only show if recent
      if (
        !isRecent &&
        !isSelected &&
        !isHighlighted &&
        !isRotorcraft &&
        !isManuallyAdded
      ) {
        return;
      }

      entries.push({ plane, route, derivedCategory });
    });

    return entries;
  }, [
    mergedPlanes,
    routes,
    selectedAircraft?.icao24,
    highlightedAircraftIcao24,
    manualPlanes,
  ]);

  // Keep refs in sync with state for flight plan routes
  const flightPlanRoutesRef = useRef<Record<string, any>>({});
  const routeAvailabilityStatusRef = useRef<Record<string, any>>({});

  useEffect(() => {
    flightPlanRoutesRef.current = flightPlanRoutes;
  }, [flightPlanRoutes]);

  useEffect(() => {
    routeAvailabilityStatusRef.current = routeAvailabilityStatus;
  }, [routeAvailabilityStatus]);

  const handleToggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const handleToggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
      const mapContainers = document.querySelectorAll(".leaflet-container");
      mapContainers.forEach((container) => {
        if ((container as any)._leaflet && (container as any)._leaflet.map) {
          (container as any)._leaflet.map.invalidateSize();
        }
        const resizeEvent = new Event("resize");
        container.dispatchEvent(resizeEvent);
      });
    }, 350);
  };

  const handleSidebarSearch = async () => {
    if (!sidebarSearch.trim()) {
      setSearchStatus(null);
      return;
    }

    setSearchStatus("searching");

    try {
      const aircraft = await searchAircraftInHook(sidebarSearch.trim());

      if (aircraft) {
        const normalizedPlane = normalizeAircraft(aircraft);
        const nowSeconds = Math.floor(Date.now() / 1000);
        const dataAgeSeconds =
          normalizedPlane.data_age_seconds ??
          (normalizedPlane.last_contact
            ? Math.max(0, nowSeconds - normalizedPlane.last_contact)
            : null);

        if (
          dataAgeSeconds !== null &&
          dataAgeSeconds > STALE_SEARCH_THRESHOLD_SECONDS
        ) {
          console.info("Search result is stale, skipping display", {
            icao24: normalizedPlane.icao24,
            dataAgeSeconds,
          });
          setHighlightedAircraftIcao24(null);
          setSearchStatus("stale");
          setTimeout(() => setSearchStatus(null), 4000);
          return;
        }

        if (normalizedPlane.latitude && normalizedPlane.longitude) {
          const manualPlane: Aircraft = {
            ...normalizedPlane,
            predicted: false,
            prediction_confidence: undefined,
            source: "manual",
            position_source: "search",
          };

          upsertPlane(manualPlane);
          if (manualPlane.icao24) {
            setManualPlanes((prev) => ({
              ...prev,
              [manualPlane.icao24]: manualPlane,
            }));
          }
          contextValue.setSearchLatlng([
            manualPlane.latitude,
            manualPlane.longitude,
          ]);
          if (manualPlane.icao24) {
            setHighlightedAircraftIcao24(manualPlane.icao24);
            setSelectedAircraft({
              icao24: manualPlane.icao24,
              callsign:
                manualPlane.callsign || manualPlane.route?.callsign || "N/A",
            });

            // Immediately fetch route data to get category and route info
            fetchRouteForAircraftWithCategoryUpdate(manualPlane)
              .then(async (routeData) => {
                if (routeData) {
                  if (routeData.callsign) {
                    setSelectedAircraft((prev) =>
                      prev && prev.icao24 === manualPlane.icao24
                        ? {
                            icao24: manualPlane.icao24,
                            callsign:
                              routeData.callsign ||
                              manualPlane.callsign ||
                              "N/A",
                          }
                        : prev
                    );
                  }

                  setManualPlanes((prev) => {
                    const existingManual = prev[manualPlane.icao24];
                    if (!existingManual) {
                      return prev;
                    }
                    return {
                      ...prev,
                      [manualPlane.icao24]: {
                        ...existingManual,
                        route: routeData,
                      },
                    };
                  });

                  if (
                    routeData.aircraftCategory !== undefined &&
                    routeData.aircraftCategory !== null
                  ) {
                    const updatedCategory = routeData.aircraftCategory;

                    // Update in main planes state
                    setPlanes((prevPlanes) =>
                      prevPlanes.map((p) =>
                        p.icao24 === manualPlane.icao24
                          ? { ...p, category: updatedCategory }
                          : p
                      )
                    );

                    // Update in manualPlanes
                    setManualPlanes((prev) => {
                      const existingManual = prev[manualPlane.icao24];
                      if (!existingManual) {
                        return prev;
                      }
                      return {
                        ...prev,
                        [manualPlane.icao24]: {
                          ...existingManual,
                          category: updatedCategory,
                          predicted: false,
                          prediction_confidence: undefined,
                        },
                      };
                    });
                  }
                }

                // Flight plan will be fetched by useEffect if toggle is on
              })
              .catch((err) => {
                console.error(
                  "Error fetching route for searched aircraft:",
                  err
                );
              });
          }
          setSearchStatus("found");
          setSidebarSearch("");
          setTimeout(() => setSearchStatus(null), 3000);
        } else {
          setHighlightedAircraftIcao24(null);
          setSearchStatus("not-found");
          setTimeout(() => setSearchStatus(null), 3000);
        }
      } else {
        setHighlightedAircraftIcao24(null);
        setSearchStatus("not-found");
        setTimeout(() => setSearchStatus(null), 3000);
      }
    } catch (err) {
      console.error("Error searching for aircraft:", err);
      setHighlightedAircraftIcao24(null);
      setSearchStatus("not-found");
      setTimeout(() => setSearchStatus(null), 3000);
    }
  };

  const getSearchStatusIcon = () => {
    switch (searchStatus) {
      case "searching":
        return "🔍";
      case "found":
        return "✅";
      case "stale":
        return "🕑";
      default:
        return "";
    }
  };

  // Fetch route wrapper to update aircraft category when route is fetched
  const fetchRouteForAircraftWithCategoryUpdate = useCallback(
    async (plane: Aircraft, isPrefetch = false) => {
      // Force refresh ONLY if we have stale preloaded data but no fresh fetched data
      // This ensures the first click gets fresh API data, but subsequent clicks use the cache
      const hasPreloadedData = !!plane.route;
      const hasFreshFetchedData = !!routes[plane.icao24];
      const forceRefresh =
        !isPrefetch && hasPreloadedData && !hasFreshFetchedData;

      const route = await fetchRouteForAircraft(
        plane,
        isPrefetch,
        forceRefresh
      );

      if (
        route?.aircraftCategory !== undefined &&
        route.aircraftCategory !== null
      ) {
        updateAircraftCategory(plane.icao24, route.aircraftCategory);
      }

      return route;
    },
    [fetchRouteForAircraft, updateAircraftCategory, routes]
  );

  const handleViewHistory = async (plane: Aircraft) => {
    // Immediately set selection and highlight
    const entryRoute = routes[plane.icao24] || plane.route;
    const displayCallsign = plane.callsign || entryRoute?.callsign || "N/A";
    setSelectedAircraft({
      icao24: plane.icao24,
      callsign: displayCallsign,
    });
    setHighlightedAircraftIcao24(plane.icao24);
    setHistoryModalOpen(true);

    // Fetch route data (flight plan will be fetched by useEffect if toggle is on)
    const routeData = await fetchRouteForAircraftWithCategoryUpdate(plane);

    if (routeData?.callsign) {
      setSelectedAircraft((prev) =>
        prev && prev.icao24 === plane.icao24
          ? {
              icao24: plane.icao24,
              callsign: routeData.callsign || plane.callsign || "N/A",
            }
          : prev
      );
    }

    // Update category in both planes state and manualPlanes if we got route data
    if (
      routeData &&
      routeData.aircraftCategory !== undefined &&
      routeData.aircraftCategory !== null
    ) {
      const updatedCategory = routeData.aircraftCategory;

      // Update in main planes state
      setPlanes((prevPlanes) =>
        prevPlanes.map((p) =>
          p.icao24 === plane.icao24 ? { ...p, category: updatedCategory } : p
        )
      );

      // Update in manualPlanes if it exists there
      setManualPlanes((prev) => {
        if (prev[plane.icao24]) {
          return {
            ...prev,
            [plane.icao24]: {
              ...prev[plane.icao24],
              category: updatedCategory,
            },
          };
        }
        return prev;
      });
    }
  };

  // Fetch flight plan route when toggle is enabled and aircraft is selected
  const fetchedRouteForAircraftRef = useRef(new Set<string>());

  useEffect(() => {
    if (showFlightPlanRoute && selectedAircraft?.icao24) {
      const aircraftKey = selectedAircraft.icao24;

      if (
        fetchedRouteForAircraftRef.current.has(
          `${aircraftKey}-${showFlightPlanRoute}`
        )
      ) {
        return;
      }

      const timer = setTimeout(() => {
        const plane = mergedPlanes.find((p) => p.icao24 === aircraftKey);
        if (plane) {
          const existingRoute = flightPlanRoutesRef.current[plane.icao24];
          const existingStatus =
            routeAvailabilityStatusRef.current[plane.icao24];

          if (!existingRoute || existingStatus?.available === false) {
            fetchFlightPlanRoute(plane);
            fetchedRouteForAircraftRef.current.add(
              `${aircraftKey}-${showFlightPlanRoute}`
            );
          }
        }
      }, 0);

      return () => clearTimeout(timer);
    }

    if (!showFlightPlanRoute) {
      fetchedRouteForAircraftRef.current.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showFlightPlanRoute,
    selectedAircraft?.icao24,
    mergedPlanes,
    fetchFlightPlanRoute,
  ]);

  const handleAirportSearch = async () => {
    if (!airportSearch.trim() || airportSearch.trim().length < 2) {
      setAirportSearchResults([]);
      return;
    }

    try {
      const results = await aircraftService.searchAirports(
        airportSearch.trim(),
        10
      );
      setAirportSearchResults(results);
    } catch (err) {
      console.error("Error searching airports:", err);
      setAirportSearchResults([]);
    }
  };

  const handleAirportSelect = (airport: AirportSearchResult) => {
    if (airport && airport.latitude_deg && airport.longitude_deg) {
      contextValue.setSearchLatlng([
        airport.latitude_deg,
        airport.longitude_deg,
      ]);
      setAirportSearch("");
      setAirportSearchResults([]);
      setSelectedAirport(airport);
      if (!showAirports) {
        setShowAirports(true);
      }
    }
  };

  const handleCloseAirportDetail = () => {
    setSelectedAirport(null);
  };

  // Debounced airport search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (airportSearch.trim().length >= 2) {
        handleAirportSearch();
      } else {
        setAirportSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airportSearch]);

  const renderPlanes = () => {
    if (!visiblePlaneEntries || visiblePlaneEntries.length === 0) {
      return <p>No planes to display.</p>;
    }

    return visiblePlaneEntries.map(({ plane, route, derivedCategory }) => {
      const isSelected = selectedAircraft?.icao24 === plane.icao24;
      const isHighlighted = highlightedAircraftIcao24 === plane.icao24;
      const isLoading = loadingRoutes.has(plane.icao24);

      return (
        <PlaneMarker
          key={plane.icao24}
          plane={plane}
          route={route}
          categoryOverride={derivedCategory}
          isSelected={isSelected}
          isHighlighted={isHighlighted}
          isLoading={isLoading}
          onMarkerClick={async (isPrefetch = false) => {
            const displayCallsign = plane.callsign || route?.callsign || "N/A";
            if (!isPrefetch) {
              setSelectedAircraft({
                icao24: plane.icao24,
                callsign: displayCallsign,
              });
              setHighlightedAircraftIcao24(plane.icao24);
            }

            // Fetch route data (airport info, aircraft type)
            // Flight plan waypoints will be fetched lazily when user toggles the route display
            const routeData = await fetchRouteForAircraftWithCategoryUpdate(
              plane,
              isPrefetch
            );
            if (!isPrefetch && routeData?.callsign) {
              setSelectedAircraft((prev) =>
                prev && prev.icao24 === plane.icao24
                  ? {
                      icao24: plane.icao24,
                      callsign: routeData.callsign || displayCallsign,
                    }
                  : prev
              );
            }
          }}
        />
      );
    });
  };

  const renderStarlink = () => {
    if (!starlink || starlink.length === 0) {
      return null;
    }

    return starlink.map((sat: StarlinkSatellite) => {
      if (sat.visibility !== null && sat.visibility !== undefined) {
        return <SatMarker key={sat.satid || sat.satname} sat={sat} />;
      }
      return null;
    });
  };

  return (
    <div
      className={`home-container ${isFullscreen ? "fullscreen-active" : ""}`}
    >
      <button className="fullscreen-button" onClick={handleToggleFullscreen}>
        {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
      </button>

      <button className="sidebar-toggle" onClick={handleToggleSidebar}>
        {sidebarOpen ? "◄" : "►"}
      </button>

      <div className={`aircraft-sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="sidebar-header">
          <h2>Aircraft on Screen</h2>
          <p className="aircraft-count">{visiblePlaneEntries.length} in view</p>
        </div>

        <div className="sidebar-search">
          <div className="search-input-wrapper">
            <input
              type="text"
              placeholder="Search ICAO24 or Callsign"
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleSidebarSearch()}
            />
            <button onClick={handleSidebarSearch} className="search-btn">
              {getSearchStatusIcon()} Search
            </button>
          </div>
          {searchStatus === "not-found" && (
            <p className="search-error-sidebar">Aircraft not found</p>
          )}
          {searchStatus === "stale" && (
            <p className="search-error-sidebar">
              Aircraft is no longer active (last seen hours ago)
            </p>
          )}
        </div>

        <div className="airport-controls">
          <div className="airport-toggle">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={showAirports}
                onChange={(e) => setShowAirports(e.target.checked)}
              />
              <span className="toggle-text">Show Airports</span>
            </label>
          </div>

          <div className="heatmap-toggle">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={showHeatmap}
                onChange={(e) => setShowHeatmap(e.target.checked)}
              />
              <span className="toggle-text">Show Traffic Heatmap</span>
            </label>
          </div>

          <div className="flightplan-toggle">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={showFlightPlanRoute}
                onChange={(e) => {
                  if (!isPremium()) {
                    setShowPremiumModal(true);
                    return;
                  }
                  setShowFlightPlanRoute(e.target.checked);
                }}
                disabled={!selectedAircraft}
              />
              <span className="toggle-text">
                Show Flight Plan Route
                {!isPremium() && (
                  <span className="premium-badge-small">⭐ Premium</span>
                )}
                {selectedAircraft &&
                  routeAvailabilityStatus[selectedAircraft.icao24]
                    ?.available === false && (
                    <span
                      className="route-warning"
                      title={
                        routeAvailabilityStatus[selectedAircraft.icao24]
                          ?.message
                      }
                    >
                      ⚠️
                    </span>
                  )}
              </span>
            </label>
            {selectedAircraft &&
              routeAvailabilityStatus[selectedAircraft.icao24]?.available ===
                false && (
                <p className="route-unavailable-message">
                  {routeAvailabilityStatus[selectedAircraft.icao24]?.message ||
                    "Flight route not available for this flight"}
                </p>
              )}
            {!selectedAircraft && (
              <p className="route-select-hint">
                Select an aircraft to view flight plan route
              </p>
            )}
          </div>

          {showAirports && (
            <>
              <div className="airport-filter">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={showClosedAirports}
                    onChange={(e) => setShowClosedAirports(e.target.checked)}
                  />
                  <span className="toggle-text">Show Closed Airports</span>
                </label>
              </div>

              <div className="airport-search">
                <div className="search-input-wrapper">
                  <input
                    type="text"
                    placeholder="Search airports..."
                    value={airportSearch}
                    onChange={(e) => setAirportSearch(e.target.value)}
                  />
                  {airportSearch && (
                    <button
                      className="clear-btn"
                      onClick={() => {
                        setAirportSearch("");
                        setAirportSearchResults([]);
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {airportSearchResults.length > 0 && (
                  <div className="airport-search-results">
                    {airportSearchResults.map((airport) => (
                      <div
                        key={airport.id}
                        className="airport-result-item"
                        onClick={() => handleAirportSelect(airport)}
                      >
                        <div className="airport-result-header">
                          <span className="airport-result-name">
                            {airport.name}
                          </span>
                          <div className="airport-result-codes">
                            {airport.iata && (
                              <span className="airport-result-iata">
                                {airport.iata}
                              </span>
                            )}
                            <span className="airport-result-icao">
                              {airport.icao || airport.id?.toString()}
                            </span>
                          </div>
                        </div>
                        <div className="airport-result-location">
                          {airport.municipality && `${airport.municipality}, `}
                          {airport.country}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {showAirports && airports.length > 0 && !selectedAirport && (
          <div className="airports-section">
            <div className="section-header">
              <h3>Airports in View</h3>
              <p className="airport-count">
                {
                  airports.filter(
                    (a) => showClosedAirports || a.type !== "closed"
                  ).length
                }{" "}
                airports
              </p>
            </div>
            <div className="airport-list">
              {airports
                .filter(
                  (airport) => showClosedAirports || airport.type !== "closed"
                )
                .slice(0, 10)
                .map((airport) => (
                  <div
                    key={airport.id}
                    className="airport-item"
                    onClick={() => handleAirportSelect(airport)}
                  >
                    <div className="airport-item-header">
                      <span className="airport-name">{airport.name}</span>
                      <div className="airport-codes">
                        {airport.iata && (
                          <span className="airport-iata">{airport.iata}</span>
                        )}
                        <span className="airport-icao">
                          {airport.icao || airport.id}
                        </span>
                      </div>
                    </div>
                    <div className="airport-item-details">
                      <div className="airport-detail-row">
                        <span className="airport-label">Type:</span>
                        <span className="airport-value">
                          {airport.type?.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="airport-detail-row">
                        <span className="airport-label">Location:</span>
                        <span className="airport-value">
                          {airport.municipality && `${airport.municipality}, `}
                          {airport.country}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              {airports.filter((a) => showClosedAirports || a.type !== "closed")
                .length > 10 && (
                <div className="more-airports">
                  +
                  {airports.filter(
                    (a) => showClosedAirports || a.type !== "closed"
                  ).length - 10}{" "}
                  more airports
                </div>
              )}
            </div>
          </div>
        )}

        {selectedAirport && (
          <div className="airports-section airport-detail-view">
            <div className="section-header">
              <h3>Airport Details</h3>
              <button
                className="close-detail-btn"
                onClick={handleCloseAirportDetail}
              >
                ✕
              </button>
            </div>
            <div className="airport-detail-content">
              <div className="airport-detail-main">
                <h4 className="airport-detail-name">{selectedAirport.name}</h4>
                <div className="airport-detail-codes">
                  {selectedAirport.iata && (
                    <span className="airport-iata">{selectedAirport.iata}</span>
                  )}
                  <span className="airport-icao">
                    {selectedAirport.icao || selectedAirport.id}
                  </span>
                </div>
              </div>

              <div className="airport-detail-info">
                <div className="airport-info-group">
                  <div className="airport-detail-row">
                    <span className="airport-label">Type:</span>
                    <span className="airport-value">
                      {selectedAirport.type?.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="airport-detail-row">
                    <span className="airport-label">Location:</span>
                    <span className="airport-value">
                      {selectedAirport.municipality &&
                        `${selectedAirport.municipality}, `}
                      {selectedAirport.country}
                    </span>
                  </div>
                  {selectedAirport.elevation_ft && (
                    <div className="airport-detail-row">
                      <span className="airport-label">Elevation:</span>
                      <span className="airport-value">
                        {selectedAirport.elevation_ft.toLocaleString()} ft
                      </span>
                    </div>
                  )}
                  <div className="airport-detail-row">
                    <span className="airport-label">Coordinates:</span>
                    <span className="airport-value">
                      {selectedAirport.latitude_deg?.toFixed(4)},{" "}
                      {selectedAirport.longitude_deg?.toFixed(4)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="aircraft-list">
          {visiblePlaneEntries.map(({ plane, route }) => {
            const nowSeconds = Math.floor(Date.now() / 1000);
            const displayCallsign = plane.callsign || route?.callsign || "N/A";
            const departureDisplay =
              route?.departureAirport?.icao ||
              route?.departureAirport?.iata ||
              route?.departureAirport?.name ||
              null;
            const arrivalDisplay =
              route?.arrivalAirport?.icao ||
              route?.arrivalAirport?.iata ||
              route?.arrivalAirport?.name ||
              null;
            const aircraftModel =
              route?.aircraft?.model ||
              plane.aircraft_model ||
              plane.model ||
              null;
            const dataAgeSeconds =
              plane.data_age_seconds ??
              (plane.last_contact
                ? Math.max(0, nowSeconds - plane.last_contact)
                : null);
            const dataAgeHours =
              dataAgeSeconds !== null
                ? (dataAgeSeconds / 3600).toFixed(1)
                : null;
            const isStale =
              plane.isStale ||
              (dataAgeSeconds !== null &&
                dataAgeSeconds > STALE_SEARCH_THRESHOLD_SECONDS);

            return (
              <div key={plane.icao24} className="aircraft-item">
                <div className="aircraft-header">
                  <span className="aircraft-callsign">{displayCallsign}</span>
                  <span className="aircraft-icao">{plane.icao24}</span>
                </div>
                <div className="aircraft-details">
                  {departureDisplay || arrivalDisplay ? (
                    <div className="detail-row">
                      <span className="detail-label">Route:</span>
                      <span className="detail-value">
                        {departureDisplay || "N/A"} → {arrivalDisplay || "N/A"}
                      </span>
                    </div>
                  ) : null}
                  {aircraftModel && (
                    <div className="detail-row">
                      <span className="detail-label">Aircraft:</span>
                      <span className="detail-value">{aircraftModel}</span>
                    </div>
                  )}
                  <div className="detail-row">
                    <span className="detail-label">Altitude:</span>
                    <span className="detail-value">
                      {plane.baro_altitude
                        ? `${Math.round(plane.baro_altitude * 3.28084)}ft`
                        : "N/A"}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Speed:</span>
                    <span className="detail-value">
                      {plane.velocity
                        ? `${Math.round(plane.velocity * 1.94384)}kts`
                        : "N/A"}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Heading:</span>
                    <span className="detail-value">
                      {plane.true_track
                        ? `${plane.true_track.toFixed(0)}°`
                        : "N/A"}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Position:</span>
                    <span className="detail-value small">
                      {plane.latitude?.toFixed(4)},{" "}
                      {plane.longitude?.toFixed(4)}
                    </span>
                  </div>
                  {isStale && (
                    <div className="detail-row stale-indicator">
                      <span className="detail-label">Status:</span>
                      <span className="detail-value">
                        Stale ⏱️{dataAgeHours ? ` (${dataAgeHours}h old)` : ""}
                      </span>
                    </div>
                  )}
                  <button
                    className="view-history-btn"
                    onClick={() => handleViewHistory(plane)}
                  >
                    📊 View Flight History
                  </button>
                </div>
              </div>
            );
          })}
          {visiblePlaneEntries.length === 0 && (
            <p className="no-aircraft">No aircraft in view</p>
          )}
        </div>
      </div>

      <div className={isFullscreen ? "map-fullscreen" : "map-regular"}>
        <MapContainer center={position} zoom={12} scrollWheelZoom>
          <MapDataFetcher
            setUserPosition={setUserPosition}
            setPlanes={setPlanes}
            setStarlink={setStarlink}
            setAirports={setAirports}
            showAirports={showAirports}
            websocketConnected={websocketConnected}
            fetchDataRef={fetchDataRef}
          />
          <MapFlyToHandler
            searchLatlng={searchLatlng}
            isFullscreen={isFullscreen}
          />
          <MapResizeHandler sidebarOpen={sidebarOpen} />
          <WebSocketHandler
            enabled={websocketEnabled}
            onConnectionChange={({ connected, error }) => {
              setWebsocketConnected(connected);
              if (error && !connected) {
                console.warn(
                  "WebSocket connection failed, falling back to polling"
                );
              }
            }}
            onAircraftUpdate={(update) => {
              if (update.type === "refresh_required") {
                console.log(
                  "WebSocket: Global update signal received, refreshing aircraft positions now"
                );

                if (fetchDataRef.current) {
                  fetchDataRef.current();
                  console.log(
                    "WebSocket: Triggered immediate refresh via fetchData"
                  );
                } else {
                  // Fallback: use aircraftService if ref not available
                  const mapElement =
                    document.querySelector(".leaflet-container");
                  if (mapElement && (mapElement as any).__map__) {
                    const map = (mapElement as any).__map__;
                    const bounds = map.getBounds();
                    const wrapBounds = map.wrapLatLngBounds(bounds);

                    aircraftService
                      .getAircraftInBounds({
                        southWest: wrapBounds.getSouthWest(),
                        northEast: wrapBounds.getNorthEast(),
                      })
                      .then((aircraft) => {
                        if (aircraft) {
                          setPlanes((prevPlanes) => {
                            const currentTime = Math.floor(Date.now() / 1000);
                            const maxAge = 5 * 60;

                            const existingPlanesMap = new Map(
                              prevPlanes.map((p) => [p.icao24, p])
                            );
                            const newPlanesMap = new Map(
                              aircraft.map((p) => [p.icao24, p])
                            );

                            const mergedPlanes = aircraft.map((newPlane) => {
                              const existing = existingPlanesMap.get(
                                newPlane.icao24
                              );
                              return mergePlaneRecords(existing, newPlane);
                            });

                            const preservedPlanes = prevPlanes.filter((p) => {
                              if (newPlanesMap.has(p.icao24)) return false;
                              const isRecent =
                                !p.last_contact ||
                                currentTime - p.last_contact <= maxAge;
                              const hasPosition =
                                p.latitude !== undefined &&
                                p.longitude !== undefined;
                              return isRecent && hasPosition;
                            });

                            return [...mergedPlanes, ...preservedPlanes];
                          });
                          console.log(
                            `WebSocket: Refreshed ${aircraft.length} aircraft positions (fallback)`
                          );
                        }
                      })
                      .catch((err) => {
                        console.error(
                          "Error refreshing aircraft data via WebSocket:",
                          err
                        );
                      });
                  }
                }
              } else if (
                update.type === "full" ||
                update.type === "incremental"
              ) {
                console.log(
                  "WebSocket update received:",
                  update.type,
                  "aircraft count:",
                  Array.isArray(update.data) ? update.data.length : "N/A"
                );

                if (update.type === "full" && Array.isArray(update.data)) {
                  setPlanes((prevPlanes) => {
                    const currentTime = Math.floor(Date.now() / 1000);
                    const maxAge = 5 * 60;

                    const normalizedUpdate = update.data.map(
                      (plane: Aircraft) => ({
                        ...plane,
                        source:
                          plane.source ??
                          (update.type === "full" ? "websocket" : "database"),
                        position_source:
                          update.type === "full" ? "websocket" : "database",
                        predicted: plane.predicted === true,
                      })
                    );

                    const existingPlanesMap = new Map(
                      prevPlanes.map((p) => [p.icao24, p])
                    );
                    const newPlanesMap = new Map(
                      normalizedUpdate.map((p) => [p.icao24, p])
                    );

                    const mergedPlanes = normalizedUpdate.map((newPlane) => {
                      const existing = existingPlanesMap.get(newPlane.icao24);
                      return mergePlaneRecords(existing, newPlane);
                    });

                    const preservedPlanes = prevPlanes.filter((p) => {
                      if (newPlanesMap.has(p.icao24)) return false;
                      const isRecent =
                        !p.last_contact ||
                        currentTime - p.last_contact <= maxAge;
                      const hasPosition =
                        p.latitude !== undefined && p.longitude !== undefined;
                      return isRecent && hasPosition;
                    });

                    return [...mergedPlanes, ...preservedPlanes];
                  });
                  console.log(
                    "WebSocket: Applied full aircraft update (merged)"
                  );
                }
              }
            }}
          />
          <TileLayer
            attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {renderStarlink()}
          {renderPlanes()}
          {showAirports &&
            airports
              .filter(
                (airport) => showClosedAirports || airport.type !== "closed"
              )
              .map((airport) => (
                <AirportMarker
                  key={airport.id || airport.icao}
                  airport={airport}
                  onAirportClick={handleAirportSelect}
                />
              ))}
          {showHeatmap && mergedPlanes.length > 0 && (
            <HeatmapLayer
              points={mergedPlanes
                .filter((plane) => {
                  const currentTime = Math.floor(Date.now() / 1000);
                  const maxAge = 10 * 60;
                  return (
                    (plane.velocity ?? 0) > MOVING_VELOCITY_THRESHOLD &&
                    (!plane.last_contact ||
                      currentTime - plane.last_contact <= maxAge)
                  );
                })
                .map((plane) => ({
                  latitude: plane.latitude,
                  longitude: plane.longitude,
                  intensity: plane.baro_altitude
                    ? Math.max(0.1, 1 - plane.baro_altitude / 15000)
                    : 0.5,
                }))}
              options={{
                radius: 20,
                blur: 25,
                maxZoom: 15,
                gradient: {
                  0.0: "rgba(0, 0, 255, 0)",
                  0.2: "rgba(0, 0, 255, 0.5)",
                  0.4: "cyan",
                  0.6: "lime",
                  0.8: "yellow",
                  1.0: "red",
                },
              }}
            />
          )}
          {showFlightPlanRoute &&
            selectedAircraft &&
            (() => {
              const flightPlanRoute = flightPlanRoutes[selectedAircraft.icao24];
              if (
                flightPlanRoute &&
                flightPlanRoute.available !== false &&
                flightPlanRoute.waypoints &&
                flightPlanRoute.waypoints.length > 0
              ) {
                return (
                  <FlightPlanRouteOverlay
                    key={flightPlanRoute.icao24 || flightPlanRoute.callsign}
                    flightPlanRoute={flightPlanRoute}
                    showWaypoints={true}
                  />
                );
              }
              return null;
            })()}
        </MapContainer>
      </div>

      {!isFullscreen && (
        <div className="site-info">
          <div className="info-content">
            <h2>Fly Overhead</h2>
            <p>Real-time aircraft tracking powered by OpenSky Network</p>
            <div className="info-grid">
              <div className="info-card">
                <h3>✈️ Live Tracking</h3>
                <p>
                  View aircraft in real-time with position, altitude, speed, and
                  heading data
                </p>
              </div>
              <div className="info-card">
                <h3>🛰️ Satellite Tracking</h3>
                <p>
                  Monitor Starlink satellites passing overhead your location
                </p>
              </div>
              <div className="info-card">
                <h3>🔍 Search Aircraft</h3>
                <p>
                  Search by ICAO24 code or flight callsign to track specific
                  aircraft
                </p>
              </div>
            </div>
            <div className="info-footer">
              <p>
                Data updates every 15 seconds | Powered by OpenSky Network API
              </p>
            </div>
          </div>
        </div>
      )}

      <FlightHistoryModal
        icao24={selectedAircraft?.icao24}
        callsign={selectedAircraft?.callsign}
        isOpen={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
      />

      <PremiumModal
        isOpen={showPremiumModal}
        onClose={() => setShowPremiumModal(false)}
        onSignup={() => setShowPremiumModal(false)}
      />
    </div>
  );
};

export default Home;
