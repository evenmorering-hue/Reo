export type RenderStatus =
  | "idle"
  | "queued"
  | "rendering"
  | "done"
  | "error";

export interface AudioSegment {
  start: number;
  duration: number;
}

export interface ShortItem {
  index: number;
  caption: string;
  withTextFile: File | null;
  cleanFile: File | null;
  segment: AudioSegment | null;
  status: RenderStatus;
  progress: number;
  videoUrl?: string;
  videoBlob?: Blob;
  error?: string;
}

export interface DayPlan {
  label: string;
  dateLabel: string;
  items: ShortItem[];
}
