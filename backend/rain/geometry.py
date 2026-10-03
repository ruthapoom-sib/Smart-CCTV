import math
import numpy as np
from PIL import Image, ImageDraw


def validate_roi(points):
    if not isinstance(points, (list, tuple)) or not 3 <= len(points) <= 64:
        raise ValueError('ROI needs 3–64 vertices')
    result = []
    for point in points:
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            raise ValueError('Invalid vertex')
        x, y = map(float, point)
        if not all(math.isfinite(v) and 0 <= v <= 1 for v in (x, y)):
            raise ValueError('ROI must lie within image')
        result.append((x, y))
    if len(set(result)) != len(result):
        raise ValueError('Duplicate vertex')
    area = sum(a[0]*b[1] - b[0]*a[1] for a, b in zip(result, result[1:] + result[:1]))
    if abs(area) < 1e-6:
        raise ValueError('ROI has no area')
    def cross(a, b, c):
        return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])
    def intersects(a, b, c, d):
        if max(a[0], b[0]) < min(c[0], d[0]) or max(c[0], d[0]) < min(a[0], b[0]): return False
        if max(a[1], b[1]) < min(c[1], d[1]) or max(c[1], d[1]) < min(a[1], b[1]): return False
        return cross(a, b, c)*cross(a, b, d) <= 0 and cross(c, d, a)*cross(c, d, b) <= 0
    n = len(result)
    for i in range(n):
        for j in range(i+1, n):
            if j == i+1 or (i == 0 and j == n-1): continue
            if intersects(result[i], result[(i+1)%n], result[j], result[(j+1)%n]):
                raise ValueError('ROI edges cross')
    return result


def roi_mask(points, width, height):
    points = validate_roi(points)
    if width < 1 or height < 1: raise ValueError('Invalid image size')
    image = Image.new('1', (width, height))
    ImageDraw.Draw(image).polygon([(x*(width-1), y*(height-1)) for x, y in points], fill=1)
    result = np.asarray(image, dtype=bool)
    if not result.any(): raise ValueError('ROI too small for image')
    return result
