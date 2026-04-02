import type { AnalysisExecutionContext } from "../lib/analysis.js";
import { getPrincipalKey, type AuthPrincipal } from "../lib/auth/principal.js";
import { DiagnosticError } from "../lib/errors.js";

import { getAudioAnalysisChargeCredits, getShortAnalysisChargeCredits } from "./pricing.js";
import type { RemoteAccount } from "./remote-account.js";
import type { RemoteAccessStore } from "./remote-access-store.js";
import type { VideoAnalysisServiceLike } from "./video-analysis-service.js";

function assertPaidRemoteToolAllowed(account: RemoteAccount | null, charge: number, tool: string): void {
  if (!account) {
    throw new DiagnosticError({
      tool,
      code: "REMOTE_ACCOUNT_NOT_FOUND",
      stage: "unknown",
      message: "Remote account record is missing; try reconnecting the MCP client.",
      retryable: true,
    });
  }

  if (account.status === "suspended") {
    throw new DiagnosticError({
      tool,
      code: "REMOTE_ACCOUNT_SUSPENDED",
      stage: "unknown",
      message: "This account is suspended and cannot run remote analysis tools.",
      retryable: false,
      details: { accountId: account.accountId },
    });
  }

  if (account.creditBalance < charge) {
    throw new DiagnosticError({
      tool,
      code: "INSUFFICIENT_CREDITS",
      stage: "unknown",
      message: `Not enough credits for this operation (${charge} required).`,
      retryable: false,
      details: { requiredCredits: charge, creditBalance: account.creditBalance },
    });
  }
}

export function createPrincipalScopedService(
  service: VideoAnalysisServiceLike,
  principal: AuthPrincipal,
  remoteAccessStore: RemoteAccessStore
): VideoAnalysisServiceLike {
  const accountId = getPrincipalKey(principal);

  return {
    async analyzeShort(input, context: AnalysisExecutionContext) {
      const charge = getShortAnalysisChargeCredits();
      const account = await remoteAccessStore.getAccount(accountId);
      assertPaidRemoteToolAllowed(account, charge, context.tool);

      const result = await service.analyzeShort(input, context);
      const afterDebit = await remoteAccessStore.adjustAccountCredits(accountId, -charge);
      if (!afterDebit) {
        context.logger.warn("remote.credits.debit_failed_after_success", {
          accountId,
          charge,
          tool: context.tool,
        });
      }

      return result;
    },

    async analyzeAudio(input, context: AnalysisExecutionContext) {
      const charge = getAudioAnalysisChargeCredits();
      const account = await remoteAccessStore.getAccount(accountId);
      assertPaidRemoteToolAllowed(account, charge, context.tool);

      const result = await service.analyzeAudio(input, context);
      const afterDebit = await remoteAccessStore.adjustAccountCredits(accountId, -charge);
      if (!afterDebit) {
        context.logger.warn("remote.credits.debit_failed_after_success", {
          accountId,
          charge,
          tool: context.tool,
        });
      }

      return result;
    },

    analyzeLong: (input, context) => service.analyzeLong(input, context),
    continueLong: (input, context) => service.continueLong(input, context),
    getYouTubeMetadata: (input, context) => service.getYouTubeMetadata(input, context),
  };
}
