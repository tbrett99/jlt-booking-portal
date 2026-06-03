import { Toaster } from "@/components/ui/sonner";
import { lazy, Suspense } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ViewModeProvider, useViewMode } from "./contexts/ViewModeContext";
import PortalLayout from "./components/PortalLayout";

// Critical path — always bundled
import LoginPage from "./pages/LoginPage";
import OAuthLoginPage from "./pages/OAuthLoginPage";
import RegisterPage from "./pages/RegisterPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import UnsubscribePage from "./pages/UnsubscribePage";
import PaymentResult from "./pages/PaymentResult";
import PaymentRedirect from "./pages/PaymentRedirect";
import JoinFlow from "./pages/JoinFlow";
import JoinAccept from "./pages/JoinAccept";
import ApplyPage, { ApplyEmbedPage } from "./pages/recruitment/ApplyPage";
import ApplicationFormPage from "./pages/recruitment/ApplicationFormPage";
import InfoFunnelPage from "./pages/InfoFunnelPage";

// Lazy-loaded pages (split into separate chunks)
const AgentDashboard = lazy(() => import("./pages/agent/AgentDashboard"));
const RegisterBooking = lazy(() => import("./pages/agent/RegisterBooking"));
const AgentBookingDetail = lazy(() => import("./pages/agent/AgentBookingDetail"));
const AmendmentForm = lazy(() => import("./pages/agent/AmendmentForm"));
const CancellationForm = lazy(() => import("./pages/agent/CancellationForm"));
const RefundForm = lazy(() => import("./pages/agent/RefundForm"));
const AgentCommissions = lazy(() => import("./pages/agent/AgentCommissions"));
const CommissionTimeline = lazy(() => import("./pages/agent/CommissionTimeline"));
const AgentCancelBooking = lazy(() => import("./pages/agent/AgentCancelBooking"));
const AgentRequestAmendment = lazy(() => import("./pages/agent/AgentRequestAmendment"));
const AgentFlightRequests = lazy(() => import("./pages/agent/AgentFlightRequests"));
const AgentNotifications = lazy(() => import("./pages/agent/AgentNotifications"));
const OnboardingDashboard = lazy(() => import("./pages/agent/OnboardingDashboard"));
const DdSetup = lazy(() => import("./pages/agent/DdSetup"));
const DdComplete = lazy(() => import("./pages/agent/DdComplete"));
const PackagePricingCalculator = lazy(() => import("./pages/agent/PackagePricingCalculator"));
const MyMarginReport = lazy(() => import("./pages/agent/MyMarginReport"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminKanban = lazy(() => import("./pages/admin/AdminKanban"));
const AdminBookingDetail = lazy(() => import("./pages/admin/AdminBookingDetail"));
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers"));
const AdminAmendments = lazy(() => import("./pages/admin/AdminAmendments"));
const AdminRefunds = lazy(() => import("./pages/admin/AdminRefunds"));
const AdminAmendmentKanban = lazy(() => import("./pages/admin/AdminAmendmentKanban"));
const AdminRefundKanban = lazy(() => import("./pages/admin/AdminRefundKanban"));
const CommissionDue = lazy(() => import("./pages/admin/CommissionDue"));
const AdminReports = lazy(() => import("./pages/admin/AdminReports"));
const CommissionMarginReport = lazy(() => import("./pages/admin/CommissionMarginReport"));
const NotificationTemplates = lazy(() => import("./pages/admin/NotificationTemplates"));
const AdminFlightsPipeline = lazy(() => import("./pages/admin/AdminFlightsPipeline"));
const AdminCommissions = lazy(() => import("./pages/admin/AdminCommissions"));
const RemittanceManagement = lazy(() => import("./pages/admin/RemittanceManagement"));
const AdminImport = lazy(() => import("./pages/admin/AdminImport"));
const AdminAgentPerformance = lazy(() => import("./pages/admin/AdminAgentPerformance"));
const AdminMessages = lazy(() => import("./pages/admin/AdminMessages"));
const PtsMissingPaymentDate = lazy(() => import("./pages/admin/PtsMissingPaymentDate"));
const CommissionClaimableMissingPaymentDate = lazy(() => import("./pages/admin/CommissionClaimableMissingPaymentDate"));
const AdminNotifPrefs = lazy(() => import("./pages/admin/AdminNotifPrefs"));
const AdminTasks = lazy(() => import("./pages/admin/AdminTasks"));
const AdminCalendar = lazy(() => import("./pages/admin/AdminCalendar"));
const AdminReimbursements = lazy(() => import("./pages/admin/AdminReimbursements"));
const AdminInboxConfig = lazy(() => import("./pages/admin/AdminInboxConfig"));
const AdminApiKeys = lazy(() => import("./pages/admin/AdminApiKeys"));
const AdminOAuthClients = lazy(() => import("./pages/admin/AdminOAuthClients"));
const AdminInboxAudit = lazy(() => import("./pages/admin/AdminInboxAudit"));
const AgentEmailLog = lazy(() => import("./pages/admin/AgentEmailLog"));
const AbandonedSignups = lazy(() => import("./pages/admin/AbandonedSignups"));
const AdminTermsTracker = lazy(() => import("./pages/admin/AdminTermsTracker"));
const CrmPipeline = lazy(() => import("./pages/crm/CrmPipeline"));
const CrmProspects = lazy(() => import("./pages/crm/CrmProspects"));
const ProspectDetail = lazy(() => import("./pages/crm/ProspectDetail"));
const CrmCampaigns = lazy(() => import("./pages/crm/CrmCampaigns"));
const EmailMarketing = lazy(() => import("./pages/crm/EmailMarketing"));
const CrmRemittances = lazy(() => import("./pages/crm/CrmRemittances"));
const CrmPaymentConfig = lazy(() => import("./pages/crm/CrmPaymentConfig"));
const EnquiryForm = lazy(() => import("./pages/crm/EnquiryForm"));
const AgentApplicationForm = lazy(() => import("./pages/crm/AgentApplicationForm"));
const SignContract = lazy(() => import("./pages/crm/SignContract"));
const MembershipSelection = lazy(() => import("./pages/crm/MembershipSelection"));
const WonAgentPortal = lazy(() => import("./pages/crm/WonAgentPortal"));
const MembershipSuccess = lazy(() => import("./pages/crm/MembershipSuccess"));
const AgentCrm = lazy(() => import("./pages/crm/AgentCrm"));
const OrbitAccess = lazy(() => import("./pages/crm/OrbitAccess"));
const ContractEvidenceViewer = lazy(() => import("./pages/crm/ContractEvidenceViewer"));
const JoinSessions = lazy(() => import("./pages/crm/JoinSessions"));
const CrmChangeRequests = lazy(() => import("./pages/crm/CrmChangeRequests"));
const Memberships = lazy(() => import("./pages/crm/Memberships"));
const RecruitmentPipeline = lazy(() => import("./pages/crm/RecruitmentPipeline"));
const WorkflowBuilder = lazy(() => import("./pages/crm/WorkflowBuilder"));
const RecruitmentProspectDetail = lazy(() => import("./pages/crm/RecruitmentProspectDetail"));
const RecruitmentDashboard = lazy(() => import("./pages/crm/RecruitmentDashboard"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const BookingDocuments = lazy(() => import("./pages/BookingDocuments"));
const MyProfile = lazy(() => import("./pages/MyProfile"));
const TermsAndPolicies = lazy(() => import("./pages/TermsAndPolicies"));
const SupplierDirectory = lazy(() => import("./pages/SupplierDirectory"));
const AdminSuppliers = lazy(() => import("./pages/admin/AdminSuppliers"));
const SystemWorkflows = lazy(() => import("./pages/admin/SystemWorkflows"));
const Community = lazy(() => import("./pages/Community"));
const AgentCalendar = lazy(() => import("./pages/AgentCalendar"));
const WeeklyDigestAdmin = lazy(() => import("./pages/community/WeeklyDigestAdmin"));
const SuperAdminDashboard = lazy(() => import("./pages/admin/SuperAdminDashboard"));
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
        {/* Dedicated OAuth login page — shown when /api/oauth2/authorize redirects unauthenticated users */}
        <Route path="/oauth2/login" component={OAuthLoginPage} />
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
        <Route path="/info" component={InfoFunnelPage} />
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
          <Route path="/suppliers" component={SupplierDirectory} />
          <Route path="/pricing-calculator" component={PackagePricingCalculator} />
          <Route path="/my-margin" component={MyMarginReport} />
          <Route path="/community" component={Community} />
          <Route path="/events" component={AgentCalendar} />
          {/* Terms & Policies — accessible to logged-in agents */}
          <Route path="/terms" component={TermsAndPolicies} />
          {/* Public recruitment pages — accessible even when logged in */}
          <Route path="/apply" component={ApplyPage} />
          <Route path="/apply/embed" component={ApplyEmbedPage} />
          <Route path="/apply/form" component={ApplicationFormPage} />
          <Route path="/apply/:prospectId" component={AgentApplicationForm} />
          {/* Public funnel page — accessible even when logged in */}
          <Route path="/info" component={InfoFunnelPage} />
          {/* OAuth login page — auto-redirects logged-in users back to authorize */}
          <Route path="/oauth2/login" component={OAuthLoginPage} />
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
          <Route path="/suppliers" component={SupplierDirectory} />
          <Route path="/pricing-calculator" component={PackagePricingCalculator} />
          <Route path="/my-margin" component={MyMarginReport} />
          <Route path="/community" component={Community} />
          <Route path="/events" component={AgentCalendar} />
          {/* Terms & Policies — accessible to admins in agent view */}
          <Route path="/terms" component={TermsAndPolicies} />
          {/* Public recruitment pages — accessible even when logged in */}
          <Route path="/apply" component={ApplyPage} />
          <Route path="/apply/embed" component={ApplyEmbedPage} />
          <Route path="/apply/form" component={ApplicationFormPage} />
          <Route path="/apply/:prospectId" component={AgentApplicationForm} />
          {/* Public funnel page — accessible even when logged in */}
          <Route path="/info" component={InfoFunnelPage} />
          {/* OAuth login page — auto-redirects logged-in users back to authorize */}
          <Route path="/oauth2/login" component={OAuthLoginPage} />
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
        <Route path="/super-admin" component={SuperAdminDashboard} />
        <Route path="/reports" component={AdminReports} />
        <Route path="/commission-margin" component={CommissionMarginReport} />
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
        <Route path="/admin/api-keys" component={AdminApiKeys} />
        <Route path="/admin/oauth-clients" component={AdminOAuthClients} />
        <Route path="/admin/terms-tracker" component={AdminTermsTracker} />
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
        <Route path="/crm/orbit-access" component={OrbitAccess} />
        <Route path="/crm/join-sessions" component={JoinSessions} />
        <Route path="/crm/abandoned-signups" component={AbandonedSignups} />
        <Route path="/crm/change-requests" component={CrmChangeRequests} />
        <Route path="/crm/memberships" component={Memberships} />
        {/* Recruitment Pipeline */}
        <Route path="/crm/recruitment/dashboard" component={RecruitmentDashboard} />
        <Route path="/crm/recruitment" component={RecruitmentPipeline} />
        <Route path="/crm/recruitment/:id" component={RecruitmentProspectDetail} />
        <Route path="/crm/workflows" component={WorkflowBuilder} />
        {/* Supplier Directory */}
        <Route path="/suppliers" component={SupplierDirectory} />
        <Route path="/admin/suppliers" component={AdminSuppliers} />
        <Route path="/admin/system-workflows" component={SystemWorkflows} />
        <Route path="/community" component={Community} />
        <Route path="/admin/weekly-digest" component={WeeklyDigestAdmin} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/unsubscribe" component={UnsubscribePage} />
        {/* Terms & Policies — accessible to logged-in admins */}
        <Route path="/terms" component={TermsAndPolicies} />
        {/* Public recruitment pages — accessible even when logged in */}
        <Route path="/apply" component={ApplyPage} />
        <Route path="/apply/embed" component={ApplyEmbedPage} />
        <Route path="/apply/form" component={ApplicationFormPage} />
        <Route path="/apply/:prospectId" component={AgentApplicationForm} />
        {/* Public funnel page — accessible even when logged in */}
        <Route path="/info" component={InfoFunnelPage} />
        {/* OAuth login page — auto-redirects logged-in users back to authorize */}
        <Route path="/oauth2/login" component={OAuthLoginPage} />
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
            <Suspense fallback={
              <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "#70FFE8" }}>
                    <svg className="animate-spin text-[#414141] w-6 h-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </div>
                  <p className="text-muted-foreground text-sm">Loading...</p>
                </div>
              </div>
            }>
              <AuthRouter />
            </Suspense>
          </TooltipProvider>
        </ViewModeProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
