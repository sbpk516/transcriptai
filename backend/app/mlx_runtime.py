"""
Helpers to locate and activate the external MLX virtual environment.
"""
from __future__ import annotations

import logging
import os
import site
import sys
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger("transcriptai.mlx_runtime")

_DETECTED: bool = False
_SITE_PACKAGES: Optional[Path] = None
_VENV_ROOT: Optional[Path] = None


def _unique_paths(paths):
    seen = set()
    for entry in paths:
        if not entry:
            continue
        try:
            path = Path(entry).resolve()
        except Exception:
            continue
        if path in seen:
            continue
        seen.add(path)
        yield path


def _find_site_packages_under(venv_root: Path) -> Optional[Path]:
    if not venv_root.exists():
        return None

    lib_dir = venv_root / "lib"
    if lib_dir.exists():
        for python_dir in sorted(lib_dir.glob("python*"), reverse=True):
            site_packages = python_dir / "site-packages"
            if site_packages.exists():
                return site_packages

    win_site_packages = venv_root / "Lib" / "site-packages"
    if win_site_packages.exists():
        return win_site_packages

    return None


def _ascend_to_venv(site_packages: Path) -> Optional[Path]:
    for parent in site_packages.parents:
        if (parent / "bin").exists() or (parent / "Scripts").exists():
            return parent
    return None


def _discover_paths() -> Tuple[Optional[Path], Optional[Path]]:
    site_candidates = []
    venv_candidates = []

    env_site = os.getenv("TRANSCRIPTAI_MLX_SITE_PACKAGES")
    if env_site:
        site_candidates.append(Path(env_site))

    env_venv = os.getenv("TRANSCRIPTAI_MLX_VENV")
    if env_venv:
        venv_candidates.append(Path(env_venv))

    orig_exe = os.getenv("PYINSTALLER_ORIG_EXE")
    if orig_exe:
        venv_candidates.append(Path(orig_exe).resolve().parent / "venv_mlx")

    try:
        exe_path = Path(sys.executable).resolve()
        venv_candidates.extend([
            exe_path.parent / "venv_mlx",
            exe_path.parent.parent / "venv_mlx",
        ])
    except Exception:
        pass

    try:
        argv0 = Path(sys.argv[0]).resolve()
        venv_candidates.extend([
            argv0.parent / "venv_mlx",
            argv0.parent.parent / "venv_mlx",
        ])
        for parent in argv0.parents:
            if parent.name == "Resources":
                venv_candidates.append(parent / "venv_mlx")
                break
    except Exception:
        pass

    try:
        here = Path(__file__).resolve()
        # app/ -> backend/ -> repo root
        if len(here.parents) >= 3:
            repo_root = here.parents[2]
            venv_candidates.append(repo_root / "venv_mlx")
    except Exception:
        pass

    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        meipass_path = Path(meipass)
        venv_candidates.extend([
            meipass_path / "venv_mlx",
            meipass_path.parent / "venv_mlx",
        ])

    for site_path in _unique_paths(site_candidates):
        if site_path.exists() and site_path.is_dir() and site_path.name == "site-packages":
            venv_root = _ascend_to_venv(site_path)
            return venv_root, site_path

    for venv_root in _unique_paths(venv_candidates):
        site_packages = _find_site_packages_under(venv_root)
        if site_packages:
            return venv_root, site_packages

    return None, None


def detect_mlx_site_packages() -> Optional[Path]:
    """
    Locate the MLX virtual environment's site-packages directory.
    """
    global _DETECTED, _SITE_PACKAGES, _VENV_ROOT

    if not _DETECTED:
        venv_root, site_packages = _discover_paths()
        _DETECTED = True
        _VENV_ROOT = venv_root
        _SITE_PACKAGES = site_packages

        if site_packages and not site_packages.exists():
            logger.debug("MLX site-packages candidate %s does not exist", site_packages)
            _SITE_PACKAGES = None

    return _SITE_PACKAGES


def get_mlx_venv_root() -> Optional[Path]:
    detect_mlx_site_packages()
    return _VENV_ROOT


def activate_mlx_site_packages(reason: str = "", *, log: Optional[logging.Logger] = None) -> bool:
    """
    Ensure the MLX site-packages directory is on sys.path.
    """
    target_logger = log or logger
    site_packages = detect_mlx_site_packages()

    if not site_packages:
        if reason:
            target_logger.debug("MLX site-packages not found (reason=%s)", reason)
        else:
            target_logger.debug("MLX site-packages not found")
        return False

    site_packages_str = str(site_packages)
    already_present = site_packages_str in sys.path

    if not already_present:
        site.addsitedir(site_packages_str)
        try:
            idx = sys.path.index(site_packages_str)
            if idx > 0:
                sys.path.insert(0, sys.path.pop(idx))
        except ValueError:
            sys.path.insert(0, site_packages_str)

    target_logger.debug(
        "MLX site-packages activated from %s (reason=%s, already_present=%s)",
        site_packages_str,
        reason or "unspecified",
        already_present,
    )

    venv_root = get_mlx_venv_root()
    if venv_root:
        # Build list of library paths to try
        lib_paths = []
        
        # Primary: venv_root/lib (contains libmlx.dylib via mlx/lib/)
        lib_dir = venv_root / "lib"
        if lib_dir.exists():
            lib_paths.append(str(lib_dir))
        
        # Secondary: Direct path to mlx/lib where libmlx.dylib actually lives
        mlx_lib_dir = venv_root / "lib" / "python3.11" / "site-packages" / "mlx" / "lib"
        if mlx_lib_dir.exists():
            lib_paths.append(str(mlx_lib_dir))
        
        if lib_paths:
            # Use DYLD_FALLBACK_LIBRARY_PATH instead of DYLD_LIBRARY_PATH
            # DYLD_FALLBACK_LIBRARY_PATH works better in sandboxed macOS apps
            current = os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "")
            new_paths = ":".join(lib_paths)
            
            # Add new paths to the beginning
            if current:
                os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = f"{new_paths}:{current}"
            else:
                os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = new_paths
            
            target_logger.debug(
                "Set DYLD_FALLBACK_LIBRARY_PATH with MLX library paths: %s",
                new_paths
            )

    return True
