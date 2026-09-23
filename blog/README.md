# 나섬요양원 블로그 자동 글쓰기

월~금 하루 한 편, 켜져 있는 Windows 데스크톱에서 자동으로 글을 쓰고 네이버 블로그에 올립니다.

```
[작업 스케줄러 10:35] → 주제 선택 → Claude Code가 자료 조사 + 글 작성
   → 썸네일(브랜드) 1장 + 정보 카드 + 실제 사진 = 이미지 6장
   → 11:00~11:30 사이 무작위 시각에 네이버 게시
      첫 1주: 임시저장만 (직접 확인 후 발행)
      2주차부터: 자동 발행
```

## 요일별 글 유형

| 요일 | 유형 |
|---|---|
| 월 | 정보성: 입소, 비용, 등급 |
| 화 | 보호자 감성형 |
| 수 | 정보성: 어르신 건강관리 |
| 목 | 실제 운영·신뢰형 (원장 메모가 있을 때만, 없으면 건강 정보로 대체) |
| 금 | 체크리스트형: 상담, 견학, 계약 |

주제는 `topics.json`에 67개가 있습니다. 기존 90선에서 겹치는 것을 합치고 번호를 다시 매겼습니다.
계절 주제(여름, 겨울, 감기)는 해당 달에만 나옵니다. 쓴 주제는 `state.json`에 기록되어 반복되지 않습니다.

## 처음 한 번 설정

1. **프로그램 설치**
   - Python 3.11 이상 (설치할 때 "Add python.exe to PATH" 체크)
   - Google Chrome
   - Claude Code (이미 사용 중), 명령 프롬프트에서 `claude` 입력 후 구독 계정으로 로그인되어 있는지 확인
   - Node.js (대체 게시 기능용, 이미 Claude Code 설치에 쓰셨다면 있음)
2. **이 폴더에서 PowerShell을 열고**
   ```
   pip install -r requirements.txt
   python post_naver.py --login
   ```
   열린 Chrome 창에서 네이버에 로그인하고 Enter. 이 로그인은 전용 프로필에 저장되어 유지됩니다.
3. **자료 넣기**
   - `assets/profile.png` : 블로그 프로필 사진 (썸네일 브랜드 표시용)
   - `samples/` : 기존에 올린 글 본문 2~3개를 .txt로 (어투 학습용)
   - `photos/` : 나섬요양원 실제 사진. 파일 이름을 내용대로 지어 주세요 (예: `거실 오후 햇살.jpg`).
     어르신 얼굴이 나온 사진은 동의를 받았거나 가린 것만 넣어 주세요. 적게 쓴 사진부터 한 번에 2장씩 씁니다.
   - `config.json`의 `consult_contact` : 상담 안내에 넣을 전화번호
4. **시험 실행**
   ```
   python run_daily.py --no-delay --dry-run
   ```
   `output/오늘날짜/` 에 글(post.json), 이미지, 확인용.txt가 생깁니다. 게시는 하지 않습니다.
   ```
   python run_daily.py --no-delay --mode draft --force
   ```
   실제로 네이버에 임시저장까지 해 봅니다.
5. **자동 실행 등록**
   ```
   powershell -ExecutionPolicy Bypass -File .\setup_task.ps1
   ```

## 매주 할 일

- 목요일 전까지 `memo/this_week.md` 에 이번 주 있었던 일을 몇 줄 적기 (`this_week.example.md` 참고).
  목요일 글은 이 메모에 적힌 사실만으로 씁니다. AI가 일화를 지어내지 않게 하기 위해서입니다.
- 첫 주에는 매일 임시저장된 글을 확인하고 직접 발행. 태그는 `output/날짜/확인용.txt` 에 있습니다.

## 설정 (config.json)

| 항목 | 뜻 |
|---|---|
| post_hour | 게시 시각(시). 기본 11 |
| random_delay_minutes | 정각에서 무작위로 늦추는 최대 분. 기본 30 |
| draft_only_days | 첫 게시일부터 임시저장만 하는 기간(일). 기본 7 |
| images_per_post / photos_per_post | 이미지 총 장수 / 그중 실제 사진 장수 |
| fallback_post_with_claude | 자동 게시가 실패하면 Claude Code가 브라우저를 직접 조작해 다시 시도 |

post_hour를 바꾸면 `setup_task.ps1` 을 다시 실행하세요.

## 문제가 생기면

- 기록: `logs/날짜.log`, 화면: `output/날짜/error.png`
- "로그인이 풀렸습니다" → `python post_naver.py --login`
- 게시만 다시: `python post_naver.py --dir output/2026-09-28 --mode draft`
- 네이버가 글쓰기 화면을 바꾸면 자동 입력이 깨질 수 있습니다. 이때는 대체 게시(Claude Code 브라우저 조작)가 이어받고,
  그것도 실패하면 로그와 error.png를 Claude에게 보여 주고 고쳐 달라고 하세요.

## 비용

Claude Code를 `claude -p` 로 실행하므로 **Claude 구독(Pro/Max) 사용량** 안에서 동작합니다. 별도 API 요금이 나가지 않습니다.
환경변수 `ANTHROPIC_API_KEY` 가 있으면 API로 과금될 수 있어서, 이 프로그램은 실행할 때 그 변수를 빼고 Claude를 부릅니다.
