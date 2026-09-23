"""월~금 하루 한 편: 주제 선택 → Claude Code로 글 작성 → 이미지 생성 → 무작위 시각에 네이버 게시.

    python run_daily.py                 # 작업 스케줄러가 부르는 기본 실행
    python run_daily.py --no-delay --dry-run   # 게시 없이 글과 이미지만 만들어 확인
"""
import argparse
import hashlib
import json
import os
import random
import sys
import time
from datetime import date, datetime, timedelta

from common import (MEMO_FILE, PROFILE_DIR, PROMPTS, ROOT, TYPE_LABELS, day_dir, load_config,
                    load_json, load_state, save_state, setup_logging)


def read_memo() -> str | None:
    if not MEMO_FILE.exists():
        return None
    lines = [l for l in MEMO_FILE.read_text(encoding="utf-8").splitlines()
             if l.strip() and not l.lstrip().startswith("<!--")]
    text = "\n".join(lines).strip()
    return text or None


def memo_hash(memo: str) -> str:
    return hashlib.sha256(memo.encode("utf-8")).hexdigest()[:16]


def available(topics, used, post_type, month):
    return [t for t in topics if t["type"] == post_type and t["id"] not in used
            and (not t.get("months") or month in t["months"])]


def choose(cfg, state, topics, day, forced_type, logger):
    """(post_type, candidates, memo) 반환"""
    used = set(state["used_topics"])
    post_type = forced_type or cfg["weekday_types"][str(day.weekday())]
    memo = None
    if post_type == "operation":
        memo = read_memo()
        if not memo or memo_hash(memo) in state["used_memo_hashes"]:
            logger.info("이번 주 원장 메모가 없거나 이미 사용했습니다 → 정보성 글로 대체합니다.")
            post_type, memo = "health", None
    order = [post_type] + [t for t in cfg["fallback_type_order"] if t != post_type]
    for t in order:
        cands = available(topics, used, t, day.month)
        if cands:
            if t != post_type:
                logger.info(f"'{TYPE_LABELS[post_type]}' 주제가 소진되어 '{TYPE_LABELS[t]}'로 대체합니다.")
            if t == "operation":
                return t, cands, memo
            return t, [cands[0]], None
    raise RuntimeError("남은 주제가 없습니다. topics.json에 새 주제를 추가하세요.")


def decide_mode(cfg, state, day, override):
    if override:
        return override
    first = date.fromisoformat(state["first_run"]) if state["first_run"] else day
    return "draft" if day < first + timedelta(days=cfg["draft_only_days"]) else "publish"


def claude_fallback_post(cfg, out_dir, mode, logger):
    from writer import run_claude
    mcp_args = ["@playwright/mcp@latest", "--browser", cfg.get("browser_channel") or "chromium",
                "--user-data-dir", str(PROFILE_DIR)]
    server = ({"command": "cmd", "args": ["/c", "npx", *mcp_args]} if os.name == "nt"
              else {"command": "npx", "args": mcp_args})
    mcp_path = out_dir / "mcp.json"
    mcp_path.write_text(json.dumps({"mcpServers": {"playwright": server}}), encoding="utf-8")
    prompt = (PROMPTS / "fallback_post.md").read_text(encoding="utf-8").format(
        post_dir=out_dir, blog_id=cfg["blog_id"], mode=mode)
    out = run_claude(prompt, cfg["claude_timeout_minutes"], logger,
                     extra_args=["--mcp-config", str(mcp_path)], tools="Read,mcp__playwright")
    if "로그인 필요" in out or ("임시저장 완료" not in out and "blog.naver.com" not in out):
        raise RuntimeError(f"대체 게시도 실패: {out[-300:]}")
    return out


def write_review(out_dir, post, mode, target):
    lines = [f"모드: {'임시저장 (직접 확인 후 발행하세요)' if mode == 'draft' else '자동 발행'}",
             f"게시 예정 시각: {target:%H:%M}", "", f"제목: {post['title']}", "",
             "태그 (발행할 때 입력):", "  " + ", ".join(post["tags"]), ""]
    if post.get("sources"):
        lines.append("참고 출처 (숫자, 제도 내용 확인용):")
        lines += [f"  {s.get('title', '')} {s.get('url', '')}" for s in post["sources"]]
    (out_dir / "확인용.txt").write_text("\n".join(lines), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-delay", action="store_true", help="무작위 대기 없이 바로 게시")
    ap.add_argument("--dry-run", action="store_true", help="글과 이미지만 만들고 게시하지 않음")
    ap.add_argument("--mode", choices=["draft", "publish"], help="임시저장/발행 강제")
    ap.add_argument("--type", choices=list(TYPE_LABELS), help="글 유형 강제")
    ap.add_argument("--date", help="날짜 강제 (YYYY-MM-DD, 테스트용)")
    ap.add_argument("--force", action="store_true", help="주말이거나 오늘 이미 게시했어도 실행")
    args = ap.parse_args()

    day = date.fromisoformat(args.date) if args.date else date.today()
    logger = setup_logging(day)
    cfg = load_config()
    state = load_state()

    if day.weekday() >= 5 and not args.force:
        logger.info("주말이라 쉽니다.")
        return 0
    if any(h["date"] == day.isoformat() and h["status"] == "ok" for h in state["history"]) \
            and not args.force and not args.dry_run:
        logger.info("오늘은 이미 게시했습니다.")
        return 0

    delay = 0 if args.no_delay else random.randint(0, cfg["random_delay_minutes"])
    target = datetime.combine(day, datetime.min.time()).replace(hour=cfg["post_hour"]) + timedelta(minutes=delay)
    if args.no_delay:
        target = datetime.now()
    mode = decide_mode(cfg, state, day, args.mode)
    logger.info(f"== {day} ({'월화수목금'[day.weekday()] if day.weekday() < 5 else '주말'}) "
                f"모드={mode} 게시 예정={target:%H:%M} ==")

    out_dir = day_dir(day)
    record = {"date": day.isoformat(), "mode": mode, "status": "failed"}
    try:
        from images import pick_photos, render_all
        from writer import write_post

        topics = load_json(ROOT / "topics.json")["topics"]
        post_type, candidates, memo = choose(cfg, state, topics, day, args.type, logger)
        photos = pick_photos(state, cfg["photos_per_post"])
        n_cards = max(1, cfg["images_per_post"] - 1 - len(photos))
        logger.info(f"유형: {TYPE_LABELS[post_type]} / 후보: {[c['id'] for c in candidates]} / "
                    f"사진 {len(photos)}장, 카드 {n_cards}장")

        post = write_post(cfg, day, post_type, candidates, memo, photos, n_cards, out_dir, logger)
        topic_id = post.get("topic_id") if post.get("topic_id") in {c["id"] for c in candidates} \
            else candidates[0]["id"]
        logger.info(f"글 작성 완료: {post['title']}")

        files = render_all(cfg, post, photos, out_dir)
        logger.info(f"이미지 {len(files)}장 준비 완료")
        write_review(out_dir, post, mode, target)
        record.update(topic_id=topic_id, title=post["title"])

        if args.dry_run:
            logger.info(f"dry-run: 게시하지 않습니다. 결과 폴더: {out_dir}")
            return 0

        wait = (target - datetime.now()).total_seconds()
        if wait > 0:
            logger.info(f"{target:%H:%M}까지 {int(wait // 60)}분 대기합니다.")
            time.sleep(wait)

        from post_naver import post as naver_post
        try:
            result = naver_post(cfg, post, files, mode, out_dir, logger)
        except Exception as e:  # noqa: BLE001
            logger.error(f"자동 게시 실패: {e}")
            if not cfg.get("fallback_post_with_claude"):
                raise
            logger.info("Claude Code 브라우저 조작으로 다시 시도합니다.")
            result = claude_fallback_post(cfg, out_dir, mode, logger)
        logger.info(f"게시 결과: {result}")

        record.update(status="ok", result=result)
        if not state["first_run"]:
            state["first_run"] = day.isoformat()
        state["used_topics"].append(topic_id)
        if memo:
            state["used_memo_hashes"].append(memo_hash(memo))
        for p in photos:
            state["photo_uses"][p.name] = state["photo_uses"].get(p.name, 0) + 1
        return 0
    except Exception as e:  # noqa: BLE001
        record["error"] = str(e)
        logger.exception(f"실패: {e}")
        return 1
    finally:
        if not args.dry_run:
            state["history"].append(record)
            save_state(state)


if __name__ == "__main__":
    sys.exit(main())
