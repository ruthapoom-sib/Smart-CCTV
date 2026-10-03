import numpy as np
from scipy.ndimage import label, find_objects
from .contracts import RawClassification, RainThresholds
from .geometry import roi_mask


class RainDetector:
    def __init__(self, revision: str = 'v1'):
        self.revision = revision

    def analyze(
        self,
        frames: list[np.ndarray],
        roi: list[tuple[float, float]],
        thresholds: RainThresholds,
    ) -> tuple[RawClassification, np.ndarray]:
        if not frames or len(frames) < 8:
            return RawClassification(
                raw_status='unknown',
                score=None,
                reason='insufficient_frames',
                diagnostics={'frames': len(frames)},
            ), np.zeros((1, 1), dtype=bool)

        # Convert to grayscale float
        gray_list = []
        for f in frames:
            if f.ndim == 3:
                # Standard luminance formula
                g = 0.299 * f[:, :, 0] + 0.587 * f[:, :, 1] + 0.114 * f[:, :, 2]
            else:
                g = f.astype(float)
            gray_list.append(g)

        stack = np.stack(gray_list, axis=0)
        h, w = stack.shape[1], stack.shape[2]

        try:
            r_mask = roi_mask(roi, w, h)
        except Exception as exc:
            return RawClassification(
                raw_status='unknown',
                score=None,
                reason=f'invalid_roi: {exc}',
            ), np.zeros((h, w), dtype=bool)

        roi_pixels = stack[:, r_mask]
        mean_lum = float(np.mean(roi_pixels))
        std_lum = float(np.std(roi_pixels))

        if mean_lum < 8.0 or mean_lum > 248.0 or std_lum < 2.0:
            return RawClassification(
                raw_status='unknown',
                score=None,
                reason='low_contrast_or_blank',
                diagnostics={'mean_lum': mean_lum, 'std_lum': std_lum},
            ), np.zeros((h, w), dtype=bool)

        # Temporal median background
        bg = np.median(stack, axis=0)

        # Check global illumination shifts across whole frame
        frame_diffs = np.abs(stack - bg)
        mean_frame_shifts = np.mean(frame_diffs, axis=(1, 2))
        if np.mean(mean_frame_shifts) > 40.0:
            return RawClassification(
                raw_status='unknown',
                score=None,
                reason='global_lighting_shift',
                diagnostics={'mean_shift': float(np.mean(mean_frame_shifts))},
            ), np.zeros((h, w), dtype=bool)

        total_frames = len(frames)
        frame_streak_counts = []
        composite_mask = np.zeros((h, w), dtype=bool)
        all_aspects = []
        all_diffs = []

        for t in range(total_frames):
            # Streaks are transient brightness increases over median background
            diff = (stack[t] - bg) * r_mask
            streak_pixels = diff >= thresholds.min_intensity_diff
            if not streak_pixels.any():
                frame_streak_counts.append(0)
                continue

            labeled, num_features = label(streak_pixels)
            slices = find_objects(labeled)
            count = 0

            for i, sl in enumerate(slices):
                if sl is None:
                    continue
                sy, sx = sl
                len_y = sy.stop - sy.start
                len_x = sx.stop - sx.start
                aspect = len_y / max(len_x, 1)

                # Vertical-ish streak criteria:
                # - length >= 4px and <= 60px
                # - width <= 12px
                # - aspect ratio >= thresholds.min_streak_aspect
                if 4 <= len_y <= 60 and len_x <= 12 and aspect >= thresholds.min_streak_aspect:
                    count += 1
                    comp_mask = labeled[sl] == (i + 1)
                    composite_mask[sl] |= comp_mask
                    all_aspects.append(aspect)
                    all_diffs.append(float(np.mean(diff[sl][comp_mask])))

            frame_streak_counts.append(count)

        active_frames = sum(1 for c in frame_streak_counts if c >= thresholds.min_streaks)
        frame_ratio = active_frames / max(total_frames, 1)
        total_streaks = sum(frame_streak_counts)

        # Streak evidence score (0.0 to 1.0)
        target_streaks = thresholds.min_streaks * max(1, int(total_frames * thresholds.min_frame_ratio))
        ratio_term = min(1.0, frame_ratio / thresholds.min_frame_ratio) if thresholds.min_frame_ratio > 0 else 0.0
        streak_term = min(1.0, total_streaks / max(target_streaks, 1))
        score = 0.5 * ratio_term + 0.5 * streak_term
        score = float(round(max(0.0, min(1.0, score)), 2))

        diagnostics = {
            'total_frames': total_frames,
            'active_frames': active_frames,
            'frame_ratio': round(frame_ratio, 3),
            'candidate_streaks': total_streaks,
            'mean_aspect': round(float(np.mean(all_aspects)), 2) if all_aspects else 0.0,
            'mean_streak_diff': round(float(np.mean(all_diffs)), 2) if all_diffs else 0.0,
        }

        if frame_ratio >= thresholds.min_frame_ratio and total_streaks >= (thresholds.min_streaks * active_frames):
            raw_status = 'rainy'
        else:
            raw_status = 'dry'

        return RawClassification(
            raw_status=raw_status,
            score=score,
            diagnostics=diagnostics,
        ), composite_mask
