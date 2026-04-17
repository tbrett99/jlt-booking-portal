import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

/**
 * /payment/result
 *
 * Public page — PPS redirects the customer here after they complete (or fail) payment.
 * PPS appends query params: responseCode, responseMessage, transactionID, etc.
 * We read responseCode: "0" = success, anything else = failure.
 *
 * Note: The authoritative update happens via the server-to-server callback (/api/pps/callback).
 * This page is purely for the customer-facing experience.
 */
export default function PaymentResult() {
  const [, navigate] = useLocation();
  const [result, setResult] = useState<"success" | "failed" | "pending">("pending");
  const [message, setMessage] = useState("");
  const [transactionId, setTransactionId] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const responseCode = params.get("responseCode") ?? params.get("responsecode") ?? "";
    const responseMessage = params.get("responseMessage") ?? params.get("responsemessage") ?? "";
    const txId = params.get("transactionID") ?? params.get("xref") ?? "";

    setTransactionId(txId);

    if (responseCode === "0") {
      setResult("success");
      setMessage(responseMessage || "Your payment has been processed successfully.");
    } else if (responseCode) {
      setResult("failed");
      setMessage(responseMessage || "Your payment could not be processed. Please try again or contact us.");
    } else {
      // No params — user navigated directly or PPS didn't append params
      setResult("pending");
      setMessage("We are confirming your payment status. Please check your email for confirmation.");
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#F0FFFB] to-[#E8F8F5]">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center space-y-6">
          {/* JLT branding */}
          <div className="flex flex-col items-center gap-1">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ background: "#70FFE8" }}
            >
              <span className="font-bold text-[#414141] text-lg">JLT</span>
            </div>
            <p className="text-xs text-gray-400">The JLT Group</p>
          </div>

          {/* Result icon */}
          {result === "success" && (
            <div className="flex flex-col items-center gap-3">
              <CheckCircle2 className="text-emerald-500" size={56} />
              <h1 className="text-2xl font-bold text-[#414141]">Payment Successful</h1>
            </div>
          )}
          {result === "failed" && (
            <div className="flex flex-col items-center gap-3">
              <XCircle className="text-red-500" size={56} />
              <h1 className="text-2xl font-bold text-[#414141]">Payment Failed</h1>
            </div>
          )}
          {result === "pending" && (
            <div className="flex flex-col items-center gap-3">
              <Clock className="text-amber-500" size={56} />
              <h1 className="text-2xl font-bold text-[#414141]">Payment Pending</h1>
            </div>
          )}

          {/* Message */}
          <p className="text-sm text-gray-600">{message}</p>

          {/* Transaction ID */}
          {transactionId && (
            <div className="bg-gray-50 rounded-lg px-4 py-3 text-left">
              <p className="text-xs text-gray-400 mb-1">Transaction Reference</p>
              <p className="text-sm font-mono text-[#414141] break-all">{transactionId}</p>
            </div>
          )}

          {/* Confirmation note */}
          {result === "success" && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
              <p className="text-xs text-emerald-700">
                A confirmation has been sent to your travel agent. Please keep your transaction reference for your records.
              </p>
            </div>
          )}

          {result === "failed" && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-xs text-red-700">
                If you believe this is an error, please contact The JLT Group quoting your transaction reference.
              </p>
            </div>
          )}

          {/* Contact */}
          <p className="text-xs text-gray-400">
            Questions?{" "}
            <a
              href="mailto:support@thejltgroup.co.uk"
              className="text-[#02E6D2] hover:underline"
            >
              support@thejltgroup.co.uk
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
