"""공통 경로, 설정, 상태 파일, 로그."""
import json
import logging
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROMPTS = ROOT / "prompts"
SAMPLES = ROOT / "samples"
MEMO_FILE = ROOT / "memo" / "this_week.md"
PHOTOS = ROOT / "photos"
ASSETS = ROOT / "assets"
OUTPUT = ROOT / "output"
LOGS = ROOT / "logs"
PROFILE_DIR = ROOT / ".browser-profile"
STATE_FILE = ROOT / "state.json"
FONTS = ROOT.parent / "public" / "fonts"

PHOTO_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

TYPE_LABELS = {
    "admission": "정보성 (입소, 비용, 등급)",
    "emotion": "보호자 감성형",
    "health": "정보성 (어르신 건강관리)",
    "operation": "실제 운영·신뢰형",
    "checklist": "체크리스트형 정보 (상담, 견학, 계약)",
}


def load_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def load_config() -> dict:
    return load_json(ROOT / "config.json")


def load_state() -> dict:
    state = load_json(STATE_FILE, {}) or {}
    state.setdefault("first_run", None)
    state.setdefault("used_topics", [])
    state.setdefault("used_memo_hashes", [])
    state.setdefault("photo_uses", {})
    state.setdefault("history", [])
    return state


def save_state(state: dict) -> None:
    save_json(STATE_FILE, state)


def day_dir(day: date) -> Path:
    d = OUTPUT / day.isoformat()
    d.mkdir(parents=True, exist_ok=True)
    return d


def setup_logging(day: date) -> logging.Logger:
    LOGS.mkdir(exist_ok=True)
    logger = logging.getLogger("nasum")
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%H:%M:%S")
    fh = logging.FileHandler(LOGS / f"{day.isoformat()}.log", encoding="utf-8")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    logger.addHandler(fh)
    logger.addHandler(sh)
    return logger
