import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useViewMode } from "@/contexts/ViewModeContext";
import {
  Bell, BookOpen, ChevronLeft, ChevronRight, ClipboardList,
  FileText, Home, LayoutDashboard, LogOut, Mail, Menu, Users, X,
  ArrowLeftRight
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { viewMode, setViewMode, isAgentView } = useViewMode();

  const isAdminUser = user?.role === "admin" || user?.role === "super_admin";

  const { data: unreadCount = 0 } = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const markRead = trpc.notifications.markRead.useMutation();

  const agentNavItems: NavItem[] = [
    { label: "My Dashboard", href: "/dashboard", icon: <Home size={18} /> },
    { label: "Register Booking", href: "/bookings/new", icon: <BookOpen size={18} /> },
  ];

  const adminNavItems: NavItem[] = [
    { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard size={18} /> },
    { label: "Pipeline", href: "/pipeline", icon: <ClipboardList size={18} /> },
    { label: "Amendments", href: "/amendments", icon: <FileText size={18} /> },
    { label: "Refunds", href: "/refunds", icon: <FileText size={18} /> },
    { label: "Reports", href: "/reports", icon: <FileText size={18} /> },
    { label: "Users", href: "/users", icon: <Users size={18} /> },
    ...(user?.role === "super_admin"
      ? [{ label: "Notifications", href: "/notification-templates", icon: <Mail size={18} /> }]
      : []),
  ];

  // Determine which nav to show
  const navItems = user?.role === "agent"
    ? agentNavItems
    : isAgentView
      ? agentNavItems
      : adminNavItems;

  const handleBellClick = async () => {
    if (unreadCount > 0) {
      await markRead.mutateAsync();
    }
  };

  const [, navigate] = useLocation();

  const handleSwitchView = () => {
    const next = isAgentView ? "admin" : "agent";
    setViewMode(next);
    // Navigate to the dashboard for the new view
    navigate("/dashboard");
  };

  const roleBadgeStyle = (role?: string) => {
    if (role === "super_admin") return { background: "#70FFE8", color: "#414141" };
    if (role === "admin") return { background: "#FFC3BC", color: "#414141" };
    return { background: "#FFF6ED", color: "#414141" };
  };

  const roleLabel = (role?: string) => {
    if (role === "super_admin") return "Super Admin";
    if (role === "admin") return "Admin";
    return "Agent";
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:relative z-30 flex flex-col h-screen transition-all duration-300
          ${collapsed ? "w-16" : "w-64"}
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
        style={{ background: "var(--sidebar)", color: "var(--sidebar-foreground)" }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
          <div
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm"
            style={{ background: "#70FFE8", color: "#414141" }}
          >
            JLT
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-sidebar-foreground truncate">JLT Group</p>
              <p className="text-xs opacity-60 truncate">Booking Portal</p>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground opacity-60 hover:opacity-100"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {/* User info */}
        {!collapsed && (
          <div className="px-4 py-3 border-b border-sidebar-border">
            <p className="text-xs font-medium text-sidebar-foreground truncate">{user?.name}</p>
            <p className="text-xs opacity-50 truncate">{user?.email}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span
                className="inline-block text-xs px-2 py-0.5 rounded-full font-medium"
                style={roleBadgeStyle(user?.role)}
              >
                {roleLabel(user?.role)}
              </span>
              {/* Show "Agent View" badge when admin is in agent view */}
              {isAdminUser && isAgentView && (
                <span
                  className="inline-block text-xs px-2 py-0.5 rounded-full font-medium border"
                  style={{ background: "transparent", color: "#70FFE8", borderColor: "#70FFE8" }}
                >
                  Agent View
                </span>
              )}
            </div>
          </div>
        )}

        {/* View switcher banner for admin in agent view */}
        {isAdminUser && isAgentView && !collapsed && (
          <div
            className="mx-3 mt-3 mb-1 px-3 py-2 rounded-lg text-xs flex items-center gap-2"
            style={{ background: "rgba(112,255,232,0.12)", color: "#70FFE8", border: "1px solid rgba(112,255,232,0.3)" }}
          >
            <ArrowLeftRight size={12} />
            <span>Viewing as Agent</span>
          </div>
        )}

        {/* Nav items */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive =
              location === item.href ||
              (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                  ${isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground opacity-80 hover:opacity-100"
                  }
                  ${collapsed ? "justify-center" : ""}
                `}
                onClick={() => setSidebarOpen(false)}
              >
                {item.icon}
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* View switcher button (admin only) */}
        {isAdminUser && (
          <div className="px-2 pb-1 border-t border-sidebar-border pt-3">
            <button
              onClick={handleSwitchView}
              title={isAgentView ? "Switch to Admin View" : "Switch to Agent View"}
              className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${collapsed ? "justify-center" : ""}`}
              style={{ color: "#70FFE8", background: "rgba(112,255,232,0.08)" }}
            >
              <ArrowLeftRight size={18} />
              {!collapsed && (
                <span>{isAgentView ? "Switch to Admin View" : "Switch to Agent View"}</span>
              )}
            </button>
          </div>
        )}

        {/* Logout */}
        <div className="px-2 py-3 border-t border-sidebar-border">
          <button
            onClick={logout}
            className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent opacity-70 hover:opacity-100 transition-colors ${collapsed ? "justify-center" : ""}`}
          >
            <LogOut size={18} />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-10 flex items-center gap-4 px-4 py-3 bg-card border-b border-border shadow-sm">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-muted"
          >
            <Menu size={20} />
          </button>

          {/* Agent view indicator in top bar */}
          {isAdminUser && isAgentView && (
            <div
              className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
              style={{ background: "rgba(112,255,232,0.15)", color: "#02E6D2", border: "1px solid rgba(2,230,210,0.3)" }}
            >
              <ArrowLeftRight size={12} />
              Agent View — viewing as agent
            </div>
          )}

          <div className="flex-1" />

          {/* Notification bell */}
          <Link href="/dashboard">
            <button
              onClick={handleBellClick}
              className="relative p-2 rounded-lg hover:bg-muted"
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full text-xs flex items-center justify-center font-bold"
                  style={{ background: "#02E6D2", color: "#414141" }}
                >
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </Link>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 md:p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
