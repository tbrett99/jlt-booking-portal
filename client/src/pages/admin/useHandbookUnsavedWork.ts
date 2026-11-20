import { useCallback, useLayoutEffect, useRef } from "react";

const leaveMessage =
  "You have unsaved handbook work or an action still in progress. Leave this page? Unsaved changes will be lost.";

type HandbookNavigationEvent = Event & {
  navigationType: string;
  destination: { url: string; sameDocument: boolean };
};
type NavigationEvents = Pick<
  EventTarget,
  "addEventListener" | "removeEventListener"
>;

function changesDocumentOrQuery(to: URL, from = new URL(window.location.href)) {
  return (
    to.origin !== from.origin ||
    to.pathname !== from.pathname ||
    to.search !== from.search
  );
}

/**
 * Mount only inside an access-bound handbook workspace. Pass false on access
 * denial; private content stays in the workspace, never in browser storage.
 *
 * The returned callback bypasses only its synchronous work, for an already
 * confirmed Back/Cancel or verified post-save navigation. Await the save first,
 * then call withUnsavedWorkBypass(() => onSaved(id)); do not wrap an async save.
 *
 * Wouter 3's navigate calls history.pushState/replaceState synchronously. These
 * wrappers exist only while this workspace needs protection, and preserve the
 * installed Wouter methods (including their location notifications).
 *
 * Same-document Back/Forward is cancelled before popstate in browsers providing
 * a cancellable Navigation API traverse event. Legacy browsers cannot reliably
 * cancel popstate without adding history markers or rewriting other entries, so
 * we deliberately do neither. Cross-document exits still use beforeunload.
 */
export function useHandbookUnsavedWork(hasUnsavedOrPending: boolean) {
  const active = useRef(hasUnsavedOrPending);
  active.current = hasUnsavedOrPending;
  const bypassDepth = useRef(0);
  const withUnsavedWorkBypass = useCallback(<T>(work: () => T): T => {
    bypassDepth.current += 1;
    try {
      return work();
    } finally {
      bypassDepth.current -= 1;
    }
  }, []);

  useLayoutEffect(() => {
    if (!hasUnsavedOrPending || typeof window === "undefined") return;
    const browserHistory = window.history;
    const originalPush = browserHistory.pushState;
    const originalReplace = browserHistory.replaceState;
    let disposed = false;
    let approvedClick: string | null = null;
    // A native same-tab anchor already received our confirmation. Its eventual
    // beforeunload must not ask again; this authorization is one-use and cleared
    // by the next interaction, history navigation, or workspace cleanup.
    let approvedDocumentLeave = false;
    const needsConfirmation = () =>
      !disposed && active.current && bypassDepth.current === 0;
    const confirmLeave = () =>
      !needsConfirmation() || window.confirm(leaveMessage);
    const clearClickApproval = () => {
      approvedClick = null;
      approvedDocumentLeave = false;
    };
    const onClick = (event: MouseEvent) => {
      clearClickApproval();
      if (
        !needsConfirmation() ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = event
        .composedPath()
        .find(node => node instanceof HTMLAnchorElement) as
        | HTMLAnchorElement
        | undefined;
      if (
        !anchor ||
        !anchor.hasAttribute("href") ||
        anchor.hasAttribute("download")
      )
        return;
      const target = (
        anchor.getAttribute("target") ??
        document.querySelector("base[target]")?.getAttribute("target") ??
        "_self"
      ).toLowerCase();
      if (target && target !== "_self") return;
      const destination = new URL(anchor.href, window.location.href);
      // mailto/tel/javascript links do not navigate this document.
      if (!/^https?:$/.test(destination.protocol)) return;
      const current = new URL(window.location.href);
      // Hash-only same-document links retain the mounted workspace. An identical
      // non-hash native URL may reload, and therefore still needs confirmation.
      if (!changesDocumentOrQuery(destination, current) && destination.hash)
        return;
      if (!confirmLeave()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      approvedClick = destination.href;
      approvedDocumentLeave = true;
      // React/Wouter's click handler runs in this dispatch, after capture. Do not
      // grant an unrelated, later router navigation the click's authorization.
      queueMicrotask(() => {
        approvedClick = null;
        if (event.defaultPrevented) approvedDocumentLeave = false;
      });
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!needsConfirmation()) return;
      if (approvedDocumentLeave) {
        approvedDocumentLeave = false;
        return;
      }
      event.preventDefault();
      // Browsers supply their own warning text; never put private content here.
      event.returnValue = "";
    };
    const guardHistory = (original: History["pushState"]) =>
      function (this: History, ...args: Parameters<History["pushState"]>) {
        const url = args[2];
        // State-only updates and same-document hash changes don't remove work.
        const destination =
          url == null ? null : new URL(String(url), window.location.href);
        const clickAllowed = destination?.href === approvedClick;
        clearClickApproval();
        if (
          destination &&
          changesDocumentOrQuery(destination) &&
          !clickAllowed &&
          !confirmLeave()
        )
          return;
        return original.apply(this, args);
      };
    const guardedPush = guardHistory(originalPush);
    const guardedReplace = guardHistory(originalReplace);
    browserHistory.pushState = guardedPush;
    browserHistory.replaceState = guardedReplace;

    const navigation = (window as Window & { navigation?: NavigationEvents })
      .navigation;
    const onNavigate = (rawEvent: Event) => {
      const event = rawEvent as HandbookNavigationEvent;
      // History wrappers already guard programmatic push/replace. Native links
      // are handled in capture; traverse must be stopped before Wouter popstate.
      if (
        event.navigationType !== "traverse" ||
        !event.destination.sameDocument ||
        !event.cancelable ||
        !changesDocumentOrQuery(new URL(event.destination.url))
      )
        return;
      clearClickApproval();
      if (!confirmLeave()) event.preventDefault();
    };
    window.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    // A canceled native click must not authorize a later reload after typing.
    window.addEventListener("keydown", clearClickApproval, true);
    window.addEventListener("input", clearClickApproval, true);
    navigation?.addEventListener("navigate", onNavigate);
    return () => {
      disposed = true;
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("keydown", clearClickApproval, true);
      window.removeEventListener("input", clearClickApproval, true);
      navigation?.removeEventListener("navigate", onNavigate);
      // Don't overwrite a newer owner's method if another integration changed it.
      if (browserHistory.pushState === guardedPush)
        browserHistory.pushState = originalPush;
      if (browserHistory.replaceState === guardedReplace)
        browserHistory.replaceState = originalReplace;
      clearClickApproval();
    };
  }, [hasUnsavedOrPending]);

  return withUnsavedWorkBypass;
}
