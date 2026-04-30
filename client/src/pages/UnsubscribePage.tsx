import { useEffect, useState } from "react";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export default function UnsubscribePage() {
  const [state, setState] = useState<"loading" | "success" | "error" | "invalid">("loading");
  const [email, setEmail] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success");
    const error = params.get("error");
    const emailParam = params.get("email");

    if (success === "1") {
      setState("success");
      setEmail(emailParam ? decodeURIComponent(emailParam) : "");
    } else if (error === "invalid") {
      setState("invalid");
    } else if (error === "server") {
      setState("error");
    } else {
      // No params — might be a direct visit, show generic message
      setState("invalid");
    }
  }, []);

  return (
    <div
      style={{ fontFamily: "'Poppins', Arial, sans-serif" }}
      className="min-h-screen flex flex-col items-center justify-center bg-[#f5f5f5] px-4"
    >
      {/* Header */}
      <div className="mb-8 text-center">
        <div
          className="inline-flex items-center justify-center px-6 py-3 rounded-xl mb-4"
          style={{ backgroundColor: "#70FFE8" }}
        >
          <span className="text-xl font-bold" style={{ color: "#414141" }}>
            JLT Group
          </span>
        </div>
      </div>

      {/* Card */}
      <div className="bg-white rounded-2xl shadow-md p-10 max-w-md w-full text-center">
        {state === "loading" && (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-[#02E6D2]" />
            <p className="text-[#414141] font-medium">Processing your request…</p>
          </div>
        )}

        {state === "success" && (
          <div className="flex flex-col items-center gap-4">
            <CheckCircle className="h-12 w-12 text-[#02E6D2]" />
            <h1 className="text-xl font-bold text-[#414141]">You've been unsubscribed</h1>
            <p className="text-sm text-gray-500 leading-relaxed">
              {email ? (
                <>
                  <strong>{email}</strong> has been removed from our mailing list.
                </>
              ) : (
                "You have been successfully removed from our mailing list."
              )}
              <br />
              You won't receive any further marketing emails from us.
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Changed your mind?{" "}
              <a
                href="mailto:jointheteam@thejltgroup.co.uk"
                className="underline"
                style={{ color: "#02E6D2" }}
              >
                Contact us
              </a>{" "}
              to re-subscribe.
            </p>
          </div>
        )}

        {state === "invalid" && (
          <div className="flex flex-col items-center gap-4">
            <XCircle className="h-12 w-12 text-gray-300" />
            <h1 className="text-xl font-bold text-[#414141]">Invalid link</h1>
            <p className="text-sm text-gray-500 leading-relaxed">
              This unsubscribe link is invalid or has already been used.
              <br />
              If you'd like to unsubscribe, please{" "}
              <a
                href="mailto:jointheteam@thejltgroup.co.uk"
                className="underline"
                style={{ color: "#02E6D2" }}
              >
                contact us directly
              </a>
              .
            </p>
          </div>
        )}

        {state === "error" && (
          <div className="flex flex-col items-center gap-4">
            <XCircle className="h-12 w-12 text-red-400" />
            <h1 className="text-xl font-bold text-[#414141]">Something went wrong</h1>
            <p className="text-sm text-gray-500 leading-relaxed">
              We couldn't process your unsubscribe request. Please try again or{" "}
              <a
                href="mailto:jointheteam@thejltgroup.co.uk"
                className="underline"
                style={{ color: "#02E6D2" }}
              >
                contact us
              </a>
              .
            </p>
          </div>
        )}
      </div>

      <p className="mt-8 text-xs text-gray-400">
        &copy; {new Date().getFullYear()} JLT Group. All rights reserved.
      </p>
    </div>
  );
}
