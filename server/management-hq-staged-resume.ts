import {
  createHqLiveConfig,
  type HqLiveConfig,
} from "./management-hq-live-config";
import {
  createHqLiveService,
  type HqLiveService,
  type HqLiveServiceOptions,
} from "./management-hq-live-service";
import { captureHqInitialImportBinding } from "./management-hq-initial-import";
import {
  HqLiveError,
  safeHqLiveErrorCode,
  type HqLiveErrorCode,
} from "./management-hq-live-store";

export interface HqStagedResumeResult {
  status:
    | "resumed"
    | "notdue"
    | "busy"
    | "not_resumable"
    | "invalid_settings"
    | "needs_attention";
  checkedAt: string;
  message: string;
  errorCode: HqLiveErrorCode | null;
}
const messages: Record<HqStagedResumeResult["status"], string> = {
  resumed:
    "The stopped first import is ready to continue, with its saved progress and failure history preserved. Resume started no source batch; dashboards and automatic updates remain off.",
  notdue:
    "The stopped first import is not due to resume yet. No reporting state was changed.",
  busy: "A reporting import is still running. No Resume or source batch was started.",
  not_resumable:
    "This is not an eligible staged first-import size-limit failure, or Resume was already used. No reporting state was changed.",
  invalid_settings:
    "Resume requires valid configured sync-on/read-off settings. No reporting state was changed.",
  needs_attention:
    "The reporting Resume could not be verified. Stop and investigate before any further import action.",
};

/** Server-only seams. The protected RPC accepts no state, versions, errors or URL input. */
export async function resumeHqStagedInitialImport(options: {
  config?: HqLiveConfig;
  env?: NodeJS.ProcessEnv;
  guard: () => Promise<void>;
  createService?: (options: HqLiveServiceOptions) => HqLiveService;
}): Promise<HqStagedResumeResult> {
  if (typeof options.guard !== "function")
    throw new HqLiveError("CONFIG_INVALID");
  const config = options.config ?? createHqLiveConfig(options.env);
  const assertBinding = captureHqInitialImportBinding(options.env);
  let failure: { error: unknown } | null = null;
  const gate = async () => {
    try {
      assertBinding();
    } catch (error) {
      failure ??= { error };
    }
    try {
      await options.guard();
    } catch (error) {
      failure ??= { error };
    }
    try {
      assertBinding();
    } catch (error) {
      failure ??= { error };
    }
    if (failure) throw failure.error;
  };
  const result = (
    status: HqStagedResumeResult["status"],
    errorCode: HqLiveErrorCode | null = null
  ): HqStagedResumeResult => ({
    status,
    checkedAt: new Date().toISOString(),
    message: messages[status],
    errorCode,
  });
  let dto: HqStagedResumeResult;
  try {
    await gate();
    const settings = config.status();
    if (!settings.configured || !settings.syncEnabled || settings.readEnabled) {
      dto = result(
        "invalid_settings",
        settings.configurationCode === "CONFIG_INCOMPLETE"
          ? "CONFIG_INCOMPLETE"
          : "CONFIG_INVALID"
      );
    } else {
      const service = (options.createService ?? createHqLiveService)({
        config,
        onlyInitialPublication: true,
        initialImportGuard: gate,
      });
      await gate();
      if (typeof service.resumeStagedInitialImport !== "function") {
        dto = result("not_resumable");
      } else {
        let response:
          | { ok: true; value: unknown }
          | { ok: false; error: unknown };
        try {
          response = {
            ok: true,
            value: await service.resumeStagedInitialImport(),
          };
        } catch (error) {
          response = { ok: false, error };
        }
        await gate();
        if (!response.ok) throw response.error;
        switch (response.value) {
          case "resumed":
          case "notdue":
          case "busy":
          case "not_resumable":
            dto = result(response.value);
            break;
          default:
            dto = result("needs_attention", "STORE_UNAVAILABLE");
        }
      }
    }
  } catch (error) {
    dto = result(
      "needs_attention",
      error instanceof HqLiveError
        ? safeHqLiveErrorCode(error.code)
        : "STORE_UNAVAILABLE"
    );
  }
  // A failed authority/settings guard is never converted into a safe result DTO.
  await gate();
  return dto;
}
