import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2, ShieldCheck, AlertTriangle } from "lucide-react";

/**
 * /pay/:token
 *
 * Public page — no login required.
 * Fetches the signed PPS form fields from the server and auto-submits them
 * to the PPS hosted payment page. The customer never sees raw form fields.
 */
export default function PaymentRedirect() {
  const [, params] = useRoute("/pay/:token");
  const token = params?.token ?? "";
  const formRef = useRef<HTMLFormElement>(null);
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading, error } = trpc.payments.getPublicLink.useQuery(
    { linkId: token },
    { enabled: !!token, retry: false }
  );

  useEffect(() => {
    if (data && formRef.current && !submitted) {
      setSubmitted(true);
      // Small delay so the user sees the "Redirecting to secure payment" message
      setTimeout(() => {
        formRef.current?.submit();
      }, 1200);
    }
  }, [data, submitted]);

  if (!token) {
    return <ErrorState message="Invalid payment link." />;
  }

  if (isLoading) {
    return <LoadingState message="Loading payment details…" />;
  }

  if (error || !data) {
    const msg =
      error?.message === "LINK_NOT_FOUND"
        ? "This payment link does not exist or has expired."
        : error?.message === "LINK_CANCELLED"
          ? "This payment link has been cancelled."
          : error?.message === "LINK_ALREADY_PAID"
            ? "This payment has already been completed."
            : "This payment link is no longer available.";
    return <ErrorState message={msg} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#F0FFFB] to-[#E8F8F5]">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center space-y-6">
          {/* JLT Branding */}
          <div className="flex flex-col items-center gap-2">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ background: "#70FFE8" }}
            >
              <ShieldCheck className="text-[#414141]" size={28} />
            </div>
            <h1 className="text-xl font-bold text-[#414141]">The JLT Group</h1>
            <p className="text-sm text-gray-500">Secure Payment Portal</p>
          </div>

          {/* Payment details */}
          <div className="bg-gray-50 rounded-xl p-4 text-left space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Booking</span>
              <span className="font-medium text-[#414141]">{data.clientName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Reference</span>
              <span className="font-medium text-[#414141]">{data.orderRef}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Amount</span>
              <span className="font-bold text-lg text-[#414141]">
                £{(data.amountPence / 100).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Redirecting indicator */}
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="animate-spin text-[#02E6D2]" size={28} />
            <p className="text-sm text-gray-600">
              Redirecting you to our secure payment page…
            </p>
            <p className="text-xs text-gray-400">
              Powered by Protected Payment Services
            </p>
          </div>
        </div>
      </div>

      {/* Hidden auto-submit form */}
      {data && (
        <form
          ref={formRef}
          method="POST"
          action={data.gatewayUrl}
          style={{ display: "none" }}
        >
          {Object.entries(data.formFields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value as string} />
          ))}
        </form>
      )}
    </div>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#F0FFFB] to-[#E8F8F5]">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="animate-spin text-[#02E6D2]" size={36} />
        <p className="text-gray-600 text-sm">{message}</p>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#F0FFFB] to-[#E8F8F5]">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center space-y-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
            style={{ background: "#FFC3BC" }}
          >
            <AlertTriangle className="text-red-700" size={28} />
          </div>
          <h2 className="text-lg font-bold text-[#414141]">Payment Link Unavailable</h2>
          <p className="text-sm text-gray-600">{message}</p>
          <p className="text-xs text-gray-400">
            Please contact The JLT Group if you believe this is an error.
          </p>
        </div>
      </div>
    </div>
  );
}
