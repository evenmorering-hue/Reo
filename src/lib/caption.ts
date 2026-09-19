const WIDTH = 1080;
const HEIGHT = 1920;
const FONT_FAMILY = "Shorts Caption Font";

let fontReady: Promise<void> | null = null;

export function ensureCaptionFontLoaded(): Promise<void> {
  if (!fontReady) {
    fontReady = (async () => {
      const face = new FontFace(
        FONT_FAMILY,
        "url(/fonts/Pretendard-ExtraBold.otf)",
      );
      const loaded = await face.load();
      document.fonts.add(loaded);
    })();
  }
  return fontReady;
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  // Respect user line breaks first, then greedily wrap by word (falls back
  // to character wrapping for languages/strings without spaces).
  const paragraphs = text.split("\n").filter((p) => p.length > 0);
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }

  return lines.length > 0 ? lines : [""];
}

function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
  startSize: number,
  minSize: number,
): { size: number; lines: string[] } {
  for (let size = startSize; size >= minSize; size -= 2) {
    ctx.font = `${size}px ${FONT_FAMILY}`;
    const lines = wrapLines(ctx, text, maxWidth);
    if (lines.length <= maxLines) {
      return { size, lines };
    }
  }
  ctx.font = `${minSize}px ${FONT_FAMILY}`;
  return { size: minSize, lines: wrapLines(ctx, text, maxWidth) };
}

export interface CaptionStyle {
  color?: string;
  strokeColor?: string;
  marginLeft?: number;
  marginTop?: number;
  maxWidth?: number;
  maxLines?: number;
}

/** Renders the caption text as a transparent 1080x1920 PNG, styled to match
 * the reference shorts (bold lime green text with a thick black outline,
 * left-aligned near the top of the frame). */
export async function renderCaptionPng(
  text: string,
  style: CaptionStyle = {},
): Promise<Uint8Array> {
  await ensureCaptionFontLoaded();

  const {
    color = "#CFFF3D",
    strokeColor = "rgba(0,0,0,0.92)",
    marginLeft = 72,
    marginTop = 190,
    maxWidth = WIDTH - marginLeft * 2,
    maxLines = 2,
  } = style;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  const { size, lines } = fitFontSize(
    ctx,
    text.trim(),
    maxWidth,
    maxLines,
    92,
    40,
  );

  const lineHeight = Math.round(size * 1.28);
  const strokeWidth = Math.max(6, Math.round(size * 0.16));

  ctx.font = `${size}px ${FONT_FAMILY}`;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.fillStyle = color;

  lines.forEach((line, i) => {
    const y = marginTop + size + i * lineHeight;
    ctx.strokeText(line, marginLeft, y);
    ctx.fillText(line, marginLeft, y);
  });

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("Failed to encode caption PNG"));
    }, "image/png");
  });

  return new Uint8Array(await blob.arrayBuffer());
}
