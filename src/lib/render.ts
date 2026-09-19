import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type { AudioSegment } from "./types";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 25;

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

export function loadFFmpeg(
  onLog?: (message: string) => void,
): Promise<FFmpeg> {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    if (onLog) {
      ffmpeg.on("log", ({ message }) => onLog(message));
    }
    const baseURL = "/ffmpeg";
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return loadPromise;
}

function extOf(file: File): string {
  const dot = file.name.lastIndexOf(".");
  if (dot === -1) return "jpg";
  return file.name.slice(dot + 1).toLowerCase() || "jpg";
}

let audioLoadedKey: string | null = null;

/** Writes the shared master audio track into ffmpeg's virtual FS once, and
 * reuses it for every subsequent short so we don't re-copy a large file
 * per render. */
async function ensureAudioLoaded(ffmpeg: FFmpeg, audioFile: File) {
  const key = `${audioFile.name}:${audioFile.size}:${audioFile.lastModified}`;
  if (audioLoadedKey === key) return `audio_master.${extOf(audioFile)}`;
  const name = `audio_master.${extOf(audioFile)}`;
  await ffmpeg.writeFile(name, await fetchFile(audioFile));
  audioLoadedKey = key;
  return name;
}

export interface RenderShortParams {
  withTextFile: File;
  cleanFile: File;
  captionPng: Uint8Array;
  audioFile: File;
  segment: AudioSegment;
  onProgress?: (ratio: number) => void;
}

export async function renderShort({
  withTextFile,
  cleanFile,
  captionPng,
  audioFile,
  segment,
  onProgress,
}: RenderShortParams): Promise<Blob> {
  const ffmpeg = ffmpegInstance ?? (await loadFFmpeg());

  const total = segment.duration;
  const titleDur = Math.min(Math.max(total * 0.35, 3), 5);
  const bodyDur = total - titleDur;
  const titleFrames = Math.max(1, Math.round(titleDur * FPS));
  const bodyFrames = Math.max(1, Math.round(bodyDur * FPS));

  const aExt = extOf(withTextFile);
  const bExt = extOf(cleanFile);
  const jobId = Math.random().toString(36).slice(2, 8);
  const aName = `a_${jobId}.${aExt}`;
  const bName = `b_${jobId}.${bExt}`;
  const capName = `cap_${jobId}.png`;
  const segAName = `segA_${jobId}.mp4`;
  const segBName = `segB_${jobId}.mp4`;
  const listName = `list_${jobId}.txt`;
  const outName = `out_${jobId}.mp4`;

  await ffmpeg.writeFile(aName, await fetchFile(withTextFile));
  await ffmpeg.writeFile(bName, await fetchFile(cleanFile));
  await ffmpeg.writeFile(capName, captionPng);
  const audioName = await ensureAudioLoaded(ffmpeg, audioFile);

  const fadeOutStart = Math.max(0, total - 0.4);

  // Three ffmpeg.exec() calls make up one short (segment A encode, segment B
  // encode, final concat+mux); each reports its own 0..1 progress, so we
  // weight them by their share of the total duration to keep the exposed
  // progress roughly monotonic across the whole job.
  const weightA = (titleDur / total) * 0.85;
  const weightB = (bodyDur / total) * 0.85;
  const weightMux = 1 - weightA - weightB;
  let base = 0;
  const runPhase = async (args: string[], weight: number) => {
    const handler = ({ progress }: { progress: number }) => {
      onProgress?.(base + Math.min(1, Math.max(0, progress)) * weight);
    };
    ffmpeg.on("progress", handler);
    try {
      await ffmpeg.exec(args);
    } finally {
      ffmpeg.off("progress", handler);
      base += weight;
    }
  };

  const tempFiles = [aName, bName, capName, segAName, segBName, listName, outName];

  try {
    // Segment A (title card) and segment B (clean image + caption overlay)
    // are each rendered to their own mp4 first, then stitched together with
    // the concat *demuxer* (stream copy). Building both halves in a single
    // filter_complex + concat *filter* graph is what the reference pipeline
    // used originally, but ffmpeg.wasm's single-threaded core silently drops
    // the alpha-overlaid caption from the second concat segment in that
    // setup — rendering the halves separately and stream-copy-concatenating
    // sidesteps that bug entirely.
    await runPhase(
      [
        "-loop", "1", "-t", `${titleDur}`, "-i", aName,
        "-vf", `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},zoompan=z='min(1.0+on*0.0015,1.06)':d=${titleFrames}:s=${WIDTH}x${HEIGHT}:fps=${FPS},setsar=1,format=yuv420p`,
        "-r", `${FPS}`,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-pix_fmt", "yuv420p",
        "-t", `${titleDur}`,
        segAName,
      ],
      weightA,
    );

    await runPhase(
      [
        "-loop", "1", "-t", `${bodyDur}`, "-i", bName,
        "-loop", "1", "-t", `${bodyDur}`, "-i", capName,
        "-filter_complex",
        [
          `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},zoompan=z='min(1.05+on*0.0015,1.18)':d=${bodyFrames}:s=${WIDTH}x${HEIGHT}:fps=${FPS},setsar=1,format=yuv420p[bg]`,
          `[1:v]fps=${FPS},format=rgba,fade=t=in:st=0.15:d=0.6:alpha=1[cap]`,
          `[bg][cap]overlay=x=0:y=0:format=auto,format=yuv420p[out]`,
        ].join(";"),
        "-map", "[out]",
        "-r", `${FPS}`,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-pix_fmt", "yuv420p",
        "-t", `${bodyDur}`,
        segBName,
      ],
      weightB,
    );

    await ffmpeg.writeFile(
      listName,
      new TextEncoder().encode(`file '${segAName}'\nfile '${segBName}'\n`),
    );

    await runPhase(
      [
        "-f", "concat",
        "-safe", "0",
        "-i", listName,
        "-i", audioName,
        "-filter_complex",
        `[1:a]atrim=start=${segment.start}:end=${segment.start + total},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.3,afade=t=out:st=${fadeOutStart}:d=0.4[aout]`,
        "-map", "0:v",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "160k",
        "-t", `${total}`,
        "-movflags", "+faststart",
        outName,
      ],
      weightMux,
    );

    onProgress?.(1);
    const data = await ffmpeg.readFile(outName);
    const bytes = data as Uint8Array;
    return new Blob([bytes.slice()], { type: "video/mp4" });
  } finally {
    for (const name of tempFiles) {
      try {
        await ffmpeg.deleteFile(name);
      } catch {
        // best-effort cleanup
      }
    }
  }
}
