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

export interface HqInitialRecoveryResult {
  status:
    | "recovered"
    | "notdue"
    | "busy"
    | "not_recoverable"
    | "invalid_settings"
    | "needs_attention";
  checkedAt: string;
  message: string;
  errorCode: HqLiveErrorCode | null;
}
const messages: Record<HqInitialRecoveryResult["status"], string> = {
  recovered:
    "The empty failed first import was recovered once. No source batch was started by recovery; dashboards and automatic updates remain off.",
  notdue:
    "The stopped first import is not due for recovery yet. No reporting state was changed.",
  busy: "A reporting import is still running. No recovery or source batch was started.",
  not_recoverable:
    "This is not the approved empty first-import failure, or recovery was already used. No reporting state was changed.",
  invalid_settings:
    "Recovery requires valid configured sync-on/read-off settings. No reporting state was changed.",
  needs_attention:
    "The reporting recovery could not be verified. Stop and investigate before any further import action.",
};

/** Server-side seams only. No caller-selected state, source URL, version or error to clear. */
export async function recoverHqEmptyInitialImport(options: {
  config?: HqLiveConfig;
  env?: NodeJS.ProcessEnv;
  guard: () => Promise<void>;
  createService?: (options: HqLiveServiceOptions) => HqLiveService;
}): Promise<HqInitialRecoveryResult> {
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
    status: HqInitialRecoveryResult["status"],
    errorCode: HqLiveErrorCode | null = null
  ): HqInitialRecoveryResult => ({
    status,
    checkedAt: new Date().toISOString(),
    message: messages[status],
    errorCode,
  });
  let dto: HqInitialRecoveryResult;
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
      if (typeof service.recoverEmptyInitialImport !== "function") {
        dto = result("not_recoverable");
      } else {
        let response:
          | { ok: true; value: unknown }
          | { ok: false; error: unknown };
        try {
          response = {
            ok: true,
            value: await service.recoverEmptyInitialImport(),
          };
        } catch (error) {
          response = { ok: false, error };
        }
        await gate();
        if (!response.ok) throw response.error;
        switch (response.value) {
          case "recovered":
          case "notdue":
          case "busy":
          case "not_recoverable":
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
  // Guard denial is never converted into a success or safe error DTO.
  await gate();
  return dto;
}
