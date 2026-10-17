import { useEffect, useMemo, useRef, useState } from 'react';
import { useSystemHealth } from '../hooks/useSystemHealth';
import {
  Activity,
  Bell,
  ChevronDown,
  FileText,
  LayoutDashboard,
  Lock,
  LogOut,
  MoonStar,
  MonitorSmartphone,
  Settings,
  ShieldCheck,
  SunMedium,
  UserCog,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../app/store/authStore';
import { AgentWatchLogo } from './brand';

type NavItem = { label: string; to: string; icon: typeof LayoutDashboard };
type NavSection = { title: string; items: NavItem[] };

const navByRole: Record<string, NavSection[]> = {
  ADMIN: [
    {
      title: 'Overview',
      items: [
        { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
      ],
    },
    {
      title: 'Monitoring',
      items: [
        { label: 'Agents', to: '/agents', icon: Users },
        { label: 'Devices', to: '/devices', icon: MonitorSmartphone },
        { label: 'Live Monitoring', to: '/monitor/active', icon: Zap },
        { label: 'Sessions', to: '/sessions', icon: Activity },
      ],
    },
    {
      title: 'Security',
      items: [
        { label: 'Audit Logs', to: '/audit-logs', icon: FileText },
        { label: 'Security', to: '/security', icon: ShieldCheck },
      ],
    },
    {
      title: 'Administration',
      items: [
        { label: 'Users', to: '/users', icon: UserCog },
        { label: 'Settings', to: '/settings', icon: Settings },
      ],
    },
  ],
  MANAGER: [
    {
      title: 'Overview',
      items: [{ label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard }],
    },
    {
      title: 'Monitoring',
      items: [
        { label: 'Agents', to: '/agents', icon: Users },
        { label: 'Devices', to: '/devices', icon: MonitorSmartphone },
        { label: 'Live Monitoring', to: '/monitor/active', icon: Zap },
        { label: 'Sessions', to: '/sessions', icon: Activity },
      ],
    },
    {
      title: 'Security',
      items: [
        { label: 'Audit Logs', to: '/audit-logs', icon: FileText },
        { label: 'Security', to: '/security', icon: ShieldCheck },
      ],
    },
    {
      title: 'Administration',
      items: [{ label: 'Settings', to: '/settings', icon: Settings }],
    },
  ],
  TEAM_LEADER: [
    {
      title: 'Overview',
      items: [{ label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard }],
    },
    {
      title: 'Monitoring',
      items: [
        { label: 'Agents', to: '/agents', icon: Users },
        { label: 'Devices', to: '/devices', icon: MonitorSmartphone },
        { label: 'Sessions', to: '/sessions', icon: Activity },
      ],
    },
    {
      title: 'Security',
      items: [{ label: 'Security', to: '/security', icon: ShieldCheck }],
    },
  ],
  IT_SUPPORT: [
    {
      title: 'Overview',
      items: [{ label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard }],
    },
    {
      title: 'Monitoring',
      items: [
        { label: 'Devices', to: '/devices', icon: MonitorSmartphone },
        { label: 'Sessions', to: '/sessions', icon: Activity },
      ],
    },
    {
      title: 'Security',
      items: [
        { label: 'Security', to: '/security', icon: ShieldCheck },
        { label: 'Audit Logs', to: '/audit-logs', icon: FileText },
      ],
    },
  ],
  AGENT: [
    {
      title: 'Overview',
      items: [{ label: 'Profile', to: '/profile', icon: UserCog }],
    },
    {
      title: 'Monitoring',
      items: [{ label: 'Sessions', to: '/sessions', icon: Activity }],
    },
  ],
};

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/agents': 'Agents',
  '/devices': 'Devices',
  '/monitor': 'Live Monitoring',
  '/sessions': 'Sessions',
  '/audit-logs': 'Audit Logs',
  '/security': 'Security',
  '/users': 'Users',
  '/roles': 'Roles',
  '/profile': 'Profile',
  '/settings': 'Settings',
};

export function AppLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  // One source of truth for the mobile drawer
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('agentwatch-theme');
    return saved === 'dark' ? 'dark' : 'light';
  });

  const session = useAuthStore((state) => state.session);
  const clearSession = useAuthStore((state) => state.clearSession);
  const role = session?.role ?? 'MANAGER';
  const navSections = navByRole[role] ?? navByRole['MANAGER'];
  const { status: systemStatus } = useSystemHealth(30000);

  // Sync theme
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('agentwatch-theme', theme);
  }, [theme]);

  // Close menus on route change
  useEffect(() => {
    setMenuOpen(false);
    setProfileMenuOpen(false);
  }, [location.pathname]);

  // Prevent background scroll when mobile drawer is open
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden';
      // Auto-focus drawer close button
      const timer = window.setTimeout(() => {
        drawerCloseButtonRef.current?.focus();
      }, 50);
      return () => {
        window.clearTimeout(timer);
        document.body.style.overflow = '';
      };
    } else {
      document.body.style.overflow = '';
    }
  }, [menuOpen]);

  // Close mobile drawer on Escape key press
  useEffect(() => {
    if (!menuOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        hamburgerButtonRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [menuOpen]);

  // Close profile dropdown when clicking outside
  useEffect(() => {
    if (!profileMenuOpen) return;

    const handleOutsideClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [profileMenuOpen]);

  const pageTitle = useMemo(() => {
    const matched = Object.entries(pageTitles).find(([path]) => location.pathname.startsWith(path));
    return matched ? matched[1] : 'Overview';
  }, [location.pathname]);

  const handleLogout = async () => {
    setProfileMenuOpen(false);
    setMenuOpen(false);
    try {
      const { logout } = await import('../services/api');
      await logout();
    } catch {
      // Ensure local state is cleared even if the import or API call fails.
      clearSession();
    }
    navigate('/login');
  };

  const goTo = (path: string) => {
    navigate(path);
    setMenuOpen(false);
    setProfileMenuOpen(false);
  };

  const renderNavLinks = (isDrawer = false) =>
    navSections.map((section) => (
      <div className="nav-section" key={section.title}>
        <div className="nav-section-title">{section.title}</div>
        {section.items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.label}
              onClick={() => {
                if (isDrawer) {
                  setMenuOpen(false);
                }
              }}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              <Icon size={18} className="nav-icon" />
              <span className="nav-label">{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    ));

  return (
    <div className="app-shell">
      {/* Main Content Area */}
      <div className="app-main">
        {/* Header */}
        <header className="app-header">
          <div className="header-left">
            {/* Burger button — always visible at all breakpoints */}
            <button
              ref={hamburgerButtonRef}
              type="button"
              className="hamburger-btn"
              aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={menuOpen}
              aria-controls="burger-navigation"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className={`burger-icon ${menuOpen ? 'open' : ''}`}>
                <span />
                <span />
                <span />
              </span>
            </button>

            {/* Brand — always shown next to the burger */}
            <div className="header-brand">
              <AgentWatchLogo
                size="sm"
                variant="auto"
                linkTo="/dashboard"
              />
            </div>

            {/* Page title block */}
            <div className="header-title-block">
              <div className="breadcrumb">OVERVIEW / {pageTitle.toUpperCase()}</div>
              <h1 className="page-heading">{pageTitle}</h1>
            </div>
          </div>

          <div className="header-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Toggle theme"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? <SunMedium size={18} /> : <MoonStar size={18} />}
            </button>

            <button
              type="button"
              className="icon-button"
              aria-label="Notifications"
              title="System notifications"
            >
              <Bell size={18} />
              {systemStatus !== 'online' && (
                <span className="notification-badge" style={{ background: systemStatus === 'offline' ? '#dc2626' : '#f59e0b' }}>!</span>
              )}
            </button>

            <div className="user-menu-wrap" ref={userMenuRef}>
              <button
                type="button"
                className="user-trigger"
                onClick={() => setProfileMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
              >
                <span className="avatar">{(session?.email ?? 'M').charAt(0).toUpperCase()}</span>
                <span className="user-copy">
                  <strong>{session?.email ?? 'manager@agentwatch.local'}</strong>
                  <small>{role}</small>
                </span>
                <ChevronDown size={14} className={`user-chevron ${profileMenuOpen ? 'rotated' : ''}`} />
              </button>

              {profileMenuOpen && (
                <div className="user-menu" role="menu">
                  <div className="user-menu-header">
                    <strong>{session?.email ?? 'Manager'}</strong>
                    <span className="user-role-badge">{role}</span>
                  </div>
                  <div className="menu-divider" />
                  <button type="button" onClick={() => goTo('/profile')} className="menu-item">
                    <UserCog size={15} /> Profile
                  </button>
                  <button type="button" onClick={() => goTo('/security')} className="menu-item">
                    <Lock size={15} /> Security
                  </button>
                  <button type="button" onClick={() => goTo('/settings')} className="menu-item">
                    <Settings size={15} /> Settings
                  </button>
                  <div className="menu-divider" />
                  <button type="button" onClick={handleLogout} className="menu-item danger">
                    <LogOut size={15} /> Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="page-container">{children}</main>
      </div>

      {/* Mobile Drawer Background Overlay */}
      <div
        className={`mobile-overlay ${menuOpen ? 'visible' : ''}`}
        onClick={() => setMenuOpen(false)}
        aria-hidden={!menuOpen}
      />

      {/* Burger Menu Drawer */}
      <aside
        id="burger-navigation"
        className={`mobile-drawer ${menuOpen ? 'open' : ''}`}
        aria-label="Navigation menu"
      >
        <div className="drawer-header">
          <AgentWatchLogo
            size="md"
            variant="dark"
            showTagline
            linkTo="/dashboard"
          />
          <button
            ref={drawerCloseButtonRef}
            type="button"
            className="drawer-close-btn"
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        <div className="sidebar-status compact-status">
          <span
            className="status-dot"
            style={{
              background:
                systemStatus === 'online' ? 'var(--green, #22c55e)'
                : systemStatus === 'degraded' ? '#f59e0b'
                : systemStatus === 'offline' ? '#dc2626'
                : '#94a3b8',
            }}
          />
          <span>
            {systemStatus === 'online' ? 'SYSTEM ONLINE'
              : systemStatus === 'degraded' ? 'SYSTEM DEGRADED'
              : systemStatus === 'offline' ? 'SYSTEM OFFLINE'
              : 'CHECKING...'}
          </span>
        </div>

        <nav className="nav-list drawer-nav-scroll" aria-label="Mobile drawer navigation">
          {renderNavLinks(true)}
        </nav>

        <div className="drawer-footer">
          <div className="drawer-user">
            <span className="avatar">{(session?.email ?? 'M').charAt(0).toUpperCase()}</span>
            <div className="user-copy">
              <strong>{session?.email ?? 'manager@agentwatch.local'}</strong>
              <small>{role}</small>
            </div>
          </div>
          <button type="button" onClick={handleLogout} className="danger-btn small-btn full-width-btn">
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>
    </div>
  );
}
