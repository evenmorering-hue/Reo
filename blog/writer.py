"""Claude Code(구독 로그인)를 헤드리스로 불러 오늘의 글을 post.json으로 받는다."""
import json
import os
import re
import shutil
import subprocess
from datetime import date
from pathlib import Path

from common import PROMPTS, ROOT, SAMPLES, TYPE_LABELS

SCHEMA = """{
  "topic_id": "사용한 주제 id (운영형에서 새 제목을 만들었으면 후보 중 가장 가까운 id)",
  "title": "네이버 검색용 제목. 대표 키워드를 앞쪽에. 25~35자",
  "thumbnail_title": "썸네일에 크게 들어갈 짧은 문구. 두 줄 이하, 줄바꿈은 \\n",
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "sections": [
    {"type": "paragraph", "text": "문단. 1~3문장"},
    {"type": "heading", "text": "소제목"},
    {"type": "image", "ref": "card1"},
    {"type": "image", "ref": "photo1"}
  ],
  "cards": [
    {"id": "card1", "heading": "카드 제목", "points": ["요약 한 줄", "요약 한 줄", "요약 한 줄"]}
  ],
  "photo_captions": {"photo1": "파일 이름에서 알 수 있는 내용만 쓴 짧은 설명"},
  "sources": [{"title": "출처 이름", "url": "https://..."}]
}"""


def build_prompt(cfg: dict, day: date, post_type: str, candidates: list[dict],
                 memo: str | None, photos: list[Path], n_cards: int, out_path: Path) -> str:
    sample_files = [p.name for p in SAMPLES.glob("*") if p.suffix in {".txt", ".md"}]
    lines = [
        f"너는 {cfg['brand_name']} 네이버 블로그의 글을 쓰는 작가다.",
        f"1) 먼저 {PROMPTS / 'writing_guide.md'} 를 Read 도구로 끝까지 읽고 모든 규칙을 따른다.",
    ]
    if sample_files:
        lines.append(f"2) {SAMPLES} 폴더의 기존 글({', '.join(sample_files)})을 읽고 어투와 구성을 그대로 따라간다.")
    lines += [
        "",
        f"오늘 날짜: {day.isoformat()}",
        f"글 유형: {TYPE_LABELS[post_type]}",
    ]
    if post_type == "operation":
        lines += [
            "주제 후보 (원장 메모에 가장 잘 맞는 것 하나를 고르고, 필요하면 메모에 맞게 제목을 다듬어라):",
            *[f"- {t['id']}: {t['title']} (키워드: {t['keyword']})" for t in candidates],
            "",
            "이번 주 원장 메모 (이 메모에 적힌 사실만 사용한다. 메모에 없는 일화, 대사, 인물은 절대 지어내지 않는다):",
            memo or "",
        ]
    else:
        t = candidates[0]
        lines += [f"주제: {t['id']}: {t['title']}", f"대표 키워드: {t['keyword']}"]
        lines.append("필요하면 WebSearch/WebFetch로 공식 출처(국민건강보험공단, 보건복지부, 질병관리청 등)를 조사한다. "
                     "숫자와 제도는 확인된 것만 쓰고, 참고한 출처를 sources에 넣는다.")
    if cfg.get("consult_contact"):
        lines.append(f"상담 안내에 넣을 연락처: {cfg['consult_contact']}")
    lines += [
        "",
        f"이미지: 정보 카드 {n_cards}장(card1~card{n_cards})을 cards에 만들고 sections에 한 번씩 배치한다.",
    ]
    if photos:
        lines.append("실제 사진도 sections에 한 번씩 배치한다:")
        lines += [f"- photo{i}: 파일 이름 '{p.stem}'" for i, p in enumerate(photos, 1)]
    else:
        lines.append("실제 사진은 없다. photo 이미지는 넣지 않는다.")
    lines += [
        "",
        f"완성한 글을 아래 스키마의 JSON 하나로 Write 도구를 사용해 {out_path} 에 저장한다.",
        "JSON 밖의 설명은 파일에 넣지 않는다. 문자열 안에 별표, 샵, 마크다운 기호, 이모지를 쓰지 않는다.",
        SCHEMA,
        "",
        "저장을 마치면 '완료' 한 단어만 출력한다.",
    ]
    return "\n".join(lines)


def run_claude(prompt: str, timeout_min: int, logger, extra_args: list[str] | None = None,
               tools: str = "Read,Write,Glob,WebSearch,WebFetch") -> str:
    exe = shutil.which("claude")
    if not exe:
        raise RuntimeError("claude 명령을 찾을 수 없습니다. Claude Code가 설치되어 있고 로그인했는지 확인하세요.")
    env = dict(os.environ)
    if env.pop("ANTHROPIC_API_KEY", None):
        logger.warning("ANTHROPIC_API_KEY 환경변수를 무시합니다 (API 과금이 아닌 구독 로그인으로 실행).")
    args = [exe, "-p",
            "--permission-mode", "acceptEdits",
            "--allowedTools", tools,
            *(extra_args or [])]
    logger.info("Claude Code 실행 중...")
    proc = subprocess.run(args, input=prompt, text=True, encoding="utf-8", capture_output=True,
                          cwd=ROOT, env=env, timeout=timeout_min * 60)
    if proc.returncode != 0:
        raise RuntimeError(f"claude 실행 실패 (code {proc.returncode}): {proc.stderr.strip()[-800:]}")
    return proc.stdout.strip()


_STRIP = re.compile(r"[*#`|]|\[\^?\d+\]")


def clean(text: str) -> str:
    text = _STRIP.sub("", text)
    text = re.sub(r"^\s*[-•·]\s+", "", text, flags=re.M)
    return re.sub(r"[ \t]+", " ", text).strip()


def validate(post: dict, n_cards: int, n_photos: int) -> dict:
    for key in ("title", "tags", "sections", "cards"):
        if not post.get(key):
            raise ValueError(f"post.json에 '{key}'가 없습니다")
    post["title"] = clean(post["title"])
    post["thumbnail_title"] = clean(post.get("thumbnail_title") or post["title"])
    post["tags"] = [clean(t).replace(" ", "") for t in post["tags"] if clean(t)][:5]
    cards = {c["id"]: c for c in post["cards"]}
    for c in cards.values():
        c["heading"] = clean(c["heading"])
        c["points"] = [clean(p) for p in c["points"] if clean(p)][:4]
    valid_refs = set(cards) | {f"photo{i}" for i in range(1, n_photos + 1)}
    sections, seen = [], set()
    for s in post["sections"]:
        if s.get("type") == "image":
            ref = s.get("ref")
            if ref in valid_refs and ref not in seen:
                sections.append({"type": "image", "ref": ref})
                seen.add(ref)
        elif s.get("type") in ("paragraph", "heading") and clean(s.get("text", "")):
            sections.append({"type": s["type"], "text": clean(s["text"])})
    # 본문에서 빠진 이미지는 소제목 앞에 고르게 끼워 넣는다
    missing = [r for r in sorted(valid_refs) if r not in seen]
    for n, ref in enumerate(missing):
        # 앞뒤가 이미지가 아닌 문단 뒤 자리 중에서 본문 전체에 고르게 고른다
        slots = [i + 1 for i, s in enumerate(sections) if s["type"] == "paragraph"
                 and (i + 1 == len(sections) or sections[i + 1]["type"] != "image")
                 and (i == 0 or sections[i - 1]["type"] != "image")]
        pos = slots[len(slots) * (n + 1) // (len(missing) + 1)] if slots else len(sections)
        sections.insert(pos, {"type": "image", "ref": ref})
    post["sections"] = sections
    captions = post.get("photo_captions") or {}
    post["photo_captions"] = {k: clean(v) for k, v in captions.items()}
    body_len = sum(len(s["text"]) for s in sections if s["type"] != "image")
    if body_len < 800:
        raise ValueError(f"본문이 너무 짧습니다 ({body_len}자)")
    if len(cards) < n_cards:
        raise ValueError(f"정보 카드가 {n_cards}장 필요하지만 {len(cards)}장뿐입니다")
    return post


def write_post(cfg, day, post_type, candidates, memo, photos, n_cards, out_dir: Path, logger) -> dict:
    out_path = out_dir / "post.json"
    if out_path.exists():
        out_path.unlink()
    prompt = build_prompt(cfg, day, post_type, candidates, memo, photos, n_cards, out_path)
    (out_dir / "prompt.txt").write_text(prompt, encoding="utf-8")
    last_err = None
    for attempt in (1, 2):
        try:
            run_claude(prompt, cfg["claude_timeout_minutes"], logger)
            if not out_path.exists():
                raise RuntimeError("Claude가 post.json을 만들지 않았습니다")
            post = json.loads(out_path.read_text(encoding="utf-8"))
            post = validate(post, n_cards, len(photos))
            out_path.write_text(json.dumps(post, ensure_ascii=False, indent=2), encoding="utf-8")
            return post
        except Exception as e:  # noqa: BLE001 — 한 번 더 시도한다
            last_err = e
            logger.warning(f"글 생성 {attempt}차 실패: {e}")
    raise RuntimeError(f"글 생성 실패: {last_err}")
