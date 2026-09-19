import type { AudioSegment } from "./types";

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!sharedAudioCtx) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    sharedAudioCtx = new Ctx();
  }
  return sharedAudioCtx;
}

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  const arrayBuffer = await file.arrayBuffer();
  // decodeAudioData detaches/consumes the buffer in some browsers, so slice a copy is unnecessary here
  // since we only decode once per file.
  return await ctx.decodeAudioData(arrayBuffer.slice(0));
}

/**
 * Computes RMS energy across the whole track in fixed windows, then greedily
 * picks `count` non-overlapping windows of `segmentDuration` seconds, biased
 * toward higher-energy regions while spreading picks across the timeline so
 * a 10-minute track doesn't collapse into one loud minute.
 */
export function pickEnergeticSegments(
  buffer: AudioBuffer,
  count: number,
  segmentDuration: number,
): AudioSegment[] {
  const sampleRate = buffer.sampleRate;
  const totalDuration = buffer.duration;

  if (totalDuration <= segmentDuration) {
    return Array.from({ length: count }, () => ({
      start: 0,
      duration: Math.min(segmentDuration, totalDuration),
    }));
  }

  // Mix down to mono energy envelope.
  const channelData: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channelData.push(buffer.getChannelData(c));
  }

  const windowSec = 0.5;
  const windowSize = Math.max(1, Math.floor(windowSec * sampleRate));
  const numWindows = Math.floor((buffer.length - windowSize) / windowSize) + 1;
  const energy = new Float32Array(Math.max(numWindows, 1));

  for (let w = 0; w < numWindows; w++) {
    const start = w * windowSize;
    let sumSquares = 0;
    let n = 0;
    for (let c = 0; c < channelData.length; c++) {
      const data = channelData[c];
      for (let i = start; i < start + windowSize && i < data.length; i++) {
        sumSquares += data[i] * data[i];
        n++;
      }
    }
    energy[w] = n > 0 ? Math.sqrt(sumSquares / n) : 0;
  }

  // Energy per candidate segment start (stepping every window) = average
  // energy of the windows it covers.
  const windowsPerSegment = Math.max(1, Math.round(segmentDuration / windowSec));
  const numCandidates = Math.max(1, numWindows - windowsPerSegment + 1);
  const segmentEnergy = new Float32Array(numCandidates);
  for (let s = 0; s < numCandidates; s++) {
    let sum = 0;
    for (let i = 0; i < windowsPerSegment; i++) sum += energy[s + i];
    segmentEnergy[s] = sum / windowsPerSegment;
  }

  const candidateIndexes = Array.from({ length: numCandidates }, (_, i) => i)
    .sort((a, b) => segmentEnergy[b] - segmentEnergy[a]);

  const minGapWindows = windowsPerSegment; // enforce non-overlap
  const chosen: number[] = [];
  for (const idx of candidateIndexes) {
    if (chosen.length >= count) break;
    const tooClose = chosen.some(
      (c) => Math.abs(c - idx) < minGapWindows,
    );
    if (!tooClose) chosen.push(idx);
  }

  // If we couldn't find enough non-overlapping picks (very short/dense
  // tracks), fall back to evenly spaced segments.
  while (chosen.length < count) {
    const t = (chosen.length / count) * (totalDuration - segmentDuration);
    chosen.push(Math.round(t / windowSec));
  }

  chosen.sort((a, b) => a - b);

  return chosen.slice(0, count).map((idx) => {
    const start = Math.min(
      idx * windowSec,
      Math.max(0, totalDuration - segmentDuration),
    );
    return { start, duration: segmentDuration };
  });
}
