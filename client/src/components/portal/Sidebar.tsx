import React from 'react';
import './Sidebar.css';

export type SidebarSection = 
  | 'dashboard' 
  | 'feeders'
  | 'flight-plan' 
  | 'flights' 
  | 'maps' 
  | 'logbook' 
  | 'debriefs' 
  | 'checklist' 
  | 'aircraft' 
  | 'api-keys' 
  | 'settings';

interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
}

interface NavItem {
  id: SidebarSection;
  icon: string;
  label: string;
  badge?: number;
}

const navItems: NavItem[] = [
  { id: 'dashboard', icon: 'DB', label: 'Dashboard' },
  { id: 'feeders', icon: 'FD', label: 'Feeders' },
  { id: 'flight-plan', icon: 'FP', label: 'Flight Plan' },
  { id: 'flights', icon: 'FL', label: 'Flights' },
  { id: 'maps', icon: 'MP', label: 'Maps' },
  { id: 'logbook', icon: 'LB', label: 'Logbook' },
  { id: 'debriefs', icon: 'DB', label: 'Debriefs' },
  { id: 'checklist', icon: 'CL', label: 'Checklist' },
  { id: 'aircraft', icon: 'AC', label: 'Aircraft' },
  { id: 'api-keys', icon: 'AK', label: 'API Keys' },
  { id: 'settings', icon: 'ST', label: 'Settings' },
];

const Sidebar: React.FC<SidebarProps> = ({ activeSection, onSectionChange }) => {
  return (
    <aside className="efb-sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <span className="logo-icon">FO</span>
          <span className="logo-text">Fly Overhead</span>
        </div>
      </div>
      
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${activeSection === item.id ? 'active' : ''}`}
            onClick={() => onSectionChange(item.id)}
            aria-label={item.label}
            title={item.label}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            {item.badge && item.badge > 0 && (
              <span className="nav-badge">{item.badge}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="status-indicator">
          <span className="status-dot"></span>
          <span className="status-text">Online</span>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;

