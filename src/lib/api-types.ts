import { z } from 'zod';
import { MAX_MARKS, MarkSchema, RunStatsSchema, type Mark, type PlayableLevel, type Review } from '@/lib/schema';

/** ~2.3 MB of base64 per image keeps the whole body under Vercel's 4.5 MB. */
const MAX_IMAGE_CHARS = 2_300_000;
const imageString = z.string().min(100).max(MAX_IMAGE_CHARS);

export const ParseRequestSchema = z.object({
  somImage: imageString,
  cleanImage: imageString,
  marks: z.array(MarkSchema).min(1).max(MAX_MARKS),
});
export type ParseRequest = z.infer<typeof ParseRequestSchema>;

export type ParseResponse = { id: string | null; level: PlayableLevel; marks: Mark[]; ms: number };

export const ReviewRequestSchema = z.object({
  levelId: z.string().uuid().nullable().optional(),
  title: z.string().max(80),
  stats: RunStatsSchema,
});
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
export type ReviewResponse = Review & { source: 'model' | 'canned' };

export type ApiErrorBody = {
  error: { code: string; message: string; retryAfterS?: number };
};

export type SavedLevel = {
  id: string;
  createdAt: string;
  title: string;
  difficulty: number;
  imageUrl: string;
  plays: number;
  wins: number;
  bestTime: number | null;
};

export type SavedLevelDetail = SavedLevel & { level: PlayableLevel; marks: Mark[] };
