import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ViewModeProvider } from "./contexts/ViewModeContext";
import ConsumerSite from "./pages/consumer/ConsumerSite";

/**
 * Public-site provider tree shared by the browser and the SSR entry.
 * It deliberately excludes private portal authentication and route components.
 */
export default function ConsumerSiteShell() {
  return (
    <ThemeProvider defaultTheme="light">
      <ViewModeProvider>
        <TooltipProvider>
          <Toaster />
          <ConsumerSite />
        </TooltipProvider>
      </ViewModeProvider>
    </ThemeProvider>
  );
}
