"""썸네일(브랜드 포함)과 정보 카드를 HTML로 그려 PNG로 저장하고, 실제 사진을 골라 붙인다."""
import html
import shutil
from pathlib import Path

from playwright.sync_api import sync_playwright

from common import ASSETS, FONTS, PHOTO_EXTS, PHOTOS

SIZE = 1080
PALETTE = {"bg": "#F6F1E9", "ink": "#2E2A26", "accent": "#7A9A6B", "soft": "#E4DCCD"}


def _fonts_css() -> str:
    faces = []
    for weight, name in ((400, "Regular"), (600, "SemiBold"), (700, "Bold"), (800, "ExtraBold")):
        f = FONTS / f"Pretendard-{name}.otf"
        if f.exists():
            faces.append(f"@font-face{{font-family:P;font-weight:{weight};src:url('{f.as_uri()}')}}")
    return "".join(faces)


def _profile_uri() -> str | None:
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        p = ASSETS / f"profile{ext}"
        if p.exists():
            return p.as_uri()
    return None


def _page(body: str) -> str:
    c = PALETTE
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
{_fonts_css()}
*{{margin:0;padding:0;box-sizing:border-box}}
body{{width:{SIZE}px;height:{SIZE}px;font-family:P,'Malgun Gothic',sans-serif;background:{c['bg']};color:{c['ink']};
  word-break:keep-all;overflow:hidden}}
.frame{{position:absolute;inset:48px;border:3px solid {c['soft']};border-radius:40px;padding:84px 80px;display:flex;flex-direction:column}}
.brand{{display:flex;align-items:center;gap:22px;font-weight:700;font-size:36px;color:{c['accent']}}}
.brand img{{width:96px;height:96px;border-radius:50%;object-fit:cover;border:4px solid #fff}}
.brand .mark{{width:96px;height:96px;border-radius:50%;background:{c['accent']};color:#fff;display:flex;align-items:center;justify-content:center;font-size:40px}}
.tagline{{font-size:28px;font-weight:600;color:#8a8175;margin-top:6px}}
.thumb-title{{margin-top:auto;font-size:92px;line-height:1.22;font-weight:800;letter-spacing:-2px;white-space:pre-line}}
.bar{{width:120px;height:10px;background:{c['accent']};border-radius:5px;margin:56px 0 0}}
.card-no{{font-size:30px;font-weight:700;color:{c['accent']}}}
.card-title{{font-size:68px;line-height:1.25;font-weight:800;letter-spacing:-1.5px;margin:22px 0 56px}}
ul{{list-style:none;display:flex;flex-direction:column;gap:30px}}
li{{font-size:42px;line-height:1.4;font-weight:600;padding-left:52px;position:relative}}
li:before{{content:'';position:absolute;left:0;top:18px;width:24px;height:24px;border-radius:50%;background:{c['accent']}}}
.foot{{margin-top:auto;font-size:28px;font-weight:600;color:#8a8175}}
</style></head><body><div class="frame">{body}</div></body></html>"""


def _brand(cfg: dict) -> str:
    name = html.escape(cfg["brand_name"])
    uri = _profile_uri()
    icon = f'<img src="{uri}">' if uri else f'<div class="mark">{name[:1]}</div>'
    return (f'<div class="brand">{icon}<div>{name}'
            f'<div class="tagline">{html.escape(cfg["brand_tagline"])}</div></div></div>')


def thumbnail_html(cfg: dict, title: str) -> str:
    return _page(f'{_brand(cfg)}<div class="thumb-title">{html.escape(title)}</div><div class="bar"></div>')


def card_html(cfg: dict, card: dict, no: int, total: int) -> str:
    items = "".join(f"<li>{html.escape(p)}</li>" for p in card["points"])
    return _page(f'<div class="card-no">POINT {no} / {total}</div>'
                 f'<div class="card-title">{html.escape(card["heading"])}</div><ul>{items}</ul>'
                 f'<div class="foot">{html.escape(cfg["brand_name"])} · {html.escape(cfg["brand_tagline"])}</div>')


def list_photos() -> list[Path]:
    return sorted(p for p in PHOTOS.iterdir() if p.suffix.lower() in PHOTO_EXTS)


def pick_photos(state: dict, count: int) -> list[Path]:
    """가장 적게 쓴 사진부터 고른다."""
    uses = state["photo_uses"]
    photos = sorted(list_photos(), key=lambda p: (uses.get(p.name, 0), p.name))
    return photos[:count]


def render_all(cfg: dict, post: dict, photos: list[Path], out_dir: Path) -> dict[str, Path]:
    """ref(thumbnail, card1.., photo1..) -> 파일 경로"""
    files: dict[str, Path] = {}
    jobs = [("thumbnail", thumbnail_html(cfg, post["thumbnail_title"]))]
    cards = post["cards"]
    jobs += [(c["id"], card_html(cfg, c, i, len(cards))) for i, c in enumerate(cards, 1)]
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel=cfg.get("browser_channel") or None)
        page = browser.new_page(viewport={"width": SIZE, "height": SIZE})
        for ref, doc in jobs:
            src = out_dir / f"_{ref}.html"
            src.write_text(doc, encoding="utf-8")
            page.goto(src.as_uri())
            page.evaluate("document.fonts.ready")
            dst = out_dir / f"{ref}.png"
            page.screenshot(path=str(dst))
            src.unlink()
            files[ref] = dst
        browser.close()
    for i, p in enumerate(photos, 1):
        dst = out_dir / f"photo{i}{p.suffix.lower()}"
        shutil.copyfile(p, dst)
        files[f"photo{i}"] = dst
    return files
