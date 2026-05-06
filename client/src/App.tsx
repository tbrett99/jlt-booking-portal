import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
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
import CommissionTimeline from "./pages/agent/CommissionTimeline";
import AgentCancelBooking from "./pages/agent/AgentCancelBooking";
import AgentRequestAmendment from "./pages/agent/AgentRequestAmendment";
import AgentFlightRequests from "./pages/agent/AgentFlightRequests";
import AgentNotifications from "./pages/agent/AgentNotifications";
import AdminFlightsPipeline from "./pages/admin/AdminFlightsPipeline";
import AdminCommissions from "./pages/admin/AdminCommissions";
import RemittanceManagement from "./pages/admin/RemittanceManagement";
import AdminImport from "./pages/admin/AdminImport";
import AdminAgentPerformance from "./pages/admin/AdminAgentPerformance";
import AdminMessages from "./pages/admin/AdminMessages";
import PtsMissingPaymentDate from "./pages/admin/PtsMissingPaymentDate";
import CommissionClaimableMissingPaymentDate from "./pages/admin/CommissionClaimableMissingPaymentDate";
import AdminNotifPrefs from "./pages/admin/AdminNotifPrefs";
import AdminTasks from "./pages/admin/AdminTasks";
import AdminCalendar from "./pages/admin/AdminCalendar";
import AdminReimbursements from "./pages/admin/AdminReimbursements";
import PortalLayout from "./components/PortalLayout";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import ProfilePage from "./pages/ProfilePage";
import BookingDocuments from "./pages/BookingDocuments";
import AdminInboxConfig from "./pages/admin/AdminInboxConfig";
import AdminInboxAudit from "./pages/admin/AdminInboxAudit";
import AgentEmailLog from "./pages/admin/AgentEmailLog";
import AbandonedSignups from "./pages/admin/AbandonedSignups";
import CrmPipeline from "./pages/crm/CrmPipeline";
import CrmProspects from "./pages/crm/CrmProspects";
import ProspectDetail from "./pages/crm/ProspectDetail";
import CrmCampaigns from "./pages/crm/CrmCampaigns";
import EmailMarketing from "./pages/crm/EmailMarketing";
import CrmRemittances from "./pages/crm/CrmRemittances";
import CrmPaymentConfig from "./pages/crm/CrmPaymentConfig";
import EnquiryForm from "./pages/crm/EnquiryForm";
import AgentApplicationForm from "./pages/crm/AgentApplicationForm";
import SignContract from "./pages/crm/SignContract";
import MembershipSelection from "./pages/crm/MembershipSelection";
import WonAgentPortal from "./pages/crm/WonAgentPortal";
import MembershipSuccess from "./pages/crm/MembershipSuccess";
import OnboardingDashboard from "./pages/agent/OnboardingDashboard";
import DdSetup from "./pages/agent/DdSetup";
import DdComplete from "./pages/agent/DdComplete";
import RegisterPage from "./pages/RegisterPage";
import JoinFlow from "./pages/JoinFlow";
import JoinAccept from "./pages/JoinAccept";
import AgentCrm from "./pages/crm/AgentCrm";
import ContractEvidenceViewer from "./pages/crm/ContractEvidenceViewer";
import JoinSessions from "./pages/crm/JoinSessions";
import PaymentResult from "./pages/PaymentResult";
import PaymentRedirect from "./pages/PaymentRedirect";
import CrmChangeRequests from "./pages/crm/CrmChangeRequests";
import Memberships from "./pages/crm/Memberships";
import MyProfile from "./pages/MyProfile";
import TermsAndPolicies from "./pages/TermsAndPolicies";
import UnsubscribePage from "./pages/UnsubscribePage";
import ApplyPage, { ApplyEmbedPage } from "./pages/recruitment/ApplyPage";
import ApplicationFormPage from "./pages/recruitment/ApplicationFormPage";
import RecruitmentPipeline from "./pages/crm/RecruitmentPipeline";
import RecruitmentProspectDetail from "./pages/crm/RecruitmentProspectDetail";
import { useAuth } from "./_core/hooks/useAuth";
import { trpc } from "./lib/trpc";
import { Loader2 } from "lucide-react";

// ── Onboarding gate — blocks all agent routes until admin activates portal access ──
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [location, navigate] = useLocation();

  // Only gate pure agent accounts (not admins in agent-view)
  const allowedOnboardingPaths = ["/onboarding", "/dd-setup", "/dd-complete"];
  if (user?.role === "agent" && (user as any).portalStatus === "onboarding" && !allowedOnboardingPaths.includes(location)) {
    // Redirect to onboarding — use replace so back-button doesn't loop
    if (typeof window !== "undefined") {
      navigate("/onboarding", { replace: true });
    }
    return null;
  }
  return <>{children}</>;
}

// ── Suspended portal guard ──────────────────────────────────────────────────
function SuspendedGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { data } = trpc.crm.agentCrm.getMyProfile.useQuery(undefined, {
    enabled: !!user && user.role === "agent",
    staleTime: 60_000,
  });
  if (data?.profile?.agentStatus === "suspended") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Account Suspended</h1>
          <p className="text-muted-foreground">Your portal access has been temporarily suspended. Please contact the JLT Memberships team to resolve this.</p>
          <a
            href="mailto:memberships@thejltgroup.co.uk"
            className="inline-flex items-center justify-center px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity"
          >
            Contact Memberships
          </a>
          <p className="text-xs text-muted-foreground">memberships@thejltgroup.co.uk</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

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
        {/* Public payment pages — no auth required */}
        <Route path="/payment/result" component={PaymentResult} />
        <Route path="/pay/:token" component={PaymentRedirect} />
        {/* Public recruitment pages — MUST be before /apply/:prospectId to avoid route conflict */}
        <Route path="/apply" component={ApplyPage} />
        <Route path="/apply/embed" component={ApplyEmbedPage} />
        <Route path="/apply/form" component={ApplicationFormPage} />
        {/* Public CRM pages — no auth required */}
        <Route path="/enquiry" component={EnquiryForm} />
        <Route path="/apply/:prospectId" component={AgentApplicationForm} />
        <Route path="/sign-contract/:token" component={SignContract} />
        <Route path="/membership" component={MembershipSelection} />
        <Route path="/membership/success" component={MembershipSuccess} />
        <Route path="/register" component={RegisterPage} />
        {/* Public join / sign-up flow */}
        <Route path="/join" component={JoinFlow} />
        <Route path="/join/complete" component={JoinFlow} />
        <Route path="/join/accept" component={JoinAccept} />
        {/* Public terms & policies — no auth required */}
        <Route path="/terms" component={TermsAndPolicies} />
        {/* Public unsubscribe page — no auth required */}
        <Route path="/unsubscribe" component={UnsubscribePage} />
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
      <SuspendedGuard>
      <PortalLayout>
        <OnboardingGate>
        <Switch>
          {/* Public join flow — accessible even when logged in */}
          <Route path="/join" component={JoinFlow} />
          <Route path="/join/complete" component={JoinFlow} />
          <Route path="/join/accept" component={JoinAccept} />
          <Route path="/onboarding" component={OnboardingDashboard} />
          <Route path="/dd-setup" component={DdSetup} />
          <Route path="/dd-complete" component={DdComplete} />
          <Route path="/" component={AgentDashboard} />
          <Route path="/dashboard" component={AgentDashboard} />
          <Route path="/bookings/new" component={RegisterBooking} />
          <Route path="/bookings/:id">{(params) => <AgentBookingDetail key={params.id} />}</Route>
          <Route path="/bookings/:id/amend">{(params) => <AmendmentForm key={params.id} />}</Route>
          <Route path="/bookings/:id/cancel">{(params) => <CancellationForm key={params.id} />}</Route>
          <Route path="/bookings/:id/refund">{(params) => <RefundForm key={params.id} />}</Route>
          <Route path="/commissions" component={AgentCommissions} />
          <Route path="/commission-timeline" component={CommissionTimeline} />
          <Route path="/cancel-booking" component={AgentCancelBooking} />
          <Route path="/request-amendment" component={AgentRequestAmendment} />
          <Route path="/flight-requests" component={AgentFlightRequests} />
          <Route path="/booking-documents" component={BookingDocuments} />
          <Route path="/notifications" component={AgentNotifications} />
          <Route path="/my-profile" component={MyProfile} />
          <Route path="/profile" component={ProfilePage} />
          <Route path="/unsubscribe" component={UnsubscribePage} />
          <Route component={NotFound} />
        </Switch>
        </OnboardingGate>
      </PortalLayout>
      </SuspendedGuard>
    );
  }

  // Admin / Super Admin — switch between admin view and agent view
  if (isAdminUser && isAgentView) {
    return (
      <PortalLayout>
        <Switch>
          {/* Public join flow */}
          <Route path="/join" component={JoinFlow} />
          <Route path="/join/complete" component={JoinFlow} />
          <Route path="/join/accept" component={JoinAccept} />
          <Route path="/" component={AgentDashboard} />
          <Route path="/dashboard" component={AgentDashboard} />
          <Route path="/bookings/new" component={RegisterBooking} />
          {/* Agent booking detail — but admin still sees admin detail for pipeline management */}
          <Route path="/bookings/:id">{(params) => <AgentBookingDetail key={params.id} />}</Route>
          <Route path="/bookings/:id/amend">{(params) => <AmendmentForm key={params.id} />}</Route>
          <Route path="/bookings/:id/cancel">{(params) => <CancellationForm key={params.id} />}</Route>
          <Route path="/bookings/:id/refund">{(params) => <RefundForm key={params.id} />}</Route>
          <Route path="/commissions" component={AgentCommissions} />
          <Route path="/commission-timeline" component={CommissionTimeline} />
          <Route path="/cancel-booking" component={AgentCancelBooking} />
          <Route path="/request-amendment" component={AgentRequestAmendment} />
           <Route path="/flight-requests" component={AgentFlightRequests} />
          <Route path="/booking-documents" component={BookingDocuments} />
          <Route path="/notifications" component={AgentNotifications} />
          <Route path="/my-profile" component={MyProfile} />
          <Route path="/profile" component={ProfilePage} />
          <Route path="/unsubscribe" component={UnsubscribePage} />
          <Route component={NotFound} />
        </Switch>
      </PortalLayout>
    );
  }
  // Admin / Super Admin — default admin view
  return (
    <PortalLayout>
      <Switch>
        {/* Public join flow */}
        <Route path="/join" component={JoinFlow} />
        <Route path="/join/complete" component={JoinFlow} />
        <Route path="/join/accept" component={JoinAccept} />
        <Route path="/" component={AdminDashboard} />
        <Route path="/dashboard" component={AdminDashboard} />
        <Route path="/pipeline" component={AdminKanban} />
        <Route path="/bookings/:id">{(params) => <AdminBookingDetail key={params.id} />}</Route>
        <Route path="/users" component={AdminUsers} />
        <Route path="/amendments" component={AdminAmendments} />
        <Route path="/amendments/pipeline" component={AdminAmendmentKanban} />
        <Route path="/refunds" component={AdminRefunds} />
        <Route path="/refunds/pipeline" component={AdminRefundKanban} />
        <Route path="/commission-due" component={CommissionDue} />
        <Route path="/commissions-admin" component={AdminCommissions} />
        <Route path="/remittance" component={RemittanceManagement} />
        <Route path="/flights" component={AdminFlightsPipeline} />
        <Route path="/reports" component={AdminReports} />
        <Route path="/agent-performance" component={AdminAgentPerformance} />
        <Route path="/notification-templates" component={NotificationTemplates} />
        <Route path="/import" component={AdminImport} />
        <Route path="/pts-missing-payment" component={PtsMissingPaymentDate} />
        <Route path="/commission-claimable-missing-payment" component={CommissionClaimableMissingPaymentDate} />
        <Route path="/messages" component={AdminMessages} />
        <Route path="/notif-prefs" component={AdminNotifPrefs} />
        <Route path="/admin/tasks" component={AdminTasks} />
        <Route path="/admin/calendar" component={AdminCalendar} />
        <Route path="/admin/reimbursements" component={AdminReimbursements} />
        <Route path="/booking-documents" component={BookingDocuments} />
        <Route path="/admin/inbox-config" component={AdminInboxConfig} />
        <Route path="/admin/inbox-audit" component={AdminInboxAudit} />
        <Route path="/admin/agent-email-log" component={AgentEmailLog} />
        {/* CRM Routes */}
        <Route path="/crm/pipeline" component={CrmPipeline} />
        <Route path="/crm/prospects" component={CrmProspects} />
        <Route path="/crm/prospects/:id" component={ProspectDetail} />
        <Route path="/crm/campaigns" component={CrmCampaigns} />
        <Route path="/crm/email-marketing" component={EmailMarketing} />
        <Route path="/crm/remittances" component={CrmRemittances} />
        <Route path="/crm/payment-config" component={CrmPaymentConfig} />
        <Route path="/crm/agents" component={AgentCrm} />
        <Route path="/crm/agents/:userId/contract-evidence" component={ContractEvidenceViewer} />
        <Route path="/crm/join-sessions" component={JoinSessions} />
        <Route path="/crm/abandoned-signups" component={AbandonedSignups} />
        <Route path="/crm/change-requests" component={CrmChangeRequests} />
        <Route path="/crm/memberships" component={Memberships} />
        {/* Recruitment Pipeline */}
        <Route path="/crm/recruitment" component={RecruitmentPipeline} />
        <Route path="/crm/recruitment/:id" component={RecruitmentProspectDetail} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/unsubscribe" component={UnsubscribePage} />
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
