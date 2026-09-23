"""네이버 블로그 스마트에디터 ONE에 글을 입력하고 임시저장하거나 발행한다.

로그인은 전용 브라우저 프로필(.browser-profile)에 한 번만 직접 해 두면 유지된다.
    python post_naver.py --login
"""
import argparse
import json
import re
import time
from pathlib import Path

from playwright.sync_api import Frame, Page, TimeoutError as PWTimeout, sync_playwright

from common import PROFILE_DIR, load_config

EDITOR_READY = ".se-documentTitle"


def open_context(pw, cfg: dict, headless: bool = False):
    return pw.chromium.launch_persistent_context(
        str(PROFILE_DIR),
        channel=cfg.get("browser_channel") or None,
        headless=headless,
        viewport={"width": 1400, "height": 950},
        locale="ko-KR",
        args=["--disable-blink-features=AutomationControlled"],
    )


def login(cfg: dict) -> None:
    with sync_playwright() as pw:
        ctx = open_context(pw, cfg)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://nid.naver.com/nidlogin.login")
        print("열린 브라우저에서 네이버에 로그인하세요. '로그인 상태 유지'를 켜 두면 좋습니다.")
        input("로그인을 마쳤으면 Enter를 누르세요... ")
        ctx.close()


def is_logged_in(page: Page) -> bool:
    return "nid.naver.com" not in page.url


def find_editor(page: Page, timeout_s: int = 40) -> Frame | Page:
    """에디터가 iframe(mainFrame) 안에 있을 때와 아닐 때 모두 처리한다."""
    end = time.time() + timeout_s
    while time.time() < end:
        for fr in [page.main_frame, *page.frames]:
            try:
                if fr.locator(EDITOR_READY).count():
                    return fr
            except Exception:  # noqa: BLE001 — 로딩 중 frame detach
                pass
        time.sleep(1)
    raise RuntimeError("글쓰기 에디터를 찾지 못했습니다 (로그인 만료 또는 화면 변경)")


def click_if_visible(root, selector: str, timeout_ms: int = 1500) -> bool:
    try:
        loc = root.locator(selector).first
        loc.wait_for(state="visible", timeout=timeout_ms)
        loc.click()
        return True
    except PWTimeout:
        return False


def dismiss_popups(ed) -> None:
    # "작성 중인 글이 있습니다" -> 취소(새 글), 도움말 패널 닫기
    click_if_visible(ed, ".se-popup-button-cancel")
    click_if_visible(ed, ".se-help-panel-close-button")


def type_text(page: Page, text: str, bold: bool = False) -> None:
    if bold:
        page.keyboard.press("Control+B")
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if line:
            page.keyboard.insert_text(line)
        if i < len(lines) - 1:
            page.keyboard.press("Shift+Enter")
    if bold:
        page.keyboard.press("Control+B")
    page.keyboard.press("Enter")
    time.sleep(0.15)


def insert_image(page: Page, ed, path: Path, caption: str | None) -> None:
    before = ed.locator(".se-component.se-image").count()
    with page.expect_file_chooser(timeout=15000) as fc:
        ed.locator("button.se-image-toolbar-button, button[data-name='image']").first.click()
    fc.value.set_files(str(path))
    deadline = time.time() + 60
    while ed.locator(".se-component.se-image").count() <= before:
        if time.time() > deadline:
            raise RuntimeError(f"이미지 업로드 시간 초과: {path.name}")
        time.sleep(0.5)
    time.sleep(1.0)
    comp = ed.locator(".se-component.se-image").nth(before)
    if caption:
        cap = comp.locator(".se-caption .se-text-paragraph")
        if cap.count():
            cap.first.click()
            page.keyboard.insert_text(caption)
    # 글은 항상 끝에 이어 쓰므로, 마지막 텍스트 문단(없으면 이미지 뒤 새 문단)으로 커서를 옮긴다
    last = ed.locator(".se-component").last
    if "se-text" in (last.get_attribute("class") or ""):
        last.locator(".se-text-paragraph").last.click()
        page.keyboard.press("End")
    else:
        comp.click()
        page.keyboard.press("Enter")
    time.sleep(0.3)


def fill_tags(page: Page, ed, tags: list[str]) -> None:
    box = ed.locator("#tag-input, input[placeholder*='태그']").first
    try:
        box.wait_for(state="visible", timeout=5000)
    except PWTimeout:
        return
    for t in tags:
        box.click()
        page.keyboard.insert_text(t)
        page.keyboard.press("Enter")
        time.sleep(0.2)


def post(cfg: dict, post_data: dict, files: dict[str, Path], mode: str, out_dir: Path, logger,
         headless: bool = False) -> str:
    """mode: 'draft' (임시저장) | 'publish' (발행). 결과 URL 또는 설명을 반환."""
    with sync_playwright() as pw:
        ctx = open_context(pw, cfg, headless=headless)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            page.goto(f"https://blog.naver.com/{cfg['blog_id']}?Redirect=Write", wait_until="domcontentloaded")
            time.sleep(3)
            if not is_logged_in(page):
                raise RuntimeError("네이버 로그인이 풀렸습니다. python post_naver.py --login 으로 다시 로그인하세요.")
            ed = find_editor(page)
            time.sleep(2)
            dismiss_popups(ed)

            ed.locator(f"{EDITOR_READY} .se-text-paragraph").first.click()
            page.keyboard.insert_text(post_data["title"])
            logger.info("제목 입력 완료")

            ed.locator(".se-component.se-text .se-text-paragraph").first.click()
            insert_image(page, ed, files["thumbnail"], None)
            for s in post_data["sections"]:
                if s["type"] == "image":
                    ref = s["ref"]
                    insert_image(page, ed, files[ref], post_data.get("photo_captions", {}).get(ref))
                else:
                    type_text(page, s["text"], bold=s["type"] == "heading")
            logger.info("본문 입력 완료")
            page.screenshot(path=str(out_dir / "editor_before_save.png"), full_page=False)

            if mode == "draft":
                ed.locator("button[class*='save_btn'], button:has-text('저장')").first.click()
                time.sleep(3)
                page.screenshot(path=str(out_dir / "editor_saved.png"))
                return "임시저장 완료"

            ed.locator("button[class*='publish_btn'], button:has-text('발행')").first.click()
            time.sleep(2)
            fill_tags(page, ed, post_data["tags"])
            ed.locator("button[class*='confirm_btn'], [class*='layer'] button:has-text('발행')").last.click()
            page.wait_for_url(re.compile(r"blog\.naver\.com/.+/\d+|logNo=\d+"), timeout=60000)
            page.screenshot(path=str(out_dir / "published.png"))
            return page.url
        except Exception:
            try:
                page.screenshot(path=str(out_dir / "error.png"))
            except Exception:  # noqa: BLE001
                pass
            raise
        finally:
            ctx.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--login", action="store_true", help="전용 브라우저로 네이버 로그인")
    ap.add_argument("--dir", help="output/날짜 폴더를 다시 게시 (post.json과 이미지 사용)")
    ap.add_argument("--mode", choices=["draft", "publish"], default="draft")
    args = ap.parse_args()
    cfg = load_config()
    if args.login:
        login(cfg)
        return
    if args.dir:
        import logging
        logging.basicConfig(level=logging.INFO)
        out_dir = Path(args.dir)
        data = json.loads((out_dir / "post.json").read_text(encoding="utf-8"))
        files = {p.stem: p for p in out_dir.iterdir()
                 if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"} and not p.stem.startswith(("editor", "error", "published"))}
        print(post(cfg, data, files, args.mode, out_dir, logging.getLogger("nasum")))


if __name__ == "__main__":
    main()
