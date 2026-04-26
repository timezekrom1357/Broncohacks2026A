import { apiError, apiSuccess } from "@/lib/api";
import type { ResearchPlanResponse } from "@/types/domain";

interface ResearchPlanBody {
  query?: string;
}

function splitTerms(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2);
}

function uniqueTerms(terms: string[]) {
  return Array.from(new Set(terms));
}

function buildResearchPlan(query: string): ResearchPlanResponse {
  const terms = uniqueTerms(splitTerms(query));
  const focusTerms = terms.slice(0, 3);
  const keywordTerms = terms.slice(0, 5);
  const synonyms = focusTerms.flatMap((term) => [term, `${term} study`, `${term} research`]);

  const refinedQuestion = focusTerms.length > 0
    ? `What does current research say about ${focusTerms.join(" and ")}?`
    : `What does current research say about ${query.trim()}?`;

  const baseQuery = query.trim();
  const suggestedQueries = uniqueTerms([
    `${baseQuery} scholarly sources`,
    `${baseQuery} research review`,
    `${baseQuery} recent findings`,
    ...focusTerms.map((term) => `${term} academic sources`),
  ]).slice(0, 5);

  return {
    refinedQuestion,
    suggestedQueries: suggestedQueries.length >= 3 ? suggestedQueries : [
      `${baseQuery} scholarly sources`,
      `${baseQuery} research review`,
      `${baseQuery} recent findings`,
    ],
    keywords: keywordTerms.length > 0 ? keywordTerms : splitTerms(baseQuery).slice(0, 3),
    synonyms: uniqueTerms(synonyms).slice(0, 6),
  };
}

export async function POST(request: Request) {
  let body: ResearchPlanBody;

  try {
    body = (await request.json()) as ResearchPlanBody;
  } catch {
    return apiError("BAD_REQUEST", "Request body must be valid JSON.", 400);
  }

  const query = body.query?.trim() ?? "";
  if (!query) {
    return apiError("BAD_REQUEST", "Query is required.", 400);
  }

  try {
    const plan = buildResearchPlan(query);
    return apiSuccess(plan);
  } catch (error) {
    return apiError(
      "INTERNAL_ERROR",
      "Unable to build a research plan right now.",
      500,
      error instanceof Error ? error.message : "Unknown research plan error"
    );
  }
}
