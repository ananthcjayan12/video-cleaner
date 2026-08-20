#!/usr/bin/env python3
"""Generate a temporally stable presenter alpha-mask video locally.

The mask is intentionally stored separately from presenter RGB. Final rendering combines
this alpha with the untouched master, so source colour/HDR is not baked through OpenCV.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

DEFAULT_FEATHER_PX = 3
DEFAULT_CHOKE_PX = 1.0
DEFAULT_TEMPORAL_BLEND = 0.10


def smoothstep(value: np.ndarray) -> np.ndarray:
    clipped = np.clip(value, 0.0, 1.0)
    return clipped * clipped * (3.0 - 2.0 * clipped)


def guided_filter(guide: np.ndarray, source: np.ndarray, radius: int, eps: float = 1e-3) -> np.ndarray:
    kernel = (radius * 2 + 1, radius * 2 + 1)
    mean_guide = cv2.boxFilter(guide, cv2.CV_32F, kernel, normalize=True, borderType=cv2.BORDER_REFLECT)
    mean_source = cv2.boxFilter(source, cv2.CV_32F, kernel, normalize=True, borderType=cv2.BORDER_REFLECT)
    corr_guide = cv2.boxFilter(guide * guide, cv2.CV_32F, kernel, normalize=True, borderType=cv2.BORDER_REFLECT)
    corr_cross = cv2.boxFilter(guide * source, cv2.CV_32F, kernel, normalize=True, borderType=cv2.BORDER_REFLECT)
    variance = corr_guide - mean_guide * mean_guide
    covariance = corr_cross - mean_guide * mean_source
    a = covariance / (variance + eps)
    b = mean_source - a * mean_guide
    mean_a = cv2.boxFilter(a, cv2.CV_32F, kernel, normalize=True, borderType=cv2.BORDER_REFLECT)
    mean_b = cv2.boxFilter(b, cv2.CV_32F, kernel, normalize=True, borderType=cv2.BORDER_REFLECT)
    return mean_a * guide + mean_b


def choke_alpha(alpha: np.ndarray, choke_px: float) -> np.ndarray:
    """Contract the soft matte by roughly choke_px without turning the edge into a hard cut."""
    if choke_px <= 0:
        return alpha
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    whole = int(np.floor(choke_px))
    fraction = float(choke_px - whole)
    contracted = alpha
    for _ in range(whole):
        contracted = cv2.erode(contracted, kernel, iterations=1, borderType=cv2.BORDER_REPLICATE)
    if fraction > 1e-3:
        next_contract = cv2.erode(contracted, kernel, iterations=1, borderType=cv2.BORDER_REPLICATE)
        contracted = contracted * (1.0 - fraction) + next_contract * fraction
    return np.clip(contracted, 0.0, 1.0)


def refine_mask(
    mask: np.ndarray,
    frame_bgr: np.ndarray,
    previous_alpha: np.ndarray | None,
    previous_guide: np.ndarray | None,
    feather_px: int,
    choke_px: float,
    temporal_blend: float,
) -> tuple[np.ndarray, np.ndarray]:
    height, width = frame_bgr.shape[:2]
    probability = np.asarray(mask, dtype=np.float32)
    if probability.shape != (height, width):
        probability = cv2.resize(probability, (width, height), interpolation=cv2.INTER_CUBIC)
    probability = np.clip(probability, 0.0, 1.0)

    mask_u8 = np.clip(probability * 255.0, 0, 255).astype(np.uint8)
    cleanup_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask_u8 = cv2.morphologyEx(mask_u8, cv2.MORPH_CLOSE, cleanup_kernel, iterations=1)
    mask_u8 = cv2.morphologyEx(mask_u8, cv2.MORPH_OPEN, cleanup_kernel, iterations=1)
    probability = mask_u8.astype(np.float32) / 255.0

    guide = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    working_scale = min(1.0, 1080.0 / max(height, width))
    if working_scale < 1.0:
        working_size = (max(2, round(width * working_scale)), max(2, round(height * working_scale)))
        small_guide = cv2.resize(guide, working_size, interpolation=cv2.INTER_AREA)
        small_probability = cv2.resize(probability, working_size, interpolation=cv2.INTER_AREA)
        small_guided = guided_filter(
            small_guide,
            small_probability,
            radius=max(2, round((feather_px + 2) * working_scale)),
        )
        guided = cv2.resize(small_guided, (width, height), interpolation=cv2.INTER_CUBIC)
    else:
        guided = guided_filter(guide, probability, radius=max(2, feather_px + 2))
    guided = np.clip((guided - 0.045) / 0.91, 0.0, 1.0)

    definite_foreground = probability >= 0.97
    definite_background = probability <= 0.08
    binary = (guided >= 0.53).astype(np.uint8)
    edge_kernel_size = feather_px * 2 + 1
    edge_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (edge_kernel_size, edge_kernel_size))
    edge_band = cv2.dilate(binary, edge_kernel, iterations=1) != cv2.erode(binary, edge_kernel, iterations=1)

    alpha = binary.astype(np.float32)
    alpha[edge_band] = guided[edge_band]
    alpha[definite_foreground] = 1.0
    alpha[definite_background] = 0.0
    alpha = smoothstep(alpha)

    # Temporal stabilization is useful on static hair/shoulders but must rapidly release on moving
    # hands, lips and head turns. Gate the history weight by both matte delta and image motion.
    if previous_alpha is not None and previous_alpha.shape == alpha.shape and temporal_blend > 0:
        unknown = (alpha > 0.015) & (alpha < 0.985)
        delta = np.abs(alpha - previous_alpha)
        if previous_guide is not None and previous_guide.shape == guide.shape:
            motion = cv2.GaussianBlur(np.abs(guide - previous_guide), (0, 0), 1.1)
        else:
            motion = np.zeros_like(alpha)
        adaptive_weight = temporal_blend * np.exp(-delta * 14.0) * np.exp(-motion * 28.0)
        adaptive_weight[delta > 0.22] = 0.0
        alpha[unknown] = (
            previous_alpha[unknown] * adaptive_weight[unknown]
            + alpha[unknown] * (1.0 - adaptive_weight[unknown])
        )

    # Pull the semi-transparent fringe slightly inward. This removes coloured pixels from the old
    # background without making hair and clothing edges look like a hard green-screen cut.
    alpha = choke_alpha(alpha, choke_px)
    alpha[definite_foreground] = 1.0
    alpha[definite_background] = 0.0
    return np.clip(alpha, 0.0, 1.0).astype(np.float32), guide


def create_segmenter(mp, requested_model_path: str = ""):
    if hasattr(mp, "solutions"):
        return mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=1), True

    model_path = requested_model_path.strip() or os.environ.get("MEDIAPIPE_SELFIE_MODEL", "").strip()
    if not model_path or not Path(model_path).exists():
        raise RuntimeError(
            "This MediaPipe wheel uses the Tasks API and needs a model file. Run this through Video Cleaner so the "
            "official model is provisioned automatically, or set MEDIAPIPE_SELFIE_MODEL to a selfie_segmenter.tflite path."
        )
    options = mp.tasks.vision.ImageSegmenterOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=model_path),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        output_confidence_masks=True,
        output_category_mask=False,
    )
    return mp.tasks.vision.ImageSegmenter.create_from_options(options), False


def segment_frame(mp, segmenter, legacy: bool, rgb: np.ndarray, frame_index: int, fps: float) -> np.ndarray:
    if legacy:
        return segmenter.process(rgb).segmentation_mask.astype(np.float32)
    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
    timestamp_ms = round(frame_index * 1000 / fps)
    result = segmenter.segment_for_video(image, timestamp_ms)
    if not result.confidence_masks:
        raise RuntimeError("MediaPipe returned no foreground confidence mask")
    mask = np.array(result.confidence_masks[0].numpy_view(), dtype=np.float32, copy=True)
    return mask[:, :, 0] if mask.ndim == 3 and mask.shape[2] == 1 else mask


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--model", default="")
    parser.add_argument("--feather", type=int, default=DEFAULT_FEATHER_PX)
    parser.add_argument("--choke", type=float, default=DEFAULT_CHOKE_PX)
    parser.add_argument("--temporal", type=float, default=DEFAULT_TEMPORAL_BLEND)
    args = parser.parse_args()

    try:
        import mediapipe as mp
    except ImportError as exc:
        raise RuntimeError("MediaPipe is not installed. Run: pip install -r requirements-matting.txt") from exc

    source = Path(args.input).expanduser().resolve()
    destination = Path(args.output).expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        destination.unlink()

    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open segmentation input: {source}")
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 30.0)
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if width <= 0 or height <= 0:
        capture.release()
        raise RuntimeError("Segmentation input has invalid dimensions")

    # A matte is data, not viewing media. Store it losslessly as gray8/FFV1 so compression ringing
    # cannot turn into coloured halos once the alpha is enlarged and composited over a new scene.
    command = [
        args.ffmpeg,
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{width}x{height}",
        "-framerate", f"{fps:g}", "-i", "pipe:0",
        "-an", "-c:v", "ffv1", "-level", "3", "-g", "1",
        "-pix_fmt", "gray", str(destination),
    ]
    encoder = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    segmenter = None
    previous_alpha: np.ndarray | None = None
    previous_guide: np.ndarray | None = None
    frame_index = 0
    feather = max(1, min(int(args.feather), 10))
    choke = max(0.0, min(float(args.choke), 3.0))
    temporal = max(0.0, min(float(args.temporal), 0.30))

    try:
        segmenter, legacy = create_segmenter(mp, args.model)
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            raw_mask = segment_frame(mp, segmenter, legacy, rgb, frame_index, fps)
            alpha, guide = refine_mask(raw_mask, frame, previous_alpha, previous_guide, feather, choke, temporal)
            previous_alpha = alpha
            previous_guide = guide
            mask_u8 = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
            if encoder.stdin is None:
                raise RuntimeError("FFmpeg matte encoder stdin is unavailable")
            encoder.stdin.write(mask_u8.tobytes())
            frame_index += 1
            if frame_index % 90 == 0 or (total_frames and frame_index == total_frames):
                percent = frame_index / total_frames * 100 if total_frames else 0.0
                print(f"PROGRESS {percent:.1f}", flush=True)
    finally:
        capture.release()
        if segmenter is not None:
            segmenter.close()
        if encoder.stdin is not None:
            try:
                encoder.stdin.close()
            except BrokenPipeError:
                pass

    stderr = encoder.stderr.read().decode("utf-8", errors="replace") if encoder.stderr else ""
    returncode = encoder.wait(timeout=7200)
    if frame_index == 0:
        destination.unlink(missing_ok=True)
        raise RuntimeError("No frames were segmented")
    if returncode != 0 or not destination.exists() or destination.stat().st_size < 10_000:
        destination.unlink(missing_ok=True)
        raise RuntimeError(f"Presenter matte encoder failed: {stderr[-3000:]}")

    print(f"DONE {frame_index} {width}x{height} {fps:g}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR {exc}", file=sys.stderr, flush=True)
        raise
