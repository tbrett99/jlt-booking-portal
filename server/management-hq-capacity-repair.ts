import {
  HQ_INITIAL_CAPACITY_REPAIR_MESSAGES,
  type HqInitialCapacityRepairResult,
  type HqInitialCapacityRepairStatus,
} from "../shared/management-hq-capacity-repair";
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
import { HqLiveError, safeHqLiveErrorCode } from "./management-hq-live-store";

/** Explicit control-only repair. Never constructs a reader or starts a source batch. */
export async function repairHqInitialCapacity(options: {
  config?: HqLiveConfig;
  env?: NodeJS.ProcessEnv;
  guard: () => Promise<void>;
  createService?: (options: HqLiveServiceOptions) => HqLiveService;
}): Promise<HqInitialCapacityRepairResult> {
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
    status: HqInitialCapacityRepairStatus,
    errorCode: string | null = null
  ): HqInitialCapacityRepairResult => ({
    status,
    checkedAt: new Date().toISOString(),
    message: HQ_INITIAL_CAPACITY_REPAIR_MESSAGES[status],
    errorCode,
  });
  let dto: HqInitialCapacityRepairResult;
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
      if (typeof service.repairInitialCapacity !== "function") {
        dto = result("not_repairable");
      } else {
        let response:
          | { ok: true; value: unknown }
          | { ok: false; error: unknown };
        try {
          response = { ok: true, value: await service.repairInitialCapacity() };
        } catch (error) {
          response = { ok: false, error };
        }
        await gate();
        if (!response.ok) throw response.error;
        switch (response.value) {
          case "repaired":
          case "notdue":
          case "busy":
          case "not_repairable":
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
  // Authority/settings denial never becomes a successful or stale result DTO.
  await gate();
  return dto;
}
