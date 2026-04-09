import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import LoginPage from "./pages/LoginPage";
import AgentDashboard from "./pages/agent/AgentDashboard";
import RegisterBooking from "./pages/agent/RegisterBooking";
import AgentBookingDetail from "./pages/agent/AgentBookingDetail";
import AmendmentForm from "./pages/agent/AmendmentForm";
import CancellationForm from "./pages/agent/CancellationForm";
import RefundForm from "./pages/agent/RefundForm";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminKanban from "./pages/admin/AdminKanban";
import AdminBookingDetail from "./pages/admin/AdminBookingDetail";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminAmendments from "./pages/admin/AdminAmendments";
import AdminRefunds from "./pages/admin/AdminRefunds";
import AdminReports from "./pages/admin/AdminReports";
import NotificationTemplates from "./pages/admin/NotificationTemplates";
import PortalLayout from "./components/PortalLayout";
import { useAuth } from "./_core/hooks/useAuth";
import { Loader2 } from "lucide-react";

function AuthRouter() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: '#70FFE8' }}>
            <Loader2 className="animate-spin text-[#414141]" size={24} />
          </div>
          <p className="text-muted-foreground text-sm">Loading JLT Portal...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Switch>
        <Route path="/" component={LoginPage} />
        <Route path="/login" component={LoginPage} />
        <Route component={LoginPage} />
      </Switch>
    );
  }

  // Agent routes
  if (user.role === "agent") {
    return (
      <PortalLayout>
        <Switch>
          <Route path="/" component={AgentDashboard} />
          <Route path="/dashboard" component={AgentDashboard} />
          <Route path="/bookings/new" component={RegisterBooking} />
          <Route path="/bookings/:id" component={AgentBookingDetail} />
          <Route path="/bookings/:id/amend" component={AmendmentForm} />
          <Route path="/bookings/:id/cancel" component={CancellationForm} />
          <Route path="/bookings/:id/refund" component={RefundForm} />
          <Route component={NotFound} />
        </Switch>
      </PortalLayout>
    );
  }

  // Admin / Super Admin routes
  return (
    <PortalLayout>
      <Switch>
        <Route path="/" component={AdminDashboard} />
        <Route path="/dashboard" component={AdminDashboard} />
        <Route path="/pipeline" component={AdminKanban} />
        <Route path="/bookings/:id" component={AdminBookingDetail} />
        <Route path="/users" component={AdminUsers} />
        <Route path="/amendments" component={AdminAmendments} />
        <Route path="/refunds" component={AdminRefunds} />
        <Route path="/reports" component={AdminReports} />
        <Route path="/notification-templates" component={NotificationTemplates} />
        <Route component={NotFound} />
      </Switch>
    </PortalLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <AuthRouter />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
