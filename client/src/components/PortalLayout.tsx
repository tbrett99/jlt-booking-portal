import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useViewMode } from "@/contexts/ViewModeContext";
import {
  Bell, BookOpen, ChevronLeft, ChevronRight, ClipboardList,
  FileText, Home, LayoutDashboard, LogOut, Mail, Menu, Users, X,
  ArrowLeftRight, CheckCircle2, Clock, AlertCircle, XCircle, PenLine, Banknote, Upload, UserCircle,
  MessageSquare
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";

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
  const [notifOpen, setNotifOpen] = useState(false);
  const { viewMode, setViewMode, isAgentView } = useViewMode();

  const isAdminUser = user?.role === "admin" || user?.role === "super_admin";

  const { data: unreadCount = 0, refetch: refetchCount } = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const { data: unreadMessageCount = 0 } = trpc.notes.totalUnreadCount.useQuery(undefined, {
    enabled: isAdminUser && !isAgentView,
    refetchInterval: 30000,
  });

  const { data: notifications, refetch: refetchNotifs } = trpc.notifications.myNotifications.useQuery(undefined, {
    enabled: notifOpen,
  });

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => { refetchCount(); refetchNotifs(); },
  });

  const agentNavItems: NavItem[] = [
    { label: "My Dashboard", href: "/dashboard", icon: <Home size={18} /> },
    { label: "Register Booking", href: "/bookings/new", icon: <BookOpen size={18} /> },
    { label: "Request Amendment", href: "/request-amendment", icon: <PenLine size={18} /> },
    { label: "Cancel a Booking", href: "/cancel-booking", icon: <XCircle size={18} /> },
    { label: "My Commissions", href: "/commissions", icon: <Banknote size={18} /> },
  ];

  const adminNavItems: NavItem[] = [
    { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard size={18} /> },
    { label: "Booking Pipeline", href: "/pipeline", icon: <ClipboardList size={18} /> },
    { label: "Amendment Pipeline", href: "/amendments/pipeline", icon: <FileText size={18} /> },
    { label: "Refund Pipeline", href: "/refunds/pipeline", icon: <FileText size={18} /> },
    { label: "Commission Due", href: "/commission-due", icon: <AlertCircle size={18} /> },
    { label: "Commissions", href: "/commissions-admin", icon: <Banknote size={18} /> },
    { label: "Messages", href: "/messages", icon: <MessageSquare size={18} /> },
    { label: "Reports", href: "/reports", icon: <FileText size={18} /> },
    { label: "Import CSV", href: "/import", icon: <Upload size={18} /> },
    { label: "Users", href: "/users", icon: <Users size={18} /> },
    ...(user?.role === "super_admin"
      ? [{ label: "Notifications", href: "/notification-templates", icon: <Mail size={18} /> }]
      : []),
  ];

  const navItems = user?.role === "agent"
    ? agentNavItems
    : isAgentView
      ? agentNavItems
      : adminNavItems;

  const handleBellClick = () => {
    setNotifOpen((prev) => !prev);
    if (!notifOpen && unreadCount > 0) {
      markRead.mutate();
    }
  };

  const [, navigate] = useLocation();

  const handleSwitchView = () => {
    const next = isAgentView ? "admin" : "agent";
    setViewMode(next);
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
        <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Notifications overlay */}
      {notifOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
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
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground">
            <X size={16} />
          </button>
        </div>

        {/* User info */}
        {!collapsed && (
          <div className="px-4 py-3 border-b border-sidebar-border">
            <p className="text-xs font-medium text-sidebar-foreground truncate">{user?.name}</p>
            <p className="text-xs opacity-50 truncate">{user?.email}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="inline-block text-xs px-2 py-0.5 rounded-full font-medium" style={roleBadgeStyle(user?.role)}>
                {roleLabel(user?.role)}
              </span>
              {isAdminUser && isAgentView && (
                <span className="inline-block text-xs px-2 py-0.5 rounded-full font-medium border" style={{ background: "transparent", color: "#70FFE8", borderColor: "#70FFE8" }}>
                  Agent View
                </span>
              )}
            </div>
          </div>
        )}

        {/* Agent view banner */}
        {isAdminUser && isAgentView && !collapsed && (
          <div className="mx-3 mt-3 mb-1 px-3 py-2 rounded-lg text-xs flex items-center gap-2" style={{ background: "rgba(112,255,232,0.12)", color: "#70FFE8", border: "1px solid rgba(112,255,232,0.3)" }}>
            <ArrowLeftRight size={12} />
            <span>Viewing as Agent</span>
          </div>
        )}

        {/* Nav items */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            const isMessages = item.href === "/messages";
            const badge = isMessages && unreadMessageCount > 0 ? unreadMessageCount : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                  ${isActive ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground opacity-80 hover:opacity-100"}
                  ${collapsed ? "justify-center" : ""}
                `}
                onClick={() => setSidebarOpen(false)}
              >
                <span className="relative flex-shrink-0">
                  {item.icon}
                  {badge > 0 && collapsed && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: '#ef4444', color: 'white' }}>
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </span>
                {!collapsed && <span className="flex-1">{item.label}</span>}
                {!collapsed && badge > 0 && (
                  <span className="ml-auto min-w-[20px] h-5 px-1 rounded-full text-xs font-bold flex items-center justify-center" style={{ background: '#ef4444', color: 'white' }}>
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* View switcher */}
        {isAdminUser && (
          <div className="px-2 pb-1 border-t border-sidebar-border pt-3">
            <button
              onClick={handleSwitchView}
              title={isAgentView ? "Switch to Admin View" : "Switch to Agent View"}
              className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${collapsed ? "justify-center" : ""}`}
              style={{ color: "#70FFE8", background: "rgba(112,255,232,0.08)" }}
            >
              <ArrowLeftRight size={18} />
              {!collapsed && <span>{isAgentView ? "Switch to Admin View" : "Switch to Agent View"}</span>}
            </button>
          </div>
        )}

        {/* Profile + Logout */}
        <div className="px-2 py-3 border-t border-sidebar-border space-y-1">
          <Link
            href="/profile"
            className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent opacity-70 hover:opacity-100 transition-colors ${collapsed ? "justify-center" : ""}`}
            onClick={() => setSidebarOpen(false)}
          >
            <UserCircle size={18} />
            {!collapsed && <span>My Profile</span>}
          </Link>
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
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-lg hover:bg-muted">
            <Menu size={20} />
          </button>

          {isAdminUser && isAgentView && (
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium" style={{ background: "rgba(112,255,232,0.15)", color: "#02E6D2", border: "1px solid rgba(2,230,210,0.3)" }}>
              <ArrowLeftRight size={12} />
              Agent View
            </div>
          )}

          <div className="flex-1" />

          {/* Notification bell */}
          <div className="relative">
            <button
              onClick={handleBellClick}
              className="relative p-2 rounded-lg hover:bg-muted"
              aria-label="Notifications"
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

            {/* Notifications dropdown panel */}
            {notifOpen && (
              <div
                className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-xl shadow-xl border bg-card overflow-hidden z-50"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <h3 className="font-semibold text-sm">Notifications</h3>
                  <button onClick={() => setNotifOpen(false)} className="p-1 rounded hover:bg-muted">
                    <X size={14} />
                  </button>
                </div>
                <div className="max-h-96 overflow-y-auto divide-y">
                  {!notifications || notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
                      <CheckCircle2 size={28} className="mb-2 opacity-40" />
                      <p className="text-sm">You're all caught up</p>
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`px-4 py-3 hover:bg-muted/50 transition-colors ${!n.isRead ? "bg-[#70FFE8]/5 border-l-2 border-l-[#70FFE8]" : ""}`}
                      >
                        {n.linkUrl ? (
                          <Link href={n.linkUrl} onClick={() => setNotifOpen(false)}>
                            <NotifItem n={n} />
                          </Link>
                        ) : (
                          <NotifItem n={n} />
                        )}
                      </div>
                    ))
                  )}
                </div>
                {notifications && notifications.length > 0 && (
                  <div className="px-4 py-2 border-t text-center">
                    <button
                      onClick={() => markRead.mutate()}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Mark all as read
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 md:p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function NotifItem({ n }: { n: { message: string; createdAt: Date; isRead: boolean } }) {
  return (
    <div className="space-y-0.5 cursor-pointer">
      <p className={`text-sm leading-snug ${!n.isRead ? "font-medium text-foreground" : "text-muted-foreground"}`}>
        {n.message}
      </p>
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Clock size={10} />
        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
      </p>
    </div>
  );
}
