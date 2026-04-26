import { apiError, apiSuccess } from "@/lib/api";
import type { ResearchPlanResponse } from "@/types/domain";

interface ResearchPlanBody {
  query?: string;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "were",
  "with",
]);

function splitTerms(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term));
}

function uniqueTerms(terms: string[]) {
  return Array.from(new Set(terms));
}

function buildResearchPlan(query: string): ResearchPlanResponse {
  const terms = uniqueTerms(splitTerms(query));
  const focusTerms = terms.slice(0, 4);
  const keywordTerms = terms.slice(0, 5);
  const synonyms = focusTerms.flatMap((term) => [term, `${term} studies`, `${term} evidence`]);

  const phrase = focusTerms.join(" ");
  const refinedQuestion =
    focusTerms.length > 0
      ? `What does current research conclude about ${phrase}?`
      : `What does current research conclude about ${query.trim()}?`;

  const baseQuery = query.trim().replace(/\s+/g, " ");
  const basePhrase = phrase || baseQuery;
  const suggestedQueries = uniqueTerms([
    `${basePhrase} systematic review`,
    `${basePhrase} meta analysis`,
    `${basePhrase} randomized trial`,
    `${basePhrase} observational study`,
    `${basePhrase} academic sources`,
    baseQuery,
  ]).slice(0, 6);

  return {
    refinedQuestion,
    suggestedQueries:
      suggestedQueries.length >= 3
        ? suggestedQueries
        : [`${basePhrase} systematic review`, `${basePhrase} meta analysis`, baseQuery],
    keywords: keywordTerms.length > 0 ? keywordTerms : splitTerms(baseQuery).slice(0, 4),
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
