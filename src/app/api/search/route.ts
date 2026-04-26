import { apiError, apiSuccess } from "@/lib/api";
import { authOptions } from "@/lib/auth-options";
import { START_MODE_VALUES, type StartMode } from "@/lib/constants";
import { recordSearchHistory } from "@/lib/models/saved-data";
import { searchOpenAlex } from "@/lib/openalex";
import { getServerSession } from "next-auth";

function isStartMode(value: string): value is StartMode {
  return (START_MODE_VALUES as readonly string[]).includes(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const startModeParam = (url.searchParams.get("startMode") ?? "regular-query").trim();
  const startMode: StartMode = isStartMode(startModeParam)
    ? startModeParam
    : START_MODE_VALUES[0];

  if (!query) {
    return apiError("BAD_REQUEST", "Query parameter 'q' is required.", 400);
  }

  try {
    const sources = await searchOpenAlex(query);

    const session = await getServerSession(authOptions);
    if (session?.user?.id) {
      await recordSearchHistory({
        userId: session.user.id,
        query,
        startMode,
      });
    }

    return apiSuccess(sources);
  } catch (error) {
    return apiError(
      "UPSTREAM_ERROR",
      "Failed to fetch sources from OpenAlex. Please retry.",
      502,
      error instanceof Error ? error.message : "Unknown upstream error"
    );
  }
}
