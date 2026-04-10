import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ViewModeProvider, useViewMode } from "./contexts/ViewModeContext";
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
import AdminAmendmentKanban from "./pages/admin/AdminAmendmentKanban";
import AdminRefundKanban from "./pages/admin/AdminRefundKanban";
import CommissionDue from "./pages/admin/CommissionDue";
import AdminReports from "./pages/admin/AdminReports";
import NotificationTemplates from "./pages/admin/NotificationTemplates";
import AgentCommissions from "./pages/agent/AgentCommissions";
import AgentCancelBooking from "./pages/agent/AgentCancelBooking";
import AgentRequestAmendment from "./pages/agent/AgentRequestAmendment";
import AdminCommissions from "./pages/admin/AdminCommissions";
import AdminImport from "./pages/admin/AdminImport";
import AdminMessages from "./pages/admin/AdminMessages";
import PtsMissingPaymentDate from "./pages/admin/PtsMissingPaymentDate";
import PortalLayout from "./components/PortalLayout";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import ProfilePage from "./pages/ProfilePage";
import { useAuth } from "./_core/hooks/useAuth";
import { Loader2 } from "lucide-react";

function AuthRouter() {
  const { user, loading } = useAuth();
  const { isAgentView } = useViewMode();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "#70FFE8" }}>
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
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route component={LoginPage} />
      </Switch>
    );
  }

  // Force password change before accessing any other page.
  // Skip this check during impersonation — admins should not be forced to change
  // the agent's password just to view their account.
  const isImpersonating = document.cookie.split(";").some((c) => c.trim().startsWith("is_impersonating="));
  if (user.mustChangePassword && !isImpersonating) {
    return <ChangePasswordPage />;
  }

  const isAdminUser = user.role === "admin" || user.role === "super_admin";

  // Pure agent — always agent routes
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
          <Route path="/commissions" component={AgentCommissions} />
          <Route path="/cancel-booking" component={AgentCancelBooking} />
          <Route path="/request-amendment" component={AgentRequestAmendment} />
          <Route path="/profile" component={ProfilePage} />
          <Route component={NotFound} />
        </Switch>
      </PortalLayout>
    );
  }

  // Admin / Super Admin — switch between admin view and agent view
  if (isAdminUser && isAgentView) {
    return (
      <PortalLayout>
        <Switch>
          <Route path="/" component={AgentDashboard} />
          <Route path="/dashboard" component={AgentDashboard} />
          <Route path="/bookings/new" component={RegisterBooking} />
          {/* Agent booking detail — but admin still sees admin detail for pipeline management */}
          <Route path="/bookings/:id" component={AgentBookingDetail} />
          <Route path="/bookings/:id/amend" component={AmendmentForm} />
          <Route path="/bookings/:id/cancel" component={CancellationForm} />
          <Route path="/bookings/:id/refund" component={RefundForm} />
          <Route path="/commissions" component={AgentCommissions} />
          <Route path="/cancel-booking" component={AgentCancelBooking} />
          <Route path="/request-amendment" component={AgentRequestAmendment} />
          <Route path="/profile" component={ProfilePage} />
          <Route component={NotFound} />
        </Switch>
      </PortalLayout>
    );
  }

  // Admin / Super Admin — default admin view
  return (
    <PortalLayout>
      <Switch>
        <Route path="/" component={AdminDashboard} />
        <Route path="/dashboard" component={AdminDashboard} />
        <Route path="/pipeline" component={AdminKanban} />
        <Route path="/bookings/:id" component={AdminBookingDetail} />
        <Route path="/users" component={AdminUsers} />
        <Route path="/amendments" component={AdminAmendments} />
        <Route path="/amendments/pipeline" component={AdminAmendmentKanban} />
        <Route path="/refunds" component={AdminRefunds} />
        <Route path="/refunds/pipeline" component={AdminRefundKanban} />
        <Route path="/commission-due" component={CommissionDue} />
        <Route path="/commissions-admin" component={AdminCommissions} />
        <Route path="/reports" component={AdminReports} />
        <Route path="/notification-templates" component={NotificationTemplates} />
        <Route path="/import" component={AdminImport} />
        <Route path="/pts-missing-payment" component={PtsMissingPaymentDate} />
        <Route path="/messages" component={AdminMessages} />
        <Route path="/profile" component={ProfilePage} />
        <Route component={NotFound} />
      </Switch>
    </PortalLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <ViewModeProvider>
          <TooltipProvider>
            <Toaster />
            <AuthRouter />
          </TooltipProvider>
        </ViewModeProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
