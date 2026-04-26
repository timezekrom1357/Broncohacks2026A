"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";

import { EmptyState, ErrorState, LoadingState } from "@/components/ui/async-state";
import {
  CITATION_STYLE_VALUES,
  START_MODES,
  START_MODE_VALUES,
  type CitationStyle,
  type StartMode,
} from "@/lib/constants";
import {
  appendGuestCitationHistory,
  clearGuestCitationHistory,
  createGuestCitationHistoryItem,
  readGuestCitationHistory,
} from "@/lib/guest-citation-history";
import type {
  ClaimMatch,
  ClaimMatchSearchResponse,
  EnhancedQueryItem,
  GuestCitationHistoryItem,
  SavedCitation,
  SavedSource,
  SearchHistoryItem,
  Source,
} from "@/types/domain";

interface PagedSearchResponse {
  ok: boolean;
  data?: {
    items: Source[];
    page: number;
    limit: number;
    totalCount: number;
    hasMore: boolean;
  };
  error?: {
    code: string;
    message: string;
  };
}

interface ResearchPlanResponseWrapper {
  ok: boolean;
  data?: {
    refinedQuestion: string;
    suggestedQueries: string[];
    keywords: string[];
    synonyms: string[];
  };
  error?: {
    code: string;
    message: string;
  };
}

interface CitationResponse {
  ok: boolean;
  data?: {
    citationText: string;
    style: CitationStyle;
  };
  error?: {
    code: string;
    message: string;
  };
}

interface SignUpResponse {
  ok: boolean;
  data?: {
    message: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

interface SavedSourcesResponse {
  ok: boolean;
  data?: {
    items: SavedSource[];
  };
  error?: {
    code: string;
    message: string;
  };
}

interface SavedCitationsResponse {
  ok: boolean;
  data?: {
    items: SavedCitation[];
  };
  error?: {
    code: string;
    message: string;
  };
}

interface HistoryResponse {
  ok: boolean;
  data?: {
    searchHistory: SearchHistoryItem[];
    enhancedQueries: EnhancedQueryItem[];
  };
  error?: {
    code: string;
    message: string;
  };
}

interface SavedSourceMutationResponse {
  ok: boolean;
  data?: {
    item: SavedSource;
  };
  error?: {
    code: string;
    message: string;
  };
}

interface SavedCitationMutationResponse {
  ok: boolean;
  data?: {
    item: SavedCitation;
  };
  error?: {
    code: string;
    message: string;
  };
}

interface BatchCitationItem {
  sourceId: string;
  sourceTitle: string;
  citationText: string;
}

interface ResearchPlanState {
  originalQuery: string;
  refinedQuestion: string;
  suggestedQueries: string[];
  keywords: string[];
  synonyms: string[];
}

const MODE_HELP: Record<StartMode, string> = {
  "regular-query": "Search for sources directly by topic.",
  "query-to-research-plan":
    "Start with a topic. In a later step, this mode will suggest refined research queries.",
  "claim-to-source":
    "Start from a claim or thesis statement. In a later step, this mode will rank source matches.",
};

const RESULT_LIMIT_OPTIONS = [10, 15, 25, 50] as const;

function formatPublicationDate(rawDate: string) {
  if (!rawDate) {
    return "Unknown date";
  }

  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) {
    return rawDate;
  }

  return parsed.toLocaleDateString();
}

function formatAuthors(authors: string[]) {
  if (authors.length === 0) {
    return "Unknown authors";
  }
  return authors.join(", ");
}

function formatHistoryTimestamp(isoValue: string) {
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) {
    return isoValue;
  }

  return parsed.toLocaleString();
}

function getKeywordsFromTitle(title: string) {
  const stopWords = new Set([
    "the",
    "and",
    "from",
    "with",
    "into",
    "that",
    "this",
    "using",
    "study",
    "analysis",
    "effects",
  ]);

  const words = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !stopWords.has(word));

  return Array.from(new Set(words)).slice(0, 2);
}

function buildMetadataSummary(source: Source) {
  const keywords = getKeywordsFromTitle(source.title);
  const keywordText =
    keywords.length > 0 ? keywords.join(", ") : "the topic described in the source title";

  return `This source appears to discuss ${source.title}. It is likely relevant to your search because it covers ${keywordText}.`;
}

export default function Home() {
  const { data: session, status: sessionStatus } = useSession();
  const [query, setQuery] = useState("");
  const [startMode, setStartMode] = useState<StartMode>(START_MODE_VALUES[0]);
  const [results, setResults] = useState<Source[]>([]);
  const [resultsPage, setResultsPage] = useState(1);
  const [resultsLimit, setResultsLimit] = useState<(typeof RESULT_LIMIT_OPTIONS)[number]>(15);
  const [resultsTotalCount, setResultsTotalCount] = useState(0);
  const [resultsHasMore, setResultsHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isClaimMatching, setIsClaimMatching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [planErrorMessage, setPlanErrorMessage] = useState<string | null>(null);
  const [claimMatchError, setClaimMatchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [expandedSourceIds, setExpandedSourceIds] = useState<string[]>([]);
  const [citationStyle, setCitationStyle] = useState<CitationStyle>("MLA");
  const [citationTextsBySource, setCitationTextsBySource] = useState<Record<string, string>>({});
  const [citationErrorsBySource, setCitationErrorsBySource] = useState<Record<string, string>>({});
  const [citationLoadingSourceId, setCitationLoadingSourceId] = useState<string | null>(null);
  const [copyStatusBySource, setCopyStatusBySource] = useState<
    Record<string, "idle" | "success" | "error">
  >({});
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [batchCitations, setBatchCitations] = useState<BatchCitationItem[]>([]);
  const [isBatchCitationLoading, setIsBatchCitationLoading] = useState(false);
  const [batchCitationError, setBatchCitationError] = useState<string | null>(null);
  const [batchCopyStatus, setBatchCopyStatus] = useState<"idle" | "success" | "error">(
    "idle"
  );
  const [guestCitationHistory, setGuestCitationHistory] = useState<GuestCitationHistoryItem[]>([]);
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [savedSources, setSavedSources] = useState<SavedSource[]>([]);
  const [savedCitations, setSavedCitations] = useState<SavedCitation[]>([]);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [enhancedQueries, setEnhancedQueries] = useState<EnhancedQueryItem[]>([]);
  const [isAccountDataLoading, setIsAccountDataLoading] = useState(false);
  const [accountDataError, setAccountDataError] = useState<string | null>(null);
  const [isDeleteAccountLoading, setIsDeleteAccountLoading] = useState(false);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [savingSourceIds, setSavingSourceIds] = useState<string[]>([]);
  const [savingCitationSourceIds, setSavingCitationSourceIds] = useState<string[]>([]);
  const [researchPlan, setResearchPlan] = useState<ResearchPlanState | null>(null);
  const [pendingResearchPlanQuery, setPendingResearchPlanQuery] = useState<string>("");
  const [claimMatches, setClaimMatches] = useState<ClaimMatch[]>([]);
  const [claimRefinedQuestion, setClaimRefinedQuestion] = useState<string>("");
  const [claimRetrievalQueries, setClaimRetrievalQueries] = useState<string[]>([]);
  const [claimKeywords, setClaimKeywords] = useState<string[]>([]);
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const queryRef = useRef(query);
  const searchAbortRef = useRef<AbortController | null>(null);
  const claimAbortRef = useRef<AbortController | null>(null);
  const planAbortRef = useRef<AbortController | null>(null);
  const lastSubmittedSignatureRef = useRef<string>("");

  const modeHint = useMemo(() => MODE_HELP[startMode], [startMode]);
  const selectedSources = useMemo(
    () => results.filter((source) => selectedSourceIds.includes(source.id)),
    [results, selectedSourceIds]
  );
  const claimMatchBySourceId = useMemo(
    () => new Map(claimMatches.map((match) => [match.sourceId, match])),
    [claimMatches]
  );
  const savedSourceOpenAlexIds = useMemo(
    () => new Set(savedSources.map((item) => item.openAlexId)),
    [savedSources]
  );
  const totalResultPages = useMemo(
    () => Math.max(1, Math.ceil((resultsTotalCount || results.length) / resultsLimit)),
    [resultsLimit, results.length, resultsTotalCount]
  );

  useEffect(() => {
    setGuestCitationHistory(readGuestCitationHistory());
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 450);

    queryRef.current = query;

    return () => {
      clearTimeout(timeoutId);
    };
  }, [query]);

  useEffect(() => {
    lastSubmittedSignatureRef.current = `${startMode}::${queryRef.current.trim()}`;
  }, [startMode]);

  useEffect(() => {
    if (sessionStatus !== "authenticated") {
      setSavedSources([]);
      setSavedCitations([]);
      setSearchHistory([]);
      setEnhancedQueries([]);
      setAccountDataError(null);
      return;
    }

    void loadAccountData();
  }, [sessionStatus]);

  useEffect(() => {
    if (startMode !== "query-to-research-plan") {
      setResearchPlan(null);
      setPlanErrorMessage(null);
      setPendingResearchPlanQuery("");
    }

    if (startMode !== "claim-to-source") {
      setClaimMatches([]);
      setClaimRefinedQuestion("");
      setClaimRetrievalQueries([]);
      setClaimKeywords([]);
      setClaimMatchError(null);
    }

    setResultsPage(1);
  }, [startMode]);

  async function loadAccountData() {
    setIsAccountDataLoading(true);
    setAccountDataError(null);

    try {
      const [savedSourcesResponse, savedCitationsResponse, historyResponse] = await Promise.all([
        fetch("/api/saved-sources"),
        fetch("/api/saved-citations"),
        fetch("/api/history"),
      ]);

      const savedSourcesPayload = (await savedSourcesResponse.json()) as SavedSourcesResponse;
      const savedCitationsPayload =
        (await savedCitationsResponse.json()) as SavedCitationsResponse;
      const historyPayload = (await historyResponse.json()) as HistoryResponse;

      if (
        !savedSourcesResponse.ok ||
        !savedSourcesPayload.ok ||
        !savedSourcesPayload.data ||
        !savedCitationsResponse.ok ||
        !savedCitationsPayload.ok ||
        !savedCitationsPayload.data ||
        !historyResponse.ok ||
        !historyPayload.ok ||
        !historyPayload.data
      ) {
        throw new Error(
          savedSourcesPayload.error?.message ||
            savedCitationsPayload.error?.message ||
            historyPayload.error?.message ||
            "Unable to load account data."
        );
      }

      setSavedSources(savedSourcesPayload.data.items);
      setSavedCitations(savedCitationsPayload.data.items);
      setSearchHistory(historyPayload.data.searchHistory);
      setEnhancedQueries(historyPayload.data.enhancedQueries);
    } catch (error) {
      setAccountDataError(
        error instanceof Error ? error.message : "Unable to load account data right now."
      );
    } finally {
      setIsAccountDataLoading(false);
    }
  }

  async function saveSourceForUser(source: Source) {
    if (sessionStatus !== "authenticated") {
      return;
    }

    setSavingSourceIds((current) => [...current, source.id]);
    setAccountDataError(null);

    try {
      const response = await fetch("/api/saved-sources", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source }),
      });

      const payload = (await response.json()) as SavedSourceMutationResponse;
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message || "Unable to save source.");
      }

      const savedItem = payload.data.item;

      setSavedSources((current) => {
        const withoutExisting = current.filter(
          (item) => item.openAlexId !== savedItem.openAlexId
        );
        return [savedItem, ...withoutExisting];
      });
    } catch (error) {
      setAccountDataError(error instanceof Error ? error.message : "Unable to save source.");
    } finally {
      setSavingSourceIds((current) => current.filter((id) => id !== source.id));
    }
  }

  async function saveCitationForUser(source: Source) {
    if (sessionStatus !== "authenticated") {
      return;
    }

    const citationText = citationTextsBySource[source.id] ?? "";
    if (!citationText) {
      setAccountDataError("Generate a citation before saving it.");
      return;
    }

    setSavingCitationSourceIds((current) => [...current, source.id]);
    setAccountDataError(null);

    try {
      const response = await fetch("/api/saved-citations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sourceId: source.id,
          sourceTitle: source.title,
          style: citationStyle,
          citationText,
        }),
      });

      const payload = (await response.json()) as SavedCitationMutationResponse;
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message || "Unable to save citation.");
      }

      const savedItem = payload.data.item;

      setSavedCitations((current) => [savedItem, ...current]);
    } catch (error) {
      setAccountDataError(error instanceof Error ? error.message : "Unable to save citation.");
    } finally {
      setSavingCitationSourceIds((current) => current.filter((id) => id !== source.id));
    }
  }

  async function deleteSavedSourceItem(itemId: string) {
    setAccountDataError(null);

    try {
      const response = await fetch(`/api/saved-sources/${encodeURIComponent(itemId)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json()) as {
          error?: {
            message?: string;
          };
        };
        throw new Error(payload.error?.message || "Unable to delete saved source.");
      }

      setSavedSources((current) => current.filter((item) => item.id !== itemId));
    } catch (error) {
      setAccountDataError(
        error instanceof Error ? error.message : "Unable to delete saved source."
      );
    }
  }

  async function deleteSavedCitationItem(itemId: string) {
    setAccountDataError(null);

    try {
      const response = await fetch(`/api/saved-citations/${encodeURIComponent(itemId)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json()) as {
          error?: {
            message?: string;
          };
        };
        throw new Error(payload.error?.message || "Unable to delete saved citation.");
      }

      setSavedCitations((current) => current.filter((item) => item.id !== itemId));
    } catch (error) {
      setAccountDataError(
        error instanceof Error ? error.message : "Unable to delete saved citation."
      );
    }
  }

  async function deleteHistoryItem(itemId: string, type: "search" | "enhanced") {
    setAccountDataError(null);

    try {
      const response = await fetch(
        `/api/history/${encodeURIComponent(itemId)}?type=${encodeURIComponent(type)}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        const payload = (await response.json()) as {
          error?: {
            message?: string;
          };
        };
        throw new Error(payload.error?.message || "Unable to delete history item.");
      }

      if (type === "search") {
        setSearchHistory((current) => current.filter((item) => item.id !== itemId));
        return;
      }

      setEnhancedQueries((current) => current.filter((item) => item.id !== itemId));
    } catch (error) {
      setAccountDataError(
        error instanceof Error ? error.message : "Unable to delete history item."
      );
    }
  }

  async function clearUserHistory() {
    setIsClearingHistory(true);
    setAccountDataError(null);

    try {
      const response = await fetch("/api/history", {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json()) as {
          error?: {
            message?: string;
          };
        };
        throw new Error(payload.error?.message || "Unable to clear history.");
      }

      setSearchHistory([]);
      setEnhancedQueries([]);
    } catch (error) {
      setAccountDataError(error instanceof Error ? error.message : "Unable to clear history.");
    } finally {
      setIsClearingHistory(false);
    }
  }

  async function deleteAccount() {
    if (!window.confirm("Delete your account and all saved data permanently?")) {
      return;
    }

    setIsDeleteAccountLoading(true);
    setAccountDataError(null);

    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json()) as {
          error?: {
            message?: string;
          };
        };
        throw new Error(payload.error?.message || "Unable to delete account.");
      }

      await signOut({ redirect: false });
      setAuthMessage("Account deleted successfully.");
      setSavedSources([]);
      setSavedCitations([]);
      setSearchHistory([]);
      setEnhancedQueries([]);
    } catch (error) {
      setAccountDataError(error instanceof Error ? error.message : "Unable to delete account.");
    } finally {
      setIsDeleteAccountLoading(false);
    }
  }

  const performSearch = useCallback(async (
    searchQuery: string,
    page = 1,
    limit = resultsLimit
  ) => {
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) {
      setErrorMessage("Enter a topic or claim before searching.");
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    const signature = `${startMode}::${trimmedQuery}`;
    lastSubmittedSignatureRef.current = signature;

    setIsLoading(true);
    setErrorMessage(null);
    setPlanErrorMessage(null);
    setResearchPlan(null);
    setHasSearched(true);
    setResultsPage(page);
    setResultsLimit(limit);

    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(trimmedQuery)}&startMode=${encodeURIComponent(startMode)}&page=${encodeURIComponent(String(page))}&limit=${encodeURIComponent(String(limit))}`,
        {
          signal: controller.signal,
        }
      );
      const payload = (await response.json()) as PagedSearchResponse;

      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message || "Search request failed.");
      }

      setResults(payload.data.items);
      setResultsPage(payload.data.page);
      setResultsLimit(payload.data.limit as (typeof RESULT_LIMIT_OPTIONS)[number]);
      setResultsTotalCount(payload.data.totalCount);
      setResultsHasMore(payload.data.hasMore);
      setExpandedSourceIds([]);
      setSelectedSourceIds([]);
      setCitationTextsBySource({});
      setCitationErrorsBySource({});
      setCopyStatusBySource({});
      setCitationLoadingSourceId(null);
      setBatchCitations([]);
      setBatchCitationError(null);
      setBatchCopyStatus("idle");
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      setResults([]);
      setResultsTotalCount(0);
      setResultsHasMore(false);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to complete search right now. Please retry."
      );
    } finally {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
      }

      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [resultsLimit, startMode]);

  const requestClaimMatches = useCallback(async (
    trimmedClaim: string,
    page = 1,
    limit = resultsLimit
  ) => {
    if (!trimmedClaim) {
      setErrorMessage("Enter a claim before matching sources.");
      return;
    }

    claimAbortRef.current?.abort();
    const controller = new AbortController();
    claimAbortRef.current = controller;

    const signature = `${startMode}::${trimmedClaim}`;
    lastSubmittedSignatureRef.current = signature;

    setIsClaimMatching(true);
    setErrorMessage(null);
    setPlanErrorMessage(null);
    setResearchPlan(null);
    setPendingResearchPlanQuery("");
    setClaimMatchError(null);
    setHasSearched(true);
    setResultsPage(page);
    setResultsLimit(limit);

    try {
      const response = await fetch(
        `/api/claim-match?page=${encodeURIComponent(String(page))}&limit=${encodeURIComponent(String(limit))}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({ claim: trimmedClaim }),
        }
      );

      const payload = (await response.json()) as {
        ok: boolean;
        data?: ClaimMatchSearchResponse;
        error?: {
          code: string;
          message: string;
        };
      };

      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message || "Claim matching failed.");
      }

      setResults(payload.data.sources);
      setResultsPage(payload.data.page);
      setResultsLimit(payload.data.limit as (typeof RESULT_LIMIT_OPTIONS)[number]);
      setResultsTotalCount(payload.data.totalResults);
      setResultsHasMore(payload.data.hasMore);
      setClaimMatches(payload.data.matches);
      setClaimRefinedQuestion(payload.data.refinedQuestion);
      setClaimRetrievalQueries(payload.data.retrievalQueries);
      setClaimKeywords(payload.data.keywords);
      setClaimMatchError(payload.data.matchError ?? null);
      setExpandedSourceIds([]);
      setSelectedSourceIds([]);
      setCitationTextsBySource({});
      setCitationErrorsBySource({});
      setCopyStatusBySource({});
      setCitationLoadingSourceId(null);
      setBatchCitations([]);
      setBatchCitationError(null);
      setBatchCopyStatus("idle");
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      setClaimMatches([]);
      setClaimRefinedQuestion("");
      setClaimRetrievalQueries([]);
      setClaimKeywords([]);
      setClaimMatchError(
        error instanceof Error
          ? `${error.message} Falling back to a standard search.`
          : "Unable to rank claim matches right now. Falling back to a standard search."
      );
      await performSearch(trimmedClaim, page, limit);
    } finally {
      if (claimAbortRef.current === controller) {
        claimAbortRef.current = null;
      }

      if (!controller.signal.aborted) {
        setIsClaimMatching(false);
      }
    }
  }, [performSearch, resultsLimit, startMode]);

  async function rerunCurrentQuery(page = resultsPage, limit = resultsLimit) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return;
    }

    if (startMode === "query-to-research-plan") {
      await requestResearchPlan(trimmedQuery);
      return;
    }

    if (startMode === "claim-to-source") {
      await requestClaimMatches(trimmedQuery, page, limit);
      return;
    }

    await performSearch(trimmedQuery, page, limit);
  }

  async function runSearch() {
    await rerunCurrentQuery(1, resultsLimit);
  }

  async function requestResearchPlan(trimmedQuery: string) {
    planAbortRef.current?.abort();
    const controller = new AbortController();
    planAbortRef.current = controller;

    setIsPlanning(true);
    setErrorMessage(null);
    setPlanErrorMessage(null);
    setHasSearched(true);

    try {
      const response = await fetch("/api/research-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({ query: trimmedQuery }),
      });

      const payload = (await response.json()) as ResearchPlanResponseWrapper;
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message || "Research plan failed.");
      }

      setResearchPlan({
        originalQuery: trimmedQuery,
        refinedQuestion: payload.data.refinedQuestion,
        suggestedQueries: payload.data.suggestedQueries,
        keywords: payload.data.keywords,
        synonyms: payload.data.synonyms,
      });
      setPendingResearchPlanQuery(trimmedQuery);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      setResearchPlan(null);
      setPlanErrorMessage(
        error instanceof Error ? error.message : "Unable to build a research plan right now."
      );
      await performSearch(trimmedQuery);
    } finally {
      if (planAbortRef.current === controller) {
        planAbortRef.current = null;
      }

      if (!controller.signal.aborted) {
        setIsPlanning(false);
      }
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedQuery = query.trim();
    if (startMode === "query-to-research-plan") {
      await requestResearchPlan(trimmedQuery);
      return;
    }

    if (startMode === "claim-to-source") {
      await requestClaimMatches(trimmedQuery, 1, resultsLimit);
      return;
    }

    await performSearch(trimmedQuery, 1, resultsLimit);
  }

  async function searchWithSuggestion(suggestion: string) {
    setQuery(suggestion);
    setResearchPlan(null);
    setPendingResearchPlanQuery("");
    await performSearch(suggestion, 1, resultsLimit);
  }

  async function searchWithOriginalResearchQuery() {
    const originalQuery = pendingResearchPlanQuery || query;
    setQuery(originalQuery);
    setResearchPlan(null);
    setPendingResearchPlanQuery("");
    await performSearch(originalQuery, 1, resultsLimit);
  }

  useEffect(() => {
    const trimmedQuery = debouncedQuery.trim();
    if (!trimmedQuery || startMode === "query-to-research-plan") {
      return;
    }

    const signature = `${startMode}::${trimmedQuery}`;
    if (lastSubmittedSignatureRef.current === signature) {
      return;
    }

    lastSubmittedSignatureRef.current = signature;

    if (startMode === "claim-to-source") {
      void requestClaimMatches(trimmedQuery, 1, resultsLimit);
      return;
    }

    void performSearch(trimmedQuery, 1, resultsLimit);
  }, [debouncedQuery, performSearch, requestClaimMatches, resultsLimit, startMode]);

  async function generateCitationForSource(source: Source) {
    setCitationLoadingSourceId(source.id);
    setCitationErrorsBySource((current) => ({ ...current, [source.id]: "" }));
    setCopyStatusBySource((current) => ({ ...current, [source.id]: "idle" }));

    try {
      const response = await fetch("/api/citation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source,
          style: citationStyle,
        }),
      });

      const payload = (await response.json()) as CitationResponse;
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message || "Citation generation failed.");
      }

      setCitationTextsBySource((current) => ({
        ...current,
        [source.id]: payload.data?.citationText ?? "",
      }));

      const item = createGuestCitationHistoryItem({
        sourceId: source.id,
        sourceTitle: source.title,
        style: payload.data.style,
        citationText: payload.data.citationText,
      });

      setGuestCitationHistory(appendGuestCitationHistory(item));
    } catch (error) {
      setCitationTextsBySource((current) => ({ ...current, [source.id]: "" }));
      setCitationErrorsBySource((current) => ({
        ...current,
        [source.id]:
          error instanceof Error ? error.message : "Citation generation failed. Please retry.",
      }));
    } finally {
      setCitationLoadingSourceId(null);
    }
  }

  async function copyCitationForSource(sourceId: string) {
    const citationText = citationTextsBySource[sourceId] ?? "";
    if (!citationText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(citationText);
      setCopyStatusBySource((current) => ({ ...current, [sourceId]: "success" }));
    } catch {
      setCopyStatusBySource((current) => ({ ...current, [sourceId]: "error" }));
    }
  }

  function toggleSourceDetails(sourceId: string) {
    setExpandedSourceIds((current) =>
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId]
    );
  }

  function toggleSourceSelection(sourceId: string) {
    setSelectedSourceIds((current) =>
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId]
    );
  }

  async function generateBatchCitations() {
    if (selectedSources.length === 0) {
      setBatchCitationError("Select at least one source first.");
      return;
    }

    setIsBatchCitationLoading(true);
    setBatchCitationError(null);
    setBatchCopyStatus("idle");

    try {
      const citationPromises = selectedSources.map(async (source) => {
        const response = await fetch("/api/citation", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            source,
            style: citationStyle,
          }),
        });

        const payload = (await response.json()) as CitationResponse;
        if (!response.ok || !payload.ok || !payload.data) {
          throw new Error(
            payload.error?.message || `Citation generation failed for ${source.title}.`
          );
        }

        return {
          sourceId: source.id,
          sourceTitle: source.title,
          citationText: payload.data.citationText,
        } satisfies BatchCitationItem;
      });

      const items = await Promise.all(citationPromises);
      const sortedItems = [...items].sort((a, b) =>
        a.citationText.localeCompare(b.citationText, undefined, { sensitivity: "base" })
      );
      setBatchCitations(sortedItems);
    } catch (error) {
      setBatchCitations([]);
      setBatchCitationError(
        error instanceof Error
          ? error.message
          : "Failed to generate citation list. Please retry."
      );
    } finally {
      setIsBatchCitationLoading(false);
    }
  }

  async function copyBatchCitationList() {
    if (batchCitations.length === 0) {
      return;
    }

    const content = batchCitations.map((item) => item.citationText).join("\n\n");

    try {
      await navigator.clipboard.writeText(content);
      setBatchCopyStatus("success");
    } catch {
      setBatchCopyStatus("error");
    }
  }

  function clearGuestCitationHistoryList() {
    clearGuestCitationHistory();
    setGuestCitationHistory([]);
  }

  async function onSignUpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSigningUp(true);
    setAuthError(null);
    setAuthMessage(null);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: signUpEmail,
          password: signUpPassword,
        }),
      });

      const payload = (await response.json()) as SignUpResponse;
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message || "Sign up failed.");
      }

      setAuthMessage(payload.data.message);
      setSignUpPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to sign up right now.");
    } finally {
      setIsSigningUp(false);
    }
  }

  async function onLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsLoggingIn(true);
    setAuthError(null);
    setAuthMessage(null);

    try {
      const result = await signIn("credentials", {
        email: loginEmail,
        password: loginPassword,
        redirect: false,
      });

      if (!result || result.error) {
        throw new Error("Login failed. Ensure your email is verified and credentials are correct.");
      }

      setAuthMessage("Logged in successfully.");
      setLoginPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to log in right now.");
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function onLogout() {
    setIsLoggingOut(true);
    setAuthError(null);
    setAuthMessage(null);

    try {
      await signOut({ redirect: false });
      setAuthMessage("Logged out successfully.");
    } catch {
      setAuthError("Unable to log out right now.");
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">Account</h2>

        {sessionStatus === "authenticated" ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-700">
              Signed in as <span className="font-semibold text-slate-900">{session.user.email}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void loadAccountData();
                }}
                disabled={isAccountDataLoading}
                className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isAccountDataLoading ? "Refreshing..." : "Refresh account data"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void onLogout();
                }}
                disabled={isLoggingOut}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isLoggingOut ? "Logging out..." : "Log out"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void deleteAccount();
                }}
                disabled={isDeleteAccountLoading}
                className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isDeleteAccountLoading ? "Deleting account..." : "Delete account"}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <form className="space-y-3" onSubmit={onSignUpSubmit}>
              <h3 className="text-sm font-semibold text-slate-900">Sign up</h3>
              <input
                type="email"
                value={signUpEmail}
                onChange={(event) => setSignUpEmail(event.target.value)}
                placeholder="Email"
                required
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none ring-sky-500 transition focus:ring-2"
              />
              <input
                type="password"
                value={signUpPassword}
                onChange={(event) => setSignUpPassword(event.target.value)}
                placeholder="Password (min 8 characters)"
                required
                minLength={8}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none ring-sky-500 transition focus:ring-2"
              />
              <button
                type="submit"
                disabled={isSigningUp}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSigningUp ? "Creating account..." : "Create account"}
              </button>
            </form>

            <form className="space-y-3" onSubmit={onLoginSubmit}>
              <h3 className="text-sm font-semibold text-slate-900">Log in</h3>
              <input
                type="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                placeholder="Email"
                required
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none ring-sky-500 transition focus:ring-2"
              />
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="Password"
                required
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none ring-sky-500 transition focus:ring-2"
              />
              <button
                type="submit"
                disabled={isLoggingIn}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isLoggingIn ? "Logging in..." : "Log in"}
              </button>
            </form>
          </div>
        )}

        {authMessage ? <p className="mt-4 text-sm text-emerald-700">{authMessage}</p> : null}
        {authError ? <p className="mt-4 text-sm text-rose-700">{authError}</p> : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          AI Citation Finder &amp; Generator
        </h1>
        <p className="mt-3 max-w-2xl text-slate-700">
          Discover credible academic sources with OpenAlex, then open a source
          to summarize and cite.
        </p>

        <form className="mt-6 space-y-5" onSubmit={onSubmit}>
          <fieldset>
            <legend className="text-sm font-semibold text-slate-900">Start mode</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-required>
              {START_MODES.map((mode) => (
                <label
                  key={mode.value}
                  className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-3 hover:border-slate-300"
                >
                  <input
                    type="radio"
                    name="startMode"
                    value={mode.value}
                    checked={startMode === mode.value}
                    onChange={() => setStartMode(mode.value)}
                    className="mt-1 h-4 w-4"
                    required
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{mode.label}</span>
                    <span className="mt-1 block text-xs text-slate-600">{mode.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="query" className="block text-sm font-semibold text-slate-900">
              {startMode === "claim-to-source" ? "Claim or thesis" : "Topic"}
            </label>
            <p className="mt-1 text-xs text-slate-600">{modeHint}</p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <input
                id="query"
                name="query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  startMode === "claim-to-source"
                    ? "Example: Remote work improves software team productivity"
                    : "Example: effects of sleep deprivation on memory"
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-sky-500 transition focus:ring-2"
              />
              <button
                type="submit"
                disabled={isLoading || isPlanning || isClaimMatching}
                className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isLoading
                  ? "Searching..."
                  : isPlanning
                    ? "Planning..."
                    : isClaimMatching
                      ? "Matching..."
                      : startMode === "claim-to-source"
                        ? "Match claim"
                        : "Search"}
              </button>
            </div>
          </div>
        </form>
      </section>

      {researchPlan ? (
        <section className="rounded-2xl border border-sky-200 bg-sky-50 p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Research plan</h2>
              <p className="mt-1 text-sm text-slate-700">
                Review the refined question and pick a suggested search query, or continue with the original query.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void searchWithOriginalResearchQuery();
              }}
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            >
              Search original query
            </button>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-sky-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                Refined question
              </p>
              <p className="mt-2 text-sm text-slate-800">{researchPlan.refinedQuestion}</p>
            </div>
            <div className="rounded-xl border border-sky-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Keywords</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {researchPlan.keywords.map((keyword) => (
                  <span key={keyword} className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-800">
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-sky-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Synonyms</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {researchPlan.synonyms.map((synonym) => (
                  <span key={synonym} className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-800">
                    {synonym}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-sky-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
              Suggested queries
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {researchPlan.suggestedQueries.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    void searchWithSuggestion(suggestion);
                  }}
                  className="rounded-full border border-slate-300 px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

          <p className="mt-4 text-xs text-slate-600">
            Original query: <span className="font-semibold text-slate-800">{researchPlan.originalQuery}</span>
          </p>
        </section>
      ) : null}

      {planErrorMessage ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 shadow-sm">
          <p className="text-sm font-semibold">Research plan unavailable</p>
          <p className="mt-1 text-sm">{planErrorMessage}</p>
          <p className="mt-2 text-xs">
            The app automatically continued with a standard search so your workflow is not blocked.
          </p>
        </section>
      ) : null}

      {startMode === "claim-to-source" && (claimMatches.length > 0 || claimRetrievalQueries.length > 0 || claimMatchError) ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Claim matches</h2>
              <p className="mt-1 text-sm text-slate-700">
                Ranked sources for the claim you entered. Pick a retrieval query to continue searching.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void requestClaimMatches(query.trim());
              }}
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            >
              Retry claim matching
            </button>
          </div>

          {claimMatchError ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {claimMatchError}
            </p>
          ) : null}

          {claimRefinedQuestion ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Refined question
              </p>
              <p className="mt-2 text-sm text-slate-800">{claimRefinedQuestion}</p>
            </div>
          ) : null}

          {claimKeywords.length > 0 ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Keywords</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {claimKeywords.map((keyword) => (
                  <span key={keyword} className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {claimRetrievalQueries.length > 0 ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Retrieval queries
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {claimRetrievalQueries.map((retrievalQuery) => (
                  <button
                    key={retrievalQuery}
                    type="button"
                    onClick={() => {
                      setQuery(retrievalQuery);
                      void performSearch(retrievalQuery);
                    }}
                    className="rounded-full border border-slate-300 px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
                  >
                    Search: {retrievalQuery}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Guest citation history</h2>
            <p className="mt-1 text-sm text-slate-600">
              Stored locally on this device using browser local storage.
            </p>
          </div>
          <button
            type="button"
            onClick={clearGuestCitationHistoryList}
            disabled={guestCitationHistory.length === 0}
            className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear history
          </button>
        </div>

        {guestCitationHistory.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">
            No guest citation history yet. Generated citations will appear here.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {guestCitationHistory.map((item) => (
              <article key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-700">
                  <span className="rounded bg-white px-2 py-1">{item.style}</span>
                  <span>{formatHistoryTimestamp(item.createdAt)}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-slate-900">{item.sourceTitle}</p>
                <p className="mt-1 text-sm text-slate-800">{item.citationText}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      {sessionStatus === "authenticated" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Saved data and history</h2>
              <p className="mt-1 text-sm text-slate-600">
                Manage saved sources, saved citations, and search history.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void clearUserHistory();
              }}
              disabled={isClearingHistory}
              className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isClearingHistory ? "Clearing history..." : "Clear history"}
            </button>
          </div>

          {accountDataError ? <p className="mt-3 text-sm text-rose-700">{accountDataError}</p> : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-sm font-semibold text-slate-900">Search history ({searchHistory.length})</h3>
              {searchHistory.length === 0 ? (
                <p className="mt-2 text-xs text-slate-600">No saved search history yet.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {searchHistory.map((item) => (
                    <div key={item.id} className="rounded border border-slate-200 bg-white p-2">
                      <p className="text-xs font-semibold text-slate-900">{item.query}</p>
                      <p className="mt-1 text-xs text-slate-600">{item.startMode}</p>
                      <p className="text-xs text-slate-500">{formatHistoryTimestamp(item.createdAt)}</p>
                      <button
                        type="button"
                        onClick={() => {
                          void deleteHistoryItem(item.id, "search");
                        }}
                        className="mt-2 rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-sm font-semibold text-slate-900">Saved sources ({savedSources.length})</h3>
              {savedSources.length === 0 ? (
                <p className="mt-2 text-xs text-slate-600">No saved sources yet.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {savedSources.map((item) => (
                    <div key={item.id} className="rounded border border-slate-200 bg-white p-2">
                      <p className="text-xs font-semibold text-slate-900">{item.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatHistoryTimestamp(item.createdAt)}</p>
                      <button
                        type="button"
                        onClick={() => {
                          void deleteSavedSourceItem(item.id);
                        }}
                        className="mt-2 rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Saved citations ({savedCitations.length})
              </h3>
              {savedCitations.length === 0 ? (
                <p className="mt-2 text-xs text-slate-600">No saved citations yet.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {savedCitations.map((item) => (
                    <div key={item.id} className="rounded border border-slate-200 bg-white p-2">
                      <p className="text-xs font-semibold text-slate-900">{item.sourceTitle}</p>
                      <p className="mt-1 text-xs text-slate-700">{item.citationText}</p>
                      <p className="mt-1 text-xs text-slate-500">{item.style}</p>
                      <button
                        type="button"
                        onClick={() => {
                          void deleteSavedCitationItem(item.id);
                        }}
                        className="mt-2 rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>

          <article className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Enhanced queries ({enhancedQueries.length})
            </h3>
            {enhancedQueries.length === 0 ? (
              <p className="mt-2 text-xs text-slate-600">No enhanced query history yet.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {enhancedQueries.map((item) => (
                  <div key={item.id} className="rounded border border-slate-200 bg-white p-2">
                    <p className="text-xs font-semibold text-slate-900">{item.originalQuery}</p>
                    <p className="mt-1 text-xs text-slate-700">{item.refinedQuestion}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatHistoryTimestamp(item.createdAt)}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void deleteHistoryItem(item.id, "enhanced");
                      }}
                      className="mt-2 rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>
      ) : null}

      {sessionStatus === "authenticated" && isAccountDataLoading ? (
        <LoadingState title="Loading account data" message="Restoring saved sources and history." />
      ) : null}

      {isLoading || isPlanning || isClaimMatching ? (
        <LoadingState
          title={
            isClaimMatching
              ? "Ranking claim matches"
              : isPlanning
                ? "Building research plan"
                : "Searching OpenAlex"
          }
          message={
            isClaimMatching
              ? "Fetching candidate sources, scoring them against your claim, and keeping the source list usable while the match completes."
              : isPlanning
                ? "Reviewing your topic and preparing a refined search path."
                : "Finding relevant academic sources for your query."
          }
        />
      ) : null}

      {!isLoading && errorMessage ? (
        <ErrorState
          title="Search unavailable"
          message={errorMessage}
          actionLabel="Retry"
          onAction={() => {
            void runSearch();
          }}
        />
      ) : null}

      {!isLoading && !errorMessage && hasSearched && results.length === 0 ? (
        <EmptyState
          title={startMode === "claim-to-source" ? "No ranked matches found" : "No sources found"}
          message={
            startMode === "claim-to-source"
              ? "Try a broader claim, or switch to regular search if you want to browse the wider source list first."
              : "Try broader terms, fewer keywords, or a more general phrasing of your topic."
          }
          actionLabel="Search again"
          onAction={() => {
            void runSearch();
          }}
        />
      ) : null}

      {!isLoading && !errorMessage && results.length > 0 ? (
        <section className="grid gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm text-slate-700">
                  Selected sources on this page: <span className="font-semibold text-slate-900">{selectedSourceIds.length}</span>
                </p>
                <p className="text-xs text-slate-500">
                  Showing page {resultsPage} of {totalResultPages} · {resultsTotalCount || results.length} total results
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:items-end">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs font-semibold text-slate-700" htmlFor="results-limit">
                    Results per page
                  </label>
                  <select
                    id="results-limit"
                    value={resultsLimit}
                    onChange={(event) => {
                      const nextLimit = Number.parseInt(event.target.value, 10) as (typeof RESULT_LIMIT_OPTIONS)[number];
                      if (!RESULT_LIMIT_OPTIONS.includes(nextLimit)) {
                        return;
                      }

                      void rerunCurrentQuery(1, nextLimit);
                    }}
                    className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800"
                  >
                    {RESULT_LIMIT_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void rerunCurrentQuery(Math.max(1, resultsPage - 1), resultsLimit);
                    }}
                    disabled={resultsPage <= 1 || isLoading || isClaimMatching}
                    className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void rerunCurrentQuery(resultsPage + 1, resultsLimit);
                    }}
                    disabled={(!resultsHasMore && resultsPage >= totalResultPages) || isLoading || isClaimMatching}
                    className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedSourceIds(results.map((source) => source.id))}
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSourceIds([]);
                    setBatchCitations([]);
                    setBatchCitationError(null);
                    setBatchCopyStatus("idle");
                  }}
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void generateBatchCitations();
                  }}
                  disabled={isBatchCitationLoading}
                  className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isBatchCitationLoading ? "Generating list..." : "Generate citation list"}
                </button>
              </div>
            </div>

            {batchCitationError ? (
              <p className="mt-3 text-sm text-rose-700">{batchCitationError}</p>
            ) : null}

            {batchCitations.length > 0 ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Alphabetical citation list ({citationStyle})
                </p>
                <div className="mt-2 space-y-3 text-sm text-slate-800">
                  {batchCitations.map((item) => (
                    <div key={item.sourceId}>
                      <p>{item.citationText}</p>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void copyBatchCitationList();
                  }}
                  className="mt-3 rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  Copy full citation list
                </button>
                {batchCopyStatus === "success" ? (
                  <p className="mt-2 text-xs text-emerald-700">Citation list copied.</p>
                ) : null}
                {batchCopyStatus === "error" ? (
                  <p className="mt-2 text-xs text-rose-700">Copy failed. Please copy manually.</p>
                ) : null}
              </div>
            ) : null}
          </div>

          {results.map((source) => (
            <article
              key={source.id}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">{source.title}</h2>
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={selectedSourceIds.includes(source.id)}
                    onChange={() => toggleSourceSelection(source.id)}
                    className="h-4 w-4"
                  />
                  Select
                </label>
              </div>

              {startMode === "claim-to-source" ? (() => {
                const claimMatch = claimMatchBySourceId.get(source.id);
                if (!claimMatch) {
                  return null;
                }

                return (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                      <span>Claim match</span>
                      <span className="rounded-full bg-white px-2 py-1 normal-case tracking-normal text-slate-800">
                        Score {claimMatch.score.toFixed(0)}
                      </span>
                      <span className="rounded-full bg-white px-2 py-1 normal-case tracking-normal text-slate-800">
                        {claimMatch.confidence}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-800">{claimMatch.rationale}</p>
                  </div>
                );
              })() : null}

              <dl className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                <div>
                  <dt className="font-semibold text-slate-900">Authors</dt>
                  <dd>{formatAuthors(source.authors)}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-900">Publication date</dt>
                  <dd>{formatPublicationDate(source.publicationDate)}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-900">Citation count</dt>
                  <dd>{source.citationCount}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-900">External link</dt>
                  <dd>
                    {source.externalUrl ? (
                      <a
                        href={source.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-700 underline underline-offset-2 hover:text-sky-900"
                      >
                        Open source
                      </a>
                    ) : (
                      <span>Unavailable</span>
                    )}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={() => {
                  toggleSourceDetails(source.id);
                }}
                className="mt-4 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                aria-pressed={expandedSourceIds.includes(source.id)}
              >
                {expandedSourceIds.includes(source.id) ? "Close details" : "Open details"}
              </button>

              {sessionStatus === "authenticated" ? (
                <button
                  type="button"
                  onClick={() => {
                    void saveSourceForUser(source);
                  }}
                  disabled={savingSourceIds.includes(source.id)}
                  className="mt-2 ml-2 rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {savingSourceIds.includes(source.id)
                    ? "Saving source..."
                    : savedSourceOpenAlexIds.has(source.id)
                      ? "Source saved"
                      : "Save source"}
                </button>
              ) : null}

              {expandedSourceIds.includes(source.id) ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-base font-semibold text-slate-900">Source detail</h3>
                  <p className="mt-2 text-sm text-slate-700">{buildMetadataSummary(source)}</p>

                  <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <label
                        className="block text-sm font-semibold text-slate-900"
                        htmlFor={`citation-style-${source.id}`}
                      >
                        Citation style
                        <select
                          id={`citation-style-${source.id}`}
                          className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                          value={citationStyle}
                          onChange={(event) => setCitationStyle(event.target.value as CitationStyle)}
                        >
                          {CITATION_STYLE_VALUES.map((style) => (
                            <option key={style} value={style}>
                              {style}
                            </option>
                          ))}
                        </select>
                      </label>

                      <button
                        type="button"
                        onClick={() => {
                          void generateCitationForSource(source);
                        }}
                        disabled={citationLoadingSourceId === source.id}
                        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {citationLoadingSourceId === source.id ? "Generating..." : "Generate citation"}
                      </button>
                    </div>

                    {citationErrorsBySource[source.id] ? (
                      <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                        <p>{citationErrorsBySource[source.id]}</p>
                        <button
                          type="button"
                          onClick={() => {
                            void generateCitationForSource(source);
                          }}
                          className="mt-2 rounded bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-600"
                        >
                          Retry citation
                        </button>
                      </div>
                    ) : null}

                    {citationTextsBySource[source.id] ? (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Style: {citationStyle}
                        </p>
                        <p className="mt-2 text-sm text-slate-800">{citationTextsBySource[source.id]}</p>
                        <button
                          type="button"
                          onClick={() => {
                            void copyCitationForSource(source.id);
                          }}
                          className="mt-3 rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                        >
                          Copy citation
                        </button>
                        {copyStatusBySource[source.id] === "success" ? (
                          <p className="mt-2 text-xs text-emerald-700">Copied to clipboard.</p>
                        ) : null}
                        {copyStatusBySource[source.id] === "error" ? (
                          <p className="mt-2 text-xs text-rose-700">Copy failed. Please copy manually.</p>
                        ) : null}
                        {sessionStatus === "authenticated" ? (
                          <button
                            type="button"
                            onClick={() => {
                              void saveCitationForUser(source);
                            }}
                            disabled={savingCitationSourceIds.includes(source.id)}
                            className="mt-2 rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {savingCitationSourceIds.includes(source.id)
                              ? "Saving citation..."
                              : "Save citation"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
