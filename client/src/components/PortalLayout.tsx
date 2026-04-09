import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Bell, BookOpen, ChevronLeft, ChevronRight, ClipboardList, FileText, Home, LayoutDashboard, LogOut, Mail, Menu, Settings, Users, X } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { toast } from "sonner";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  roles: string[];
  badge?: number;
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const { data: unreadCount = 0 } = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const markRead = trpc.notifications.markRead.useMutation();

  const agentNavItems: NavItem[] = [
    { label: "Dashboard", href: "/dashboard", icon: <Home size={18} />, roles: ["agent"] },
    { label: "Register Booking", href: "/bookings/new", icon: <BookOpen size={18} />, roles: ["agent"] },
  ];

  const adminNavItems: NavItem[] = [
    { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard size={18} />, roles: ["admin", "super_admin"] },
    { label: "Pipeline", href: "/pipeline", icon: <ClipboardList size={18} />, roles: ["admin", "super_admin"] },
    { label: "Amendments", href: "/amendments", icon: <FileText size={18} />, roles: ["admin", "super_admin"] },
    { label: "Refunds", href: "/refunds", icon: <FileText size={18} />, roles: ["admin", "super_admin"] },
    { label: "Reports", href: "/reports", icon: <FileText size={18} />, roles: ["admin", "super_admin"] },
    { label: "Users", href: "/users", icon: <Users size={18} />, roles: ["admin", "super_admin"] },
    { label: "Notifications", href: "/notification-templates", icon: <Mail size={18} />, roles: ["super_admin"] },
  ];

  const navItems = user?.role === "agent" ? agentNavItems : adminNavItems;

  const handleLogout = () => {
    logout();
  };

  const handleBellClick = async () => {
    if (unreadCount > 0) {
      await markRead.mutateAsync();
    }
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
        style={{ background: 'var(--sidebar)', color: 'var(--sidebar-foreground)' }}
      >
        {/* Logo area */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
          <div
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm"
            style={{ background: '#70FFE8', color: '#414141' }}
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
            <span
              className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium"
              style={{
                background: user?.role === "super_admin" ? "#70FFE8" : user?.role === "admin" ? "#FFC3BC" : "#FFF6ED",
                color: "#414141"
              }}
            >
              {user?.role === "super_admin" ? "Super Admin" : user?.role === "admin" ? "Admin" : "Agent"}
            </span>
          </div>
        )}

        {/* Nav items */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href}
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

        {/* Logout */}
        <div className="px-2 py-4 border-t border-sidebar-border">
          <button
            onClick={handleLogout}
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
                  style={{ background: '#02E6D2', color: '#414141' }}
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
