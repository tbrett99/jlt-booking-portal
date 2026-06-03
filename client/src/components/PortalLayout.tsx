import { useAuth } from "@/_core/hooks/useAuth";
import GlobalSearch from "@/components/GlobalSearch";
import { TermsSigningBanner } from "@/components/TermsSigningBanner";
import { trpc } from "@/lib/trpc";
import { useViewMode } from "@/contexts/ViewModeContext";
import {
  Bell, BookOpen, Building2, CalendarDays, ChevronLeft, ChevronRight, ChevronDown,
  FileText, Home, LayoutDashboard, LogOut, Menu, Users, X,
  ArrowLeftRight, Clock, AlertCircle, XCircle, PenLine, Banknote, Upload, UserCircle,
  MessageSquare, BarChart2, CheckSquare, BellRing, PoundSterling, ClipboardList,
  RefreshCw, Sparkles, FileUp, Mail, Settings, UserSearch, Megaphone, Receipt, UserCheck, CreditCard, FileSpreadsheet, Plane, UserX, UserPlus, Key, Shield, ExternalLink, FileSignature, Calculator, TrendingUp, Zap, Newspaper, Activity
} from "lucide-react";
import { useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────
interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: number;
}

interface NavGroup {
  label: string;
  icon: React.ReactNode;
  items: NavItem[];
  defaultOpen?: boolean;
  // If set, the group header itself is a link
  href?: string;
}

// ─── Sidebar nav group component ─────────────────────────────────────────────
// ─── Open CRM Button (magic link SSO) ───────────────────────────────────────
function OpenCrmButton({ collapsed }: { collapsed: boolean }) {
  const generateToken = trpc.sso.generateToken.useMutation();

  const handleClick = useCallback(async () => {
    try {
      const { ssoUrl } = await generateToken.mutateAsync();
      window.open(ssoUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("SSO token generation failed", err);
      alert("Could not open Orbit. Please try again.");
    }
  }, [generateToken]);

  return (
    <div className="px-2 pb-1 border-t border-sidebar-border pt-2">
      <button
        onClick={handleClick}
        disabled={generateToken.isPending}
        title="Open Orbit"
        className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 ${collapsed ? "justify-center" : ""}`}
        style={{ color: "#70FFE8", background: "rgba(112,255,232,0.08)" }}
      >
        {generateToken.isPending ? (
          <RefreshCw size={16} className="animate-spin" />
        ) : (
          <ExternalLink size={16} />
        )}
        {!collapsed && <span>{generateToken.isPending ? "Opening..." : "Open Orbit"}</span>}
      </button>
    </div>
  );
}

function SidebarGroup({
  group,
  location,
  collapsed,
  onNavigate,
  unreadMessageCount,
  overdueCount,
}: {
  group: NavGroup;
  location: string;
  collapsed: boolean;
  onNavigate: () => void;
  unreadMessageCount?: number;
  overdueCount?: number;
}) {
  const isAnyActive = group.items.some(
    (i) => location === i.href || (i.href !== "/" && location.startsWith(i.href))
  );
  const [open, setOpen] = useState(group.defaultOpen ?? isAnyActive);

  if (collapsed) {
    // In collapsed mode show only icons for active items
    return (
      <>
        {group.items.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          const badge = item.href === "/messages" && (unreadMessageCount ?? 0) > 0 ? unreadMessageCount : (item.badge ?? 0);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-center w-10 h-10 mx-auto rounded-lg transition-colors relative ${
                isActive ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent opacity-70 hover:opacity-100"
              }`}
              onClick={onNavigate}
              title={item.label}
            >
              <span className="relative">
                {item.icon}
                {(badge ?? 0) > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 px-0.5 rounded-full text-[9px] font-bold flex items-center justify-center" style={{ background: '#ef4444', color: 'white' }}>
                    {(badge ?? 0) > 9 ? '9+' : badge}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </>
    );
  }

  return (
    <div className="space-y-0.5">
      {/* Group header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors text-sidebar-foreground opacity-50 hover:opacity-80"
      >
        <span className="flex-1 text-left">{group.label}</span>
        {group.label === "Communication" && (unreadMessageCount ?? 0) > 0 && (
          <span className="min-w-[18px] h-4.5 px-1 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: '#ef4444', color: 'white' }}>
            {(unreadMessageCount ?? 0) > 99 ? '99+' : unreadMessageCount}
          </span>
        )}
        {group.label === "CRM" && (overdueCount ?? 0) > 0 && (
          <span className="min-w-[18px] h-4.5 px-1 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: '#f59e0b', color: 'white' }}>
            {(overdueCount ?? 0) > 99 ? '99+' : (overdueCount ?? 0)}
          </span>
        )}
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-0.5 pl-1">
          {group.items.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            const badge = item.href === "/messages" && (unreadMessageCount ?? 0) > 0 ? unreadMessageCount : (item.badge ?? 0);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground opacity-80 hover:opacity-100"
                }`}
                onClick={onNavigate}
              >
                <span className="relative flex-shrink-0">
                  {item.icon}
                  {(badge ?? 0) > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 px-0.5 rounded-full text-[9px] font-bold flex items-center justify-center" style={{ background: '#ef4444', color: 'white' }}>
                      {(badge ?? 0) > 9 ? '9+' : badge}
                    </span>
                  )}
                </span>
                <span className="flex-1 truncate">{item.label}</span>
                {(badge ?? 0) > 0 && (
                  <span className="ml-auto min-w-[20px] h-5 px-1 rounded-full text-xs font-bold flex items-center justify-center" style={{ background: '#ef4444', color: 'white' }}>
                    {(badge ?? 0) > 99 ? '99+' : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main layout ──────────────────────────────────────────────────────────────
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const { isAgentView, setViewMode } = useViewMode();

  const isAdminUser = user?.role === "admin" || user?.role === "super_admin";
  const isAgent = user?.role === "agent";

  // Orbit beta access — only fetch for agents (admins always see it)
  // No staleTime so the flag is always fresh on page load/navigation
  const { data: myProfile } = trpc.crm.agentCrm.getMyProfile.useQuery(undefined, {
    enabled: !!user && isAgent,
  });
  const orbitEnabled = isAdminUser || myProfile?.orbitEnabled === true;

  const { data: unreadCount = 0, refetch: refetchCount } = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 30000,
    // staleTime matches the poll interval so React Query won't re-render subscribers
    // unless the data actually changes between polls.
    staleTime: 30000,
  });

  const { data: unreadMessageCount = 0 } = trpc.notes.totalUnreadCount.useQuery(undefined, {
    enabled: isAdminUser && !isAgentView,
    refetchInterval: 30000,
    staleTime: 30000,
  });

  const { data: overdueData } = trpc.crm.agentCrm.getOverdueCount.useQuery(undefined, {
    enabled: isAdminUser && !isAgentView,
    refetchInterval: 120000,
    staleTime: 120000,
  });
  const overdueCount = overdueData?.count ?? 0;

  const { data: notifications, refetch: refetchNotifs } = trpc.notifications.myNotifications.useQuery(undefined, {
    enabled: notifOpen,
  });

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => { refetchCount(); refetchNotifs(); },
  });

  // ── Urgent counts for top bar (admin only) ─────────────────────────────────
  // Single lightweight SQL query replaces 4 heavy full-table fetches.
  const { data: urgentCounts } = trpc.dashboard.urgentCounts.useQuery(undefined, {
    enabled: isAdminUser && !isAgentView,
    refetchInterval: 60000,
    staleTime: 60000,
  });

  const filesToAddToPts = urgentCounts?.filesToAddToPts ?? 0;
  const newAmendments = urgentCounts?.newAmendments ?? 0;
  const newRefunds = urgentCounts?.newRefunds ?? 0;
  const commissionDueCount = urgentCounts?.commissionDueCount ?? 0;
  const outstandingReimbs = urgentCounts?.outstandingReimbs ?? 0;
  const lateUnactionedCount = urgentCounts?.lateUnactionedCount ?? 0;
  const pendingFlightCount = urgentCounts?.pendingFlightCount ?? 0;
  const newSignUpsCount = urgentCounts?.newSignUpsCount ?? 0;

  const urgentStats = isAdminUser && !isAgentView ? [
    { label: "To Add to PTS", value: filesToAddToPts, href: "/pipeline", color: "#92400e", bg: "#fef3c7" },
    { label: "New Amendments", value: newAmendments, href: "/amendments/pipeline", color: "#7c3aed", bg: "#f5f3ff" },
    { label: "New Refunds", value: newRefunds, href: "/refunds/pipeline", color: "#9d174d", bg: "#fce7f3" },
    { label: "Outstanding Reimb.", value: outstandingReimbs as number, href: "/admin/reimbursements", color: "#1e3a5f", bg: "#dbeafe" },
    { label: "Commission Due", value: commissionDueCount, href: "/commission-due", color: "#065f46", bg: "#d1fae5" },
    { label: "Late Reimb.", value: lateUnactionedCount as number, href: "/admin/reimbursements", color: "#7c2d12", bg: "#fee2e2" },
    { label: "Pending Flights", value: pendingFlightCount as number, href: "/flights", color: "#1e40af", bg: "#dbeafe" },
    { label: "New Sign-Ups", value: newSignUpsCount as number, href: "/crm/memberships", color: "#5b21b6", bg: "#ede9fe" },
  ] : [];

  // ── Agent nav ─────────────────────────────────────────────────────────────
  const agentNavGroups: NavGroup[] = [
    {
      label: "My Bookings",
      icon: <Home size={16} />,
      defaultOpen: true,
      items: [
        { label: "My Dashboard", href: "/dashboard", icon: <Home size={16} /> },
        { label: "Register Booking", href: "/bookings/new", icon: <BookOpen size={16} /> },
        { label: "Request Amendment", href: "/request-amendment", icon: <PenLine size={16} /> },
        { label: "Cancel a Booking", href: "/cancel-booking", icon: <XCircle size={16} /> },
        { label: "Flight Requests", href: "/flight-requests", icon: <Plane size={16} /> },
      ],
    },
    {
      label: "Finance",
      icon: <Banknote size={16} />,
      defaultOpen: true,
      items: [
        { label: "My Commissions", href: "/commissions", icon: <Banknote size={16} /> },
        { label: "Commission Timeline", href: "/commission-timeline", icon: <CalendarDays size={16} /> },
      ],
    },
    {
      label: "Community",
      icon: <Newspaper size={16} />,
      defaultOpen: false,
      items: [
        { label: "Community Hub", href: "/community", icon: <Newspaper size={16} /> },
        { label: "Events Calendar", href: "/events", icon: <CalendarDays size={16} /> },
      ],
    },
    {
      label: "Supplier Directory",
      icon: <Building2 size={16} />,
      defaultOpen: false,
      items: [
        { label: "Supplier Directory", href: "/suppliers", icon: <Building2 size={16} /> },
      ],
    },
    {
      label: "Documents",
      icon: <Mail size={16} />,
      defaultOpen: false,
      items: [
        { label: "Booking Documents", href: "/booking-documents", icon: <Mail size={16} /> },
      ],
    },
    {
       label: "My Account",
      icon: <UserCheck size={16} />,
      defaultOpen: false,
      items: [
        { label: "My Profile", href: "/my-profile", icon: <UserCheck size={16} /> },
      ],
    },
    {
      label: "Pricing Calculator",
      icon: <Calculator size={16} />,
      defaultOpen: false,
      items: [
        { label: "Package Pricing Calculator", href: "/pricing-calculator", icon: <Calculator size={16} /> },
        { label: "My Commission Margin", href: "/my-margin", icon: <TrendingUp size={16} /> },
      ],
    },
  ];
  // ── Admin nav groups ──────────────────────────────────────────────────────
  const adminNavGroups: NavGroup[] = [
    {
      label: "Overview",
      icon: <LayoutDashboard size={16} />,
      defaultOpen: true,
      items: [
        { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard size={16} /> },
      ],
    },
    {
      label: "Pipelines",
      icon: <ClipboardList size={16} />,
      defaultOpen: true,
      items: [
        { label: "Bookings Pipeline", href: "/pipeline", icon: <ClipboardList size={16} /> },
        { label: "Amendments Pipeline", href: "/amendments/pipeline", icon: <FileText size={16} /> },
        { label: "Refund Pipeline", href: "/refunds/pipeline", icon: <RefreshCw size={16} /> },
        { label: "Flight Requests", href: "/flights", icon: <Plane size={16} /> },
      ],
    },
    {
      label: "Commissions",
      icon: <Banknote size={16} />,
      defaultOpen: false,
      items: [
        { label: "Commission Due", href: "/commission-due", icon: <AlertCircle size={16} /> },
        { label: "Commission Management", href: "/commissions-admin", icon: <Sparkles size={16} /> },
        { label: "PTS Remittance", href: "/remittance", icon: <FileSpreadsheet size={16} /> },
        { label: "Reimbursements", href: "/admin/reimbursements", icon: <PoundSterling size={16} /> },
        { label: "Remittances", href: "/crm/remittances", icon: <Receipt size={16} /> },
      ],
    },
    {
      label: "Communication",
      icon: <MessageSquare size={16} />,
      defaultOpen: false,
      items: [
        { label: "Messages", href: "/messages", icon: <MessageSquare size={16} /> },
      ],
    },
    {
      label: "Calendar & Tasks",
      icon: <CalendarDays size={16} />,
      defaultOpen: false,
      items: [
        { label: "Calendar", href: "/admin/calendar", icon: <CalendarDays size={16} /> },
        { label: "Tasks", href: "/admin/tasks", icon: <CheckSquare size={16} /> },
      ],
    },
    {
      label: "Reports",
      icon: <BarChart2 size={16} />,
      defaultOpen: false,
      items: [
        ...(user?.role === "super_admin"
          ? [{ label: "Business Intelligence", href: "/super-admin", icon: <Activity size={16} /> }]
          : []),
        { label: "Admin Reports", href: "/reports", icon: <FileText size={16} /> },
        { label: "Commission Margin", href: "/commission-margin", icon: <TrendingUp size={16} /> },
        { label: "Agent Performance", href: "/agent-performance", icon: <BarChart2 size={16} /> },
      ],
    },
    {
      label: "Documents",
      icon: <Mail size={16} />,
      defaultOpen: false,
      items: [
        { label: "Booking Documents", href: "/booking-documents", icon: <Mail size={16} /> },
      ],
    },
    {
      label: "CRM",
      icon: <UserSearch size={16} />,
      defaultOpen: false,
      items: [
        { label: "Agent CRM", href: "/crm/agents", icon: <UserCheck size={16} /> },
        { label: "Sign-Up Applications", href: "/crm/join-sessions", icon: <UserSearch size={16} /> },
        { label: "Abandoned Sign-Ups", href: "/crm/abandoned-signups", icon: <UserX size={16} /> },
        { label: "Change Requests", href: "/crm/change-requests", icon: <ClipboardList size={16} /> },
        { label: "Memberships", href: "/crm/memberships", icon: <CreditCard size={16} /> },
      ],
    },
    {
      label: "Marketing",
      icon: <Megaphone size={16} />,
      defaultOpen: false,
      items: [
        { label: "Agent Recruitment", href: "/crm/recruitment", icon: <UserPlus size={16} /> },
        { label: "Email Workflows", href: "/crm/workflows", icon: <Mail size={16} /> },
        { label: "Prospects", href: "/crm/prospects", icon: <Users size={16} /> },
        { label: "Email Marketing", href: "/crm/email-marketing", icon: <Megaphone size={16} /> },
      ],
    },
    {
      label: "Community",
      icon: <Newspaper size={16} />,
      defaultOpen: false,
      items: [
        { label: "Community Hub", href: "/community", icon: <Newspaper size={16} /> },
        { label: "Weekly Digest", href: "/admin/weekly-digest", icon: <Mail size={16} /> },
      ],
    },
    {
      label: "Supplier Directory",
      icon: <Building2 size={16} />,
      defaultOpen: false,
      items: [
        { label: "View Directory", href: "/suppliers", icon: <Building2 size={16} /> },
        { label: "Manage Suppliers", href: "/admin/suppliers", icon: <Building2 size={16} /> },
      ],
    },
    {
      label: "Admin",
      icon: <Users size={16} />,
      defaultOpen: false,
      items: [
        { label: "Users", href: "/users", icon: <Users size={16} /> },
        { label: "Import CSV", href: "/import", icon: <FileUp size={16} /> },
        { label: "Payment Config", href: "/crm/payment-config", icon: <PoundSterling size={16} /> },
        ...(user?.role === "super_admin"
          ? [{ label: "Notification Templates", href: "/notification-templates", icon: <Bell size={16} /> }]
          : []),
        { label: "Notif. Preferences", href: "/notif-prefs", icon: <BellRing size={16} /> },
        { label: "System Workflows", href: "/admin/system-workflows", icon: <Zap size={16} /> },
        { label: "Inbox Config", href: "/admin/inbox-config", icon: <Settings size={16} /> },
        { label: "Inbox Search History", href: "/admin/inbox-audit", icon: <Mail size={16} /> },
        { label: "Agent Email Log", href: "/admin/agent-email-log", icon: <Mail size={16} /> },
        ...(user?.role === "super_admin" || user?.role === "admin"
          ? [
              { label: "API Keys", href: "/admin/api-keys", icon: <Key size={16} /> },
              { label: "OAuth Clients", href: "/admin/oauth-clients", icon: <Shield size={16} /> },
              { label: "Terms Tracker", href: "/admin/terms-tracker", icon: <FileSignature size={16} /> },
            ]
          : []),
      ],
    },
  ];

  // When an agent is in onboarding state, show only a minimal nav
  const isOnboardingAgent = user?.role === "agent" && (user as any).portalStatus === "onboarding";

  const onboardingNavGroups: NavGroup[] = [
    {
      label: "Getting Started",
      icon: <Home size={16} />,
      defaultOpen: true,
      items: [
        { label: "Complete Onboarding", href: "/onboarding", icon: <UserCheck size={16} /> },
      ],
    },
  ];

  const navGroups = isOnboardingAgent
    ? onboardingNavGroups
    : (user?.role === "agent" || isAgentView) ? agentNavGroups : adminNavGroups;

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
          ${collapsed ? "w-14" : "w-56"}
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
        style={{ background: "var(--sidebar)", color: "var(--sidebar-foreground)" }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-3 py-4 border-b border-sidebar-border">
          <div
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs"
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
            className="hidden lg:flex p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground opacity-60 hover:opacity-100 flex-shrink-0"
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground">
            <X size={14} />
          </button>
        </div>

        {/* User info */}
        {!collapsed && (
          <div className="px-3 py-2.5 border-b border-sidebar-border">
            <p className="text-xs font-medium text-sidebar-foreground truncate">{user?.name}</p>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={roleBadgeStyle(user?.role)}>
                {roleLabel(user?.role)}
              </span>
              {isAdminUser && isAgentView && (
                <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium border" style={{ background: "transparent", color: "#70FFE8", borderColor: "#70FFE8" }}>
                  Agent View
                </span>
              )}
            </div>
          </div>
        )}

        {/* Nav groups */}
        <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
          {navGroups.map((group) => (
            <SidebarGroup
              key={group.label}
              group={group}
              location={location}
              collapsed={collapsed}
              onNavigate={() => setSidebarOpen(false)}
              unreadMessageCount={unreadMessageCount}
              overdueCount={overdueCount}
            />
          ))}
        </nav>

        {/* Open Orbit button — admins always; agents only if orbitEnabled is true */}
        {orbitEnabled && <OpenCrmButton collapsed={collapsed} />}

        {/* View switcher */}
        {isAdminUser && (
          <div className="px-2 pb-1 border-t border-sidebar-border pt-2">
            <button
              onClick={handleSwitchView}
              title={isAgentView ? "Switch to Admin View" : "My Agent View"}
              className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${collapsed ? "justify-center" : ""}`}
              style={{ color: "#70FFE8", background: "rgba(112,255,232,0.08)" }}
            >
              <ArrowLeftRight size={16} />
              {!collapsed && <span>{isAgentView ? "Switch to Admin View" : "My Agent View"}</span>}
            </button>
          </div>
        )}

        {/* Profile + Logout */}
        <div className="px-2 py-2 border-t border-sidebar-border space-y-0.5">
          <Link
            href="/profile"
            className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent opacity-70 hover:opacity-100 transition-colors ${collapsed ? "justify-center" : ""}`}
            onClick={() => setSidebarOpen(false)}
          >
            <UserCircle size={16} />
            {!collapsed && <span>My Profile</span>}
          </Link>
          <button
            onClick={logout}
            className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent opacity-70 hover:opacity-100 transition-colors ${collapsed ? "justify-center" : ""}`}
          >
            <LogOut size={16} />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-10 bg-card border-b border-border shadow-sm">
          {/* Primary row */}
          <div className="flex items-center gap-3 px-4 py-2.5">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-lg hover:bg-muted">
              <Menu size={18} />
            </button>

            {isAdminUser && isAgentView && (
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: "rgba(112,255,232,0.15)", color: "#02E6D2", border: "1px solid rgba(2,230,210,0.3)" }}>
                <ArrowLeftRight size={11} />
                My Agent View
              </div>
            )}

            <div className="flex-1 flex items-center justify-center px-2">
              <GlobalSearch />
            </div>

            {/* Notification bell */}
            <div className="relative">
              <button
                onClick={handleBellClick}
                className="relative p-2 rounded-lg hover:bg-muted"
                aria-label="Notifications"
              >
                <Bell size={18} />
                {unreadCount > 0 && (
                  <span
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold"
                    style={{ background: "#02E6D2", color: "#414141" }}
                  >
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>

              {/* Notifications dropdown */}
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
                        <Bell size={24} className="mb-2 opacity-30" />
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
          </div>

          {/* Urgent stats bar — admin only */}
          {urgentStats.length > 0 && (
            <div className="flex items-center gap-1 px-4 pb-2 overflow-x-auto">
              {urgentStats.map(({ label, value, href, color, bg }) => (
                <Link key={label} href={href}>
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer transition-opacity hover:opacity-80 whitespace-nowrap ${value === 0 ? "opacity-40" : ""}`}
                    style={{ background: value > 0 ? bg : "#f3f4f6", color: value > 0 ? color : "#9ca3af" }}
                  >
                    <span className="font-bold tabular-nums">{value}</span>
                    <span>{label}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </header>

        {/* Terms signing banner — shown to agents with unsigned active terms */}
        <TermsSigningBanner />

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
