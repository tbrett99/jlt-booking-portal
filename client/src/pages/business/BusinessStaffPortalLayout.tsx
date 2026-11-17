import { createContext, useContext, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  BookOpen,
  Building2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  ExternalLink,
  GraduationCap,
  FileText,
  Plane,
  Home,
  LogOut,
  Mail,
  Menu,
  PlayCircle,
  Shield,
  X,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { SidebarGroup, type NavGroup } from "@/components/PortalLayout";
import { readBusinessStaffPermissions } from "@shared/business-staff";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";

type ApiOutputs = inferRouterOutputs<AppRouter>;
export type BusinessStaffPortalAuthority = ApiOutputs["businessStaff"]["mine"];
const BusinessStaffPortalContext =
  createContext<BusinessStaffPortalAuthority | null>(null);
const StaffPortalFrame = createContext(false);

// Only the root's authoritative classification belongs here. Do not infer
// business-staff identity from users.role, a route name or browser storage.
export function BusinessStaffPortalProvider({
  authority,
  children,
}: {
  authority: BusinessStaffPortalAuthority;
  children: ReactNode;
}) {
  return (
    <BusinessStaffPortalContext.Provider value={authority}>
      {children}
    </BusinessStaffPortalContext.Provider>
  );
}

export function useBusinessStaffPortalAuthority() {
  return useContext(BusinessStaffPortalContext);
}

// Reuse the single root authority without adding another stale query observer.
// A supplied but inactive authority never falls back to ordinary-agent access.
export function useBusinessStaffBookingAccess() {
  const authority = useBusinessStaffPortalAuthority();
  const isBusinessStaff = authority !== null;
  const permissions = readBusinessStaffPermissions(authority?.membership?.permissions);
  const active = authority?.managed === true && authority.active === true && !!authority.membership;
  return {
    isBusinessStaff,
    canView: !isBusinessStaff || (active && permissions.viewBookings),
    canManage: !isBusinessStaff || (active && permissions.viewBookings && permissions.manageBookings),
  };
}

// The direct root shell and nested resource PortalLayout calls share one frame.
// The restricted body contains no instructor, CRM, counters, notifications,
// global search, terms-banner or SSO hooks — not even disabled legacy hooks.
export function BusinessStaffPortalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const alreadyFramed = useContext(StaffPortalFrame);
  if (alreadyFramed) return <>{children}</>;
  return (
    <StaffPortalFrame.Provider value={true}>
      <BusinessStaffPortalBody>{children}</BusinessStaffPortalBody>
    </StaffPortalFrame.Provider>
  );
}

function BusinessStaffPortalBody({ children }: { children: ReactNode }) {
  const authority = useBusinessStaffPortalAuthority();
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Unlike the ordinary agent shell, staff resources are visible on arrival.
  const [collapsed, setCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const active =
    !!user &&
    authority?.managed === true &&
    authority.active === true &&
    !!authority.membership;
  const permissions = readBusinessStaffPermissions(
    active ? authority?.membership?.permissions : null
  );
  const resourceAccess = permissions.resourceAccess;
  const ownerName =
    authority?.owner?.name || authority?.owner?.email || "your business owner";
  const closeSidebar = () => setSidebarOpen(false);
  const groups: NavGroup[] = [
    {
      label: "My Bookings",
      icon: <Home size={16} />,
      defaultOpen: true,
      items: [
        {
          label: "Home",
          href: "/business-staff",
          icon: <Home size={16} />,
          exact: true,
        },
        ...(permissions.viewBookings
          ? [
              {
                label: "My Bookings",
                href: "/my-bookings",
                icon: <BookOpen size={16} />,
              },
              { label: "My Requests", href: "/my-requests", icon: <FileText size={16} /> },
              { label: "Messages", href: "/messages", icon: <Mail size={16} /> },
              ...(permissions.manageBookings ? [
                { label: "Register Booking", href: "/bookings/new", icon: <BookOpen size={16} /> },
                { label: "Request Amendment", href: "/request-amendment", icon: <FileText size={16} /> },
                { label: "Flight Requests", href: "/flight-requests", icon: <Plane size={16} /> },
                { label: "Cancel Booking", href: "/cancel-booking", icon: <X size={16} /> },
              ] : []),
            ]
          : []),
      ],
    },
    ...(permissions.academyAccess || resourceAccess
      ? [
          {
            label: "Learning",
            icon: <GraduationCap size={16} />,
            defaultOpen: true,
            items: [
              ...(permissions.academyAccess
                ? [
                    {
                      label: "JLT Academy",
                      href: "/academy",
                      icon: <GraduationCap size={16} />,
                      exact: true,
                    },
                  ]
                : []),
              ...(resourceAccess
                ? [
                    {
                      label: "Knowledge Base",
                      href: "/knowledge-base",
                      icon: <BookOpen size={16} />,
                    },
                    {
                      label: "Webinar Library",
                      href: "/webinars",
                      icon: <PlayCircle size={16} />,
                    },
                  ]
                : []),
            ],
          },
        ]
      : []),
    ...(resourceAccess
      ? [
          {
            label: "Supplier Directory",
            icon: <Building2 size={16} />,
            defaultOpen: true,
            items: [
              {
                label: "Supplier Directory",
                href: "/suppliers",
                icon: <Building2 size={16} />,
              },
            ],
          },
          {
            label: "Pricing & Fees",
            icon: <CreditCard size={16} />,
            defaultOpen: true,
            items: [
              {
                label: "PTS Fees",
                href: "https://fees.thejltgroup.co.uk",
                icon: <ExternalLink size={16} />,
                external: true,
              },
              {
                label: "Card Fees",
                href: "https://fees.thejltgroup.co.uk/card-fees",
                icon: <CreditCard size={16} />,
                external: true,
              },
            ],
          },
        ]
      : []),
  ];
  const footerClass = `flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent opacity-70 hover:opacity-100 transition-colors ${collapsed ? "justify-center" : ""}`;
  return (
    <div className="flex min-h-screen bg-background" data-business-staff-portal>
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation overlay"
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={closeSidebar}
        />
      )}
      <aside
        id="business-staff-sidebar"
        aria-label="Portal sidebar"
        className={`fixed lg:relative z-30 flex flex-col h-screen transition-all duration-300 ${collapsed ? "w-14" : "w-56"} ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
        style={{
          background: "var(--sidebar)",
          color: "var(--sidebar-foreground)",
        }}
      >
        <div className="flex items-center gap-2.5 px-3 py-4 border-b border-sidebar-border">
          <div
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs"
            style={{ background: "#70FFE8", color: "#414141" }}
          >
            JLT
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-sidebar-foreground truncate">
                JLT Group
              </p>
              <p className="text-xs opacity-60 truncate">Booking Portal</p>
            </div>
          )}
          <button
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            aria-controls="business-staff-sidebar"
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground opacity-60 hover:opacity-100 flex-shrink-0"
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={closeSidebar}
            className="lg:hidden p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground"
          >
            <X size={14} />
          </button>
        </div>
        {!collapsed && (
          <div className="px-3 py-2.5 border-b border-sidebar-border">
            <p className="text-xs font-medium text-sidebar-foreground truncate">
              {user?.name}
            </p>
            <span
              className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: "#FFF6ED", color: "#414141" }}
            >
              Staff
            </span>
          </div>
        )}
        <nav
          aria-label="Business-staff navigation"
          className="portal-sidebar-scroll flex-1 px-2 py-3 space-y-1 overflow-y-auto"
        >
          {groups.map(group => (
            <SidebarGroup
              key={group.label}
              group={group}
              location={location}
              collapsed={collapsed}
              onNavigate={closeSidebar}
              preferenceScope={`jlt-sidebar:${user?.id ?? "anonymous"}:business-staff`}
            />
          ))}
        </nav>
        <div className="px-2 py-2 border-t border-sidebar-border space-y-0.5">
          <a
            href="mailto:support@thejltgroup.co.uk"
            title="Contact Support"
            aria-label="Contact Support"
            className={footerClass}
            onClick={closeSidebar}
          >
            <Mail size={16} />
            {!collapsed && <span>Contact Support</span>}
          </a>
          <Link
            href="/my-agreements"
            title="Agreements & Policies"
            aria-label="Agreements & Policies"
            aria-current={location === "/my-agreements" ? "page" : undefined}
            className={`${footerClass} ${location === "/my-agreements" ? "bg-sidebar-primary text-sidebar-primary-foreground" : ""}`}
            onClick={closeSidebar}
          >
            <Shield size={16} />
            {!collapsed && <span>Agreements & Policies</span>}
          </Link>
          <button
            type="button"
            aria-label="Sign out"
            title="Sign out"
            className={`${footerClass} disabled:opacity-50`}
            disabled={loggingOut}
            onClick={async () => {
              setLoggingOut(true);
              setLogoutError("");
              try {
                await logout();
              } catch {
                setLogoutError("Sign out failed. Please try again.");
              } finally {
                setLoggingOut(false);
              }
            }}
          >
            <LogOut size={16} />
            {!collapsed && (
              <span>{loggingOut ? "Signing out…" : "Sign out"}</span>
            )}
          </button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-10 bg-card border-b border-border shadow-sm">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <button
              type="button"
              aria-label="Open navigation"
              aria-expanded={sidebarOpen}
              aria-controls="business-staff-sidebar"
              onClick={() => {
                setCollapsed(false);
                setSidebarOpen(true);
              }}
              className="lg:hidden p-2 rounded-lg hover:bg-muted"
            >
              <Menu size={18} />
            </button>
            {collapsed && (
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                className="hidden lg:flex items-center gap-2 rounded-lg border border-[#a7f3e8] bg-[#f0fffb] px-3 py-2 text-xs font-bold text-[#065f46] transition-colors hover:bg-[#e5fff9]"
              >
                <Menu size={16} /> Explore portal
              </button>
            )}
            <p className="flex-1 min-w-0 truncate text-sm text-muted-foreground">
              {active ? `Working with ${ownerName}` : "Business-staff access"}
            </p>
            <span
              className="rounded-full px-2.5 py-1 text-xs font-medium"
              style={{ background: "#FFF6ED", color: "#414141" }}
            >
              Staff
            </span>
          </div>
          {logoutError && (
            <p role="alert" className="px-4 pb-3 text-sm text-destructive">
              {logoutError}
            </p>
          )}
        </header>
        <main
          data-portal-primary-scroll-root
          className="flex-1 p-4 md:p-6 overflow-auto"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export default BusinessStaffPortalLayout;
