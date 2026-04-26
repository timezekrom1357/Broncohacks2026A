import { apiError, apiSuccess } from "@/lib/api";
import {
  clearEnhancedQueryItems,
  clearSearchHistory,
  listEnhancedQueryItems,
  listSearchHistory,
} from "@/lib/models/saved-data";
import { withProtectedApi } from "@/lib/protected-api";

export const GET = withProtectedApi(async ({ user }) => {
  try {
    const [searchHistory, enhancedQueries] = await Promise.all([
      listSearchHistory(user.id),
      listEnhancedQueryItems(user.id),
    ]);

    return apiSuccess({ searchHistory, enhancedQueries });
  } catch (error) {
    return apiError(
      "INTERNAL_ERROR",
      "Unable to load history.",
      500,
      error instanceof Error ? error.message : "Unknown history list error"
    );
  }
});

export const DELETE = withProtectedApi(async ({ user }) => {
  try {
    const [searchDeletedCount, enhancedDeletedCount] = await Promise.all([
      clearSearchHistory(user.id),
      clearEnhancedQueryItems(user.id),
    ]);

    return apiSuccess({
      searchDeletedCount,
      enhancedDeletedCount,
    });
  } catch (error) {
    return apiError(
      "INTERNAL_ERROR",
      "Unable to clear history.",
      500,
      error instanceof Error ? error.message : "Unknown history clear error"
    );
  }
});
