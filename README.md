# Shorts Atelier

이미지 2장(텍스트 있는 버전 / 없는 버전)과 음원 파일만으로 유튜브 쇼츠를 자동 생성하는
브라우저 앱입니다. 모든 처리(음원 분석, 자막 렌더링, 영상 인코딩)는 브라우저 안에서만
일어나며, 서버 업로드나 외부 AI API 호출이 없습니다.

## 동작 방식

1. 음원(WAV/MP3)을 불러오면 Web Audio API로 에너지(RMS)를 분석해, 쇼츠 개수만큼
   가장 어울리는 구간을 겹치지 않게 골라냅니다.
2. 텍스트가 있는 이미지와 없는 이미지를 각각 여러 장 올리면 파일명 순서로 서로
   짝지어지고, 문구 textarea의 줄 순서와도 매칭됩니다.
3. 항목마다 ffmpeg.wasm으로 다음을 렌더링합니다.
   - 앞부분: 텍스트가 있는 이미지 + 서서히 확대되는 화면 움직임(Ken Burns)
   - 뒷부분: 텍스트 없는 이미지 + Canvas로 그린 굵은 초록색 자막(페이드인) + 이어지는 확대
   - 선택된 오디오 구간(페이드 인/아웃 포함)
4. 생성된 항목은 평일 기준 하루 3개씩 6일 발행 계획 표로 자동 정렬됩니다. CPU 부담을
   줄이기 위해 배치 단위(기본 3개)로 순차 처리합니다.

## 시작하기

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) 에서 확인할 수 있습니다.

## 주요 구조

- `src/components/ShortsAtelier.tsx` — 메인 UI 및 상태/큐 관리
- `src/lib/audio.ts` — 오디오 디코딩 및 에너지 기반 구간 선택
- `src/lib/caption.ts` — Canvas 기반 자막 PNG 렌더링(Pretendard ExtraBold)
- `src/lib/render.ts` — ffmpeg.wasm 렌더링 파이프라인
- `src/lib/plan.ts` — 평일 기준 6일 발행 계획 그룹핑
- `public/ffmpeg/` — 자체 호스팅한 ffmpeg.wasm 코어(단일 스레드 빌드)
- `public/fonts/` — Pretendard 폰트(OTF)

## 참고

`src/lib/render.ts`는 각 쇼츠를 3단계(타이틀 구간 인코딩 → 자막 구간 인코딩 →
concat demuxer로 스트림 복사 병합)로 렌더링합니다. 하나의 `filter_complex`에서
`zoompan` + 알파 오버레이 + `concat` 필터를 함께 쓰면 ffmpeg.wasm 단일 스레드
코어에서 두 번째 concat 구간의 자막 오버레이가 사라지는 문제가 있어, 이를 피하기
위한 구조입니다.
