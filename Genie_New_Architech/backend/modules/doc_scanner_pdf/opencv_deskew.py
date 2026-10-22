from __future__ import annotations

import cv2
import numpy as np


def deskew_document(image: np.ndarray) -> np.ndarray:
    if image.ndim not in (2, 3) or image.size == 0:
        raise ValueError("A non-empty image is required.")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    height, width = gray.shape[:2]
    candidates: list[np.ndarray] = []
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:20]:
        perimeter = cv2.arcLength(contour, True)
        polygon = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(polygon) == 4 and cv2.contourArea(polygon) > width * height * 0.15:
            candidates.append(polygon.reshape(4, 2).astype(np.float32))
            break
    if not candidates:
        return image
    points = candidates[0]
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1).ravel()
    ordered = np.array(
        [points[np.argmin(sums)], points[np.argmin(diffs)], points[np.argmax(sums)], points[np.argmax(diffs)]],
        dtype=np.float32,
    )
    top_left, top_right, bottom_right, bottom_left = ordered
    target_width = max(
        int(np.linalg.norm(bottom_right - bottom_left)),
        int(np.linalg.norm(top_right - top_left)),
    )
    target_height = max(
        int(np.linalg.norm(top_right - bottom_right)),
        int(np.linalg.norm(top_left - bottom_left)),
    )
    target = np.array(
        [[0, 0], [target_width - 1, 0], [target_width - 1, target_height - 1], [0, target_height - 1]],
        dtype=np.float32,
    )
    transform = cv2.getPerspectiveTransform(ordered, target)
    warped = cv2.warpPerspective(image, transform, (target_width, target_height))
    warped_gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY) if warped.ndim == 3 else warped
    background = cv2.GaussianBlur(warped_gray, (0, 0), 25)
    shadow_removed = cv2.divide(warped_gray, background, scale=255)
    return cv2.adaptiveThreshold(
        shadow_removed, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 10
    )
