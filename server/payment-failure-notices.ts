export type PaymentFailureNotice = {
  failureCount: number;
  subject: string;
  html: string;
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Returns the current, actionable notice for a Direct Debit failure streak.
 * Earlier warnings are intentionally not replayed after a missed webhook: an
 * agent should receive the most urgent current status, not a confusing burst
 * of historic emails.
 */
export function buildPaymentFailureNotice(input: {
  failureCount: number;
  agentName: string;
  action?: "failed" | "charged_back";
  reason?: string | null;
}): PaymentFailureNotice {
  const failureCount = Math.max(1, Math.floor(input.failureCount));
  const agentName = escapeHtml(input.agentName || "there");
  const reason = input.reason
    ? `<p style="color:#6b7280;font-size:14px;margin:0 0 16px;"><strong>Reason:</strong> ${escapeHtml(input.reason)}</p>`
    : "";
  const wasChargedBack = input.action === "charged_back";

  if (failureCount >= 3) {
    return {
      failureCount,
      subject: "⚠️ Portal Access Suspended — Membership Payment Failed (3rd Attempt)",
      html: `<div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);"><div style="background:#fee2e2;padding:28px 32px;"><h1 style="margin:0;font-size:22px;font-weight:700;color:#991b1b;">JLT Group</h1><p style="margin:4px 0 0;font-size:13px;color:#991b1b;opacity:0.8;">Membership Payment Failed — Portal Access Suspended</p></div><div style="padding:32px;"><p style="color:#414141;margin:0 0 16px;">Hi ${agentName},</p><p style="color:#414141;margin:0 0 16px;">Your JLT Group membership Direct Debit payment was <strong>unsuccessful for the third consecutive time</strong>.</p>${reason}<div style="background:#fee2e2;border-left:4px solid #dc2626;padding:16px;border-radius:4px;margin:0 0 20px;"><p style="margin:0;color:#991b1b;font-weight:700;font-size:15px;">⚠️ Your portal access has been temporarily suspended</p><p style="margin:8px 0 0;color:#991b1b;font-size:14px;">Due to 3 consecutive failed payments, your access to the JLT Group portal has been suspended until this is resolved.</p></div><div style="background:#fff7ed;border-left:4px solid #f97316;padding:16px;border-radius:4px;margin:0 0 20px;"><p style="margin:0;color:#9a3412;font-weight:700;font-size:14px;">Admin Charge Notice</p><p style="margin:8px 0 0;color:#9a3412;font-size:14px;">As per the terms of your membership contract with JLT Group, a <strong>£25 administration charge has been applied</strong> due to multiple failed payments. This will be collected once your payment details are updated.</p></div><p style="color:#414141;margin:0 0 16px;">To reinstate your portal access, please contact us <strong>immediately</strong> so we can resolve your payment and restore your account.</p><p style="color:#6b7280;font-size:13px;margin:0;">Contact us at <a href="mailto:memberships@thejltgroup.co.uk" style="color:#02E6D2;">memberships@thejltgroup.co.uk</a></p></div></div>`,
    };
  }

  if (failureCount === 2) {
    return {
      failureCount,
      subject: "⚠️ Second Warning: Membership Payment Failed — Action Required",
      html: `<div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);"><div style="background:#fff7ed;padding:28px 32px;"><h1 style="margin:0;font-size:22px;font-weight:700;color:#9a3412;">JLT Group</h1><p style="margin:4px 0 0;font-size:13px;color:#9a3412;opacity:0.85;">Membership Payment Failed — Second Warning</p></div><div style="padding:32px;"><p style="color:#414141;margin:0 0 16px;">Hi ${agentName},</p><p style="color:#414141;margin:0 0 16px;">Your JLT Group membership Direct Debit payment has <strong>failed for the second consecutive time</strong>.</p>${reason}<div style="background:#fff7ed;border-left:4px solid #f97316;padding:16px;border-radius:4px;margin:0 0 20px;"><p style="margin:0;color:#9a3412;font-weight:700;font-size:15px;">⚠️ Urgent: One more failure will suspend your access</p><p style="margin:8px 0 0;color:#9a3412;font-size:14px;">If your next payment also fails, your portal access will be <strong>temporarily suspended</strong>. Please ensure sufficient funds are available before the next retry.</p></div><div style="background:#fff7ed;border-left:4px solid #f97316;padding:16px;border-radius:4px;margin:0 0 20px;"><p style="margin:0;color:#9a3412;font-weight:700;font-size:14px;">Admin Charge Notice</p><p style="margin:8px 0 0;color:#9a3412;font-size:14px;">As per the terms of your membership contract with JLT Group, a <strong>£25 administration charge will be applied</strong> due to multiple failed payments. This will be collected via Direct Debit.</p></div><p style="color:#414141;margin:0 0 16px;">If you need to update your bank details or discuss your payment, please contact us as soon as possible.</p><p style="color:#6b7280;font-size:13px;margin:0;">Contact us at <a href="mailto:memberships@thejltgroup.co.uk" style="color:#02E6D2;">memberships@thejltgroup.co.uk</a></p></div></div>`,
    };
  }

  return {
    failureCount: 1,
    subject: `Action Required: Membership Payment ${wasChargedBack ? "Charged Back" : "Failed"}`,
    html: `<div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);"><div style="background:#fef9c3;padding:28px 32px;"><h1 style="margin:0;font-size:22px;font-weight:700;color:#854d0e;">JLT Group</h1><p style="margin:4px 0 0;font-size:13px;color:#854d0e;opacity:0.85;">Membership Payment ${wasChargedBack ? "Charged Back" : "Failed"}</p></div><div style="padding:32px;"><p style="color:#414141;margin:0 0 16px;">Hi ${agentName},</p><p style="color:#414141;margin:0 0 16px;">Your JLT Group membership Direct Debit payment was <strong>${wasChargedBack ? "charged back" : "unsuccessful"}</strong>.</p>${reason}<p style="color:#414141;margin:0 0 16px;">Your payment will be retried automatically. Please ensure <strong>sufficient funds are available</strong> in your account before the next retry.</p><div style="background:#fef9c3;border-left:4px solid #ca8a04;padding:16px;border-radius:4px;margin:0 0 20px;"><p style="margin:0;color:#854d0e;font-weight:700;font-size:14px;">Please note</p><p style="margin:8px 0 0;color:#854d0e;font-size:14px;">If 3 consecutive payments fail, your portal access will be temporarily suspended. This is failure <strong>1 of 3</strong>.</p></div><p style="color:#414141;margin:0 0 16px;">If you need to update your bank details or discuss your payment, please contact us.</p><p style="color:#6b7280;font-size:13px;margin:0;">Contact us at <a href="mailto:memberships@thejltgroup.co.uk" style="color:#02E6D2;">memberships@thejltgroup.co.uk</a></p></div></div>`,
  };
}
