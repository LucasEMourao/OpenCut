import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/env";
import { baseRateLimit } from "@/lib/rate-limit";
import type { SoundEffect } from "@/types/sounds";
import { localSoundLibrary } from "@/data/sounds-library";

const searchParamsSchema = z.object({
  q: z.string().max(500, "Query too long").optional(),
  type: z.enum(["songs", "effects"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  page_size: z.coerce.number().int().min(1).max(150).default(20),
  sort: z
    .enum(["downloads", "rating", "created", "score"])
    .default("downloads"),
  min_rating: z.coerce.number().min(0).max(5).default(3),
  commercial_only: z.coerce.boolean().default(true),
});

const transformedResultSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  url: z.string(),
  previewUrl: z.string().optional(),
  downloadUrl: z.string().optional(),
  duration: z.number(),
  filesize: z.number(),
  type: z.string(),
  channels: z.number(),
  bitrate: z.number(),
  bitdepth: z.number(),
  samplerate: z.number(),
  username: z.string(),
  tags: z.array(z.string()),
  license: z.string(),
  created: z.string(),
  downloads: z.number().optional(),
  rating: z.number().optional(),
  ratingCount: z.number().optional(),
});

const apiResponseSchema = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(transformedResultSchema),
  query: z.string().optional(),
  type: z.string(),
  page: z.number(),
  pageSize: z.number(),
  sort: z.string(),
  minRating: z.number().optional(),
});

type SortKey = z.infer<typeof searchParamsSchema>["sort"];

const COMMERCIAL_LICENSE_KEYWORDS = [
  "commercial",
  "royalty",
  "cc0",
  "public domain",
];

function matchesQuery(sound: SoundEffect, query?: string) {
  if (!query) return true;

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  const haystack = [
    sound.name,
    sound.description,
    sound.username,
    sound.tags.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

function isCommercialLicense(license: string) {
  const normalized = license.toLowerCase();
  return COMMERCIAL_LICENSE_KEYWORDS.some((keyword) =>
    normalized.includes(keyword)
  );
}

function sortSounds(sounds: SoundEffect[], sort: SortKey) {
  const sorter: Record<SortKey, (a: SoundEffect, b: SoundEffect) => number> = {
    downloads: (a, b) => (b.downloads ?? 0) - (a.downloads ?? 0),
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
    created: (a, b) =>
      new Date(b.created).getTime() - new Date(a.created).getTime(),
    score: (a, b) =>
      (b.rating ?? 0) * (b.ratingCount ?? 0) -
      (a.rating ?? 0) * (a.ratingCount ?? 0),
  };

  return [...sounds].sort(sorter[sort]);
}

function getPageLink(request: NextRequest, page: number) {
  const url = new URL(request.url);
  url.searchParams.set("page", page.toString());
  return url.toString();
}

export async function GET(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for") ?? "anonymous";
    const shouldBypassRateLimit = env.NODE_ENV === "development";

    if (!shouldBypassRateLimit) {
      const { success } = await baseRateLimit.limit(ip);

      if (!success) {
        return NextResponse.json(
          { error: "Too many requests" },
          { status: 429 }
        );
      }
    }

    const { searchParams } = new URL(request.url);

    const validationResult = searchParamsSchema.safeParse({
      q: searchParams.get("q") || undefined,
      type: searchParams.get("type") || undefined,
      page: searchParams.get("page") || undefined,
      page_size: searchParams.get("page_size") || undefined,
      sort: searchParams.get("sort") || undefined,
      min_rating: searchParams.get("min_rating") || undefined,
      commercial_only: searchParams.get("commercial_only") || undefined,
    });

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Invalid parameters",
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const {
      q: query,
      type,
      page,
      page_size: pageSize,
      sort,
      min_rating,
      commercial_only,
    } = validationResult.data;

    if (type === "songs") {
      return NextResponse.json(
        {
          error: "Songs are not available yet",
          message:
            "Song search functionality is coming soon. Try searching for sound effects instead.",
        },
        { status: 501 }
      );
    }

    const filteredSounds = localSoundLibrary.filter((sound) => {
      if (type && sound.type !== type) return false;
      if (!matchesQuery(sound, query)) return false;
      if (typeof min_rating === "number" && sound.rating < min_rating) {
        return false;
      }

      if (
        commercial_only &&
        sound.license &&
        !isCommercialLicense(sound.license)
      ) {
        return false;
      }

      return true;
    });

    const sortedSounds = sortSounds(filteredSounds, sort);
    const startIndex = (page - 1) * pageSize;
    const paginatedResults = sortedSounds.slice(
      startIndex,
      startIndex + pageSize
    );

    const totalCount = filteredSounds.length;
    const totalPages = pageSize > 0 ? Math.ceil(totalCount / pageSize) : 0;

    const responseData = {
      count: totalCount,
      next: page < totalPages ? getPageLink(request, page + 1) : null,
      previous: page > 1 ? getPageLink(request, page - 1) : null,
      results: paginatedResults,
      query: query || "",
      type: type || "effects",
      page,
      pageSize,
      sort,
      minRating: min_rating,
    };

    const responseValidation = apiResponseSchema.safeParse(responseData);
    if (!responseValidation.success) {
      console.error(
        "Invalid API response structure:",
        responseValidation.error
      );
      return NextResponse.json(
        { error: "Internal response formatting error" },
        { status: 500 }
      );
    }

    return NextResponse.json(responseValidation.data);
  } catch (error) {
    console.error("Error searching sounds:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
