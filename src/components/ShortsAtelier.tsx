"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { decodeAudioFile, pickEnergeticSegments } from "@/lib/audio";
import { renderCaptionPng } from "@/lib/caption";
import { buildDayPlan } from "@/lib/plan";
import { loadFFmpeg, renderShort } from "@/lib/render";
import type { ShortItem } from "@/lib/types";
import { formatClock, naturalSortFiles, sleep } from "@/lib/util";

const SEGMENT_DURATION = 10;
const SAMPLE_LINES = [
  "오늘도 충분히 잘했어요",
  "천천히 가도 괜찮아요",
  "당신의 내일을 응원합니다",
];

type EngineStatus = "idle" | "loading" | "ready" | "error";

export default function ShortsAtelier() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [audioStatus, setAudioStatus] = useState<
    "idle" | "decoding" | "ready" | "error"
  >("idle");

  const [withTextFiles, setWithTextFiles] = useState<File[]>([]);
  const [cleanFiles, setCleanFiles] = useState<File[]>([]);
  const [captionText, setCaptionText] = useState("");

  const [quantitySetting, setQuantitySetting] = useState<"all" | number>("all");
  const [batchSize, setBatchSize] = useState(3);

  const [items, setItems] = useState<ShortItem[]>([]);
  const itemsRef = useRef<ShortItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const [engineStatus, setEngineStatus] = useState<EngineStatus>("idle");
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const processingRef = useRef(false);
  const pendingQueueRef = useRef<number[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off the one-time async engine load
    setEngineStatus("loading");
    loadFFmpeg()
      .then(() => setEngineStatus("ready"))
      .catch(() => setEngineStatus("error"));
  }, []);

  useEffect(() => {
    if (!audioFile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets decode state for the (now absent) audioFile
      setAudioBuffer(null);
      setAudioDuration(null);
      setAudioStatus("idle");
      return;
    }
    setAudioStatus("decoding");
    decodeAudioFile(audioFile)
      .then((buf) => {
        setAudioBuffer(buf);
        setAudioDuration(buf.duration);
        setAudioStatus("ready");
      })
      .catch(() => setAudioStatus("error"));
  }, [audioFile]);

  const captionLines = useMemo(
    () =>
      captionText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    [captionText],
  );

  const sortedWithText = useMemo(() => naturalSortFiles(withTextFiles), [withTextFiles]);
  const sortedClean = useMemo(() => naturalSortFiles(cleanFiles), [cleanFiles]);

  const availableCount = Math.min(
    sortedWithText.length,
    sortedClean.length,
    captionLines.length,
  );

  const quantity =
    quantitySetting === "all"
      ? availableCount
      : Math.min(quantitySetting, availableCount);

  const canBuild =
    !!audioFile && audioStatus === "ready" && availableCount > 0 && engineStatus === "ready";

  function updateItem(index: number, patch: Partial<ShortItem>) {
    itemsRef.current = itemsRef.current.map((it) =>
      it.index === index ? { ...it, ...patch } : it,
    );
    setItems(itemsRef.current);
  }

  function buildItems(): ShortItem[] {
    const segments = audioBuffer
      ? pickEnergeticSegments(audioBuffer, availableCount, SEGMENT_DURATION)
      : [];
    const built: ShortItem[] = Array.from({ length: availableCount }, (_, i) => ({
      index: i,
      caption: captionLines[i],
      withTextFile: sortedWithText[i],
      cleanFile: sortedClean[i],
      segment: segments[i] ?? { start: 0, duration: SEGMENT_DURATION },
      status: "idle",
      progress: 0,
    }));
    itemsRef.current = built;
    setItems(built);
    setSelectedIndex(built.length > 0 ? 0 : null);
    return built;
  }

  async function renderOne(index: number) {
    const item = itemsRef.current.find((it) => it.index === index);
    if (!item || !audioFile || !item.withTextFile || !item.cleanFile || !item.segment) {
      return;
    }
    updateItem(index, { status: "rendering", progress: 0, error: undefined });
    setSelectedIndex(index);
    try {
      const capPng = await renderCaptionPng(item.caption);
      const blob = await renderShort({
        withTextFile: item.withTextFile,
        cleanFile: item.cleanFile,
        captionPng: capPng,
        audioFile,
        segment: item.segment,
        onProgress: (ratio) => updateItem(index, { progress: ratio }),
      });
      const url = URL.createObjectURL(blob);
      updateItem(index, { status: "done", progress: 1, videoBlob: blob, videoUrl: url });
    } catch (e) {
      updateItem(index, {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function processQueue() {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);
    try {
      let doneInBatch = 0;
      while (pendingQueueRef.current.length > 0) {
        const idx = pendingQueueRef.current.shift()!;
        setStatusMessage(`${idx + 1}번 쇼츠 생성 중...`);
        await renderOne(idx);
        doneInBatch++;
        if (doneInBatch % Math.max(1, batchSize) === 0 && pendingQueueRef.current.length > 0) {
          setStatusMessage("CPU 부담을 줄이기 위해 잠시 대기 중...");
          await sleep(500);
        }
      }
      setStatusMessage(null);
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }

  function enqueue(indexes: number[]) {
    for (const idx of indexes) {
      if (!pendingQueueRef.current.includes(idx)) {
        pendingQueueRef.current.push(idx);
      }
      updateItem(idx, { status: "queued" });
    }
    void processQueue();
  }

  function handleGenerateClick() {
    const built = buildItems();
    const qty = quantitySetting === "all" ? built.length : Math.min(quantitySetting, built.length);
    enqueue(built.slice(0, qty).map((it) => it.index));
  }

  function handleFillSample() {
    setCaptionText((prev) => (prev.trim() ? prev : SAMPLE_LINES.join("\n")));
  }

  function handleDayGenerate(dayIndexes: number[]) {
    if (itemsRef.current.length === 0) {
      buildItems();
      // Items just rebuilt synchronously into itemsRef via buildItems().
    }
    enqueue(dayIndexes);
  }

  const perDay = 3;
  const dayPlan = useMemo(() => buildDayPlan(items, perDay), [items]);
  const selectedItem =
    selectedIndex !== null ? items.find((it) => it.index === selectedIndex) ?? null : null;

  return (
    <div className="min-h-screen bg-[#0b0e17] text-slate-100">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-orange-400 text-white">
            ▶
          </div>
          <span className="text-lg font-bold">Shorts Atelier</span>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-400">
          모든 파일은 이 브라우저 안에서만 처리됩니다
        </span>
      </header>

      <main className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-3">
        {/* Column 1: source prep */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <ColumnHeader title="소스 준비" step="01" />

          <FieldCard>
            <label className="flex cursor-pointer items-center gap-3">
              <span className="text-xl">🎵</span>
              <span className="flex-1">
                <div className="font-semibold">음원 불러오기</div>
                <div className="text-xs text-slate-400">
                  WAV 또는 MP3 · 최대 10분
                  {audioStatus === "decoding" && " · 분석 중..."}
                  {audioStatus === "ready" &&
                    audioDuration !== null &&
                    ` · ${formatClock(audioDuration)} 로드됨`}
                  {audioStatus === "error" && " · 분석 실패, 다른 파일을 시도하세요"}
                </div>
              </span>
              <input
                type="file"
                accept="audio/wav,audio/mpeg,.wav,.mp3"
                className="hidden"
                onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </FieldCard>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <FieldCard>
              <div className="font-semibold">원본 텍스트 O</div>
              <div className="mt-1 text-xs text-slate-400">
                글자가 있는 원본 이미지 (여러 장)
              </div>
              <label className="mt-3 inline-block cursor-pointer rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20">
                파일 선택
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setWithTextFiles(Array.from(e.target.files ?? []))}
                />
              </label>
              <div className="mt-2 text-xs text-slate-500">
                {withTextFiles.length > 0 ? `${withTextFiles.length}개 선택됨` : "선택된 파일 없음"}
              </div>
            </FieldCard>
            <FieldCard>
              <div className="font-semibold">원본 텍스트 X</div>
              <div className="mt-1 text-xs text-slate-400">글자를 지운 이미지 (여러 장)</div>
              <label className="mt-3 inline-block cursor-pointer rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20">
                파일 선택
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setCleanFiles(Array.from(e.target.files ?? []))}
                />
              </label>
              <div className="mt-2 text-xs text-slate-500">
                {cleanFiles.length > 0 ? `${cleanFiles.length}개 선택됨` : "선택된 파일 없음"}
              </div>
            </FieldCard>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-slate-400">
            같은 주제의 이미지를 텍스트 있는 버전과 없는 버전으로 각각 올려주세요.
            파일명 순서대로 서로 짝지어지고, 아래 문구와도 순서대로 연결됩니다.
            JPG, PNG, WEBP 지원.
          </p>
          <p className="mt-1 text-xs font-medium text-lime-400">
            이미지 2장으로 제작 · AI API 연결 불필요
          </p>

          <FieldCard className="mt-3">
            <textarea
              value={captionText}
              onChange={(e) => setCaptionText(e.target.value)}
              rows={7}
              placeholder={"쇼츠 문구를 한 줄에 하나씩 붙여넣으세요.\n\n예)\n오늘도 충분히 잘했어요\n천천히 가도 괜찮아요\n당신의 내일을 응원합니다"}
              className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-slate-600"
            />
            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <span>한 줄 = 쇼츠 1개</span>
              <span>
                {captionLines.length} / {Math.max(sortedWithText.length, sortedClean.length, captionLines.length) || 0}
              </span>
            </div>
          </FieldCard>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <SelectField
              label="제작 수량"
              value={quantitySetting === "all" ? "all" : String(quantitySetting)}
              onChange={(v) => setQuantitySetting(v === "all" ? "all" : Number(v))}
              options={[
                { value: "all", label: `전체 ${availableCount || 0}개` },
                { value: "3", label: "3개" },
                { value: "6", label: "6개" },
                { value: "9", label: "9개" },
              ]}
            />
            <SelectField
              label="동시 처리"
              value={String(batchSize)}
              onChange={(v) => setBatchSize(Number(v))}
              options={[
                { value: "1", label: "1개씩" },
                { value: "3", label: "3개씩 · 메모리 부담 줄이기" },
                { value: "6", label: "6개씩" },
              ]}
            />
          </div>

          <p className="mt-2 text-xs text-slate-500">
            제작 중에는 이 탭을 화면에 열어 두세요. 다른 탭으로 이동하면 영상 생성이
            느려지거나 멈출 수 있습니다.
          </p>

          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-slate-500">같은 이미지 쌍·서식으로 제작</span>
            <button
              type="button"
              onClick={handleFillSample}
              className="text-slate-300 underline decoration-dotted underline-offset-2 hover:text-white"
            >
              샘플 문구 채우기
            </button>
          </div>

          <button
            type="button"
            disabled={!canBuild || isProcessing}
            onClick={handleGenerateClick}
            className="mt-3 w-full rounded-xl bg-gradient-to-r from-pink-500 to-orange-400 py-3 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {engineStatus === "loading"
              ? "엔진 준비 중..."
              : isProcessing
                ? "생성 중..."
                : `쇼츠 ${quantity || 0}개 편집안 만들기`}
          </button>
        </section>

        {/* Column 2: auto-edit result */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <ColumnHeader title="자동 편집 결과" step="02" />

          {items.length === 0 ? (
            <div className="flex h-[420px] flex-col items-center justify-center gap-4 text-center">
              <RingBadge label={`${SEGMENT_DURATION}s`} progress={0} />
              <div>
                <div className="font-semibold">소스를 넣으면 편집안이 나타납니다</div>
                <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-slate-400">
                  음원의 에너지와 문구의 정서를 비교해 가장 어울리는{" "}
                  {SEGMENT_DURATION}초 구간, 화면 움직임, 자막 타이밍을 자동으로
                  정합니다.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-4">
                <RingBadge
                  label={
                    selectedItem?.status === "rendering"
                      ? `${Math.round((selectedItem.progress ?? 0) * 100)}%`
                      : `${SEGMENT_DURATION}s`
                  }
                  progress={selectedItem?.status === "rendering" ? selectedItem.progress : 0}
                />
                {selectedItem?.videoUrl ? (
                  <video
                    key={selectedItem.videoUrl}
                    src={selectedItem.videoUrl}
                    controls
                    className="aspect-9/16 w-full max-w-[220px] rounded-lg bg-black"
                  />
                ) : (
                  <p className="text-center text-xs text-slate-400">
                    {statusMessage ?? "항목을 선택하면 미리보기가 표시됩니다"}
                  </p>
                )}
                {selectedItem && (
                  <p className="line-clamp-2 text-center text-sm text-slate-200">
                    {selectedItem.caption}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {items.map((item) => (
                  <button
                    key={item.index}
                    type="button"
                    onClick={() => setSelectedIndex(item.index)}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-xs transition ${
                      selectedIndex === item.index
                        ? "border-pink-400/50 bg-pink-400/10"
                        : "border-white/10 bg-black/10 hover:bg-white/5"
                    }`}
                  >
                    <span className="w-6 shrink-0 text-slate-500">
                      {String(item.index + 1).padStart(2, "0")}
                    </span>
                    <span className="flex-1 truncate text-slate-200">{item.caption}</span>
                    <StatusPill status={item.status} progress={item.progress} />
                    {item.videoUrl && (
                      <a
                        href={item.videoUrl}
                        download={`short_${String(item.index + 1).padStart(2, "0")}.mp4`}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-md bg-white/10 px-2 py-1 text-[11px] font-medium hover:bg-white/20"
                      >
                        다운로드
                      </a>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Column 3: 6-day publish plan */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <ColumnHeader title={`${dayPlan.length || 6}일 발행 계획`} step="03" />

          <div className="flex flex-col gap-3">
            {(dayPlan.length > 0
              ? dayPlan
              : buildDayPlan(
                  Array.from({ length: 18 }, (_, i) => ({
                    index: i,
                    caption: "",
                    withTextFile: null,
                    cleanFile: null,
                    segment: null,
                    status: "idle" as const,
                    progress: 0,
                  })),
                  perDay,
                )
            ).map((day, di) => {
              const doneCount = day.items.filter((it) => it.status === "done").length;
              return (
                <div key={di} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">{day.label}</div>
                      <div className="text-xs text-slate-500">{day.dateLabel}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">
                        {doneCount}/{day.items.length || perDay} 완료
                      </span>
                      {items.length > 0 && (
                        <button
                          type="button"
                          onClick={() => handleDayGenerate(day.items.map((it) => it.index))}
                          className="rounded-md bg-white/10 px-2 py-1 text-[11px] font-medium hover:bg-white/20"
                        >
                          이 날짜만 생성
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {day.items.length > 0
                      ? day.items.map((it) => (
                          <button
                            key={it.index}
                            type="button"
                            title={it.caption}
                            onClick={() => setSelectedIndex(it.index)}
                            className={`truncate rounded-md border px-2 py-2 text-left text-[11px] ${
                              it.status === "done"
                                ? "border-lime-400/40 bg-lime-400/10 text-lime-300"
                                : "border-white/10 bg-white/5 text-slate-400"
                            }`}
                          >
                            <div className="font-semibold">
                              {String(it.index + 1).padStart(2, "0")}
                            </div>
                            <div className="truncate">
                              {it.caption || "미등록"}
                            </div>
                          </button>
                        ))
                      : Array.from({ length: perDay }).map((_, i) => (
                          <div
                            key={i}
                            className="rounded-md border border-white/10 bg-white/5 px-2 py-2 text-[11px] text-slate-500"
                          >
                            {String(di * perDay + i + 1).padStart(2, "0")} 미등록
                          </div>
                        ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-slate-400">
            <p className="font-medium text-slate-300">
              하루 {perDay}개 · 주말 제외
            </p>
            <p className="mt-1">
              칸을 누르면 문구를 확인하고 가운데 패널에서 미리 볼 수 있습니다. 체크
              표시는 영상 제작 완료를 뜻하며 실제 게시 여부가 아닙니다. 새로고침하면
              현황이 초기화됩니다. 자동 업로드·예약 발행은 하지 않습니다.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

function ColumnHeader({ title, step }: { title: string; step: string }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-base font-bold">{title}</h2>
      <span className="text-sm font-semibold text-slate-600">{step}</span>
    </div>
  );
}

function FieldCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-white/10 bg-black/20 p-3 ${className}`}>
      {children}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block text-xs">
      <div className="mb-1 text-slate-400">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs text-slate-200 outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#0b0e17]">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function RingBadge({ label, progress }: { label: string; progress: number }) {
  const size = 96;
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(1, Math.max(0, progress)));
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={stroke}
        fill="none"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="url(#ringGradient)"
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <defs>
        <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ec4899" />
          <stop offset="100%" stopColor="#fb923c" />
        </linearGradient>
      </defs>
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        fill="white"
        fontSize="18"
        fontWeight="700"
      >
        {label}
      </text>
    </svg>
  );
}

function StatusPill({ status, progress }: { status: ShortItem["status"]; progress: number }) {
  const map: Record<ShortItem["status"], { text: string; className: string }> = {
    idle: { text: "대기", className: "bg-white/10 text-slate-400" },
    queued: { text: "대기열", className: "bg-white/10 text-slate-300" },
    rendering: {
      text: `생성 중 ${Math.round(progress * 100)}%`,
      className: "bg-orange-400/20 text-orange-300",
    },
    done: { text: "완료", className: "bg-lime-400/20 text-lime-300" },
    error: { text: "오류", className: "bg-red-400/20 text-red-300" },
  };
  const { text, className } = map[status];
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${className}`}>
      {text}
    </span>
  );
}
