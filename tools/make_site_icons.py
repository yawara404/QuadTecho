#!/usr/bin/env python3
"""ogp.png からサイトアイコン（favicon / apple-touch-icon / PWA アイコン）を生成する。

OGP画像(1200x630 のバナー)をそのままファビコンにすると 16px では潰れてしまうため、
バナー内のアプリアイコン（薄緑の角丸タイル）を正方形に切り出して各サイズへ展開する。
favicon と PWA(any) アイコンは、旧 favicon（assets/quadtecho-mark.svg の rect rx=17 /
viewBox 64）と同じ比率で四隅を丸め、外側を透明にする。
Pillow や ImageMagick が無い環境でも動くよう、PNG のデコード/クロップ/リサイズ/
エンコードは標準ライブラリ（zlib / struct / math）だけで実装している。

使い方:
    python3 tools/make_site_icons.py            # assets/ogp.png → assets/icons/*.png
    python3 tools/make_site_icons.py --inspect  # 切り出し位置の確認（ピクセル調査）
"""
import math
import pathlib
import struct
import sys
import zlib

PNG_SIG = b'\x89PNG\r\n\x1a\n'

# 出力するアイコンのサイズ（favicon は 48 の倍数を用意すると Google が拾いやすい）
FAVICON_SIZES = (16, 32, 48, 96)
LARGE_SIZES = (144, 192, 512)
APPLE_TOUCH_SIZE = 180
# アイコンタイル（左上のアプリアイコン）を探す範囲
TILE_WINDOW = (60, 60, 220, 200)
# アイコンの角丸。旧 favicon（assets/quadtecho-mark.svg の rect rx=17 / viewBox 64）と同じ比率にそろえる。
# 0 にすると角丸なし（旧来の四角いアイコン）になる。
ICON_CORNER_RATIO = 17 / 64
# OGP画像側の背景（薄いクリーム色）。切り出し正方形の四隅に残るこの色を透明に抜いて、
# 「角丸タイル」だけが残るようにする（タイル自身の角丸と二重にならないようにするため）。
OGP_BACKGROUND = (241, 234, 221)
BACKGROUND_TOLERANCE = 10


def load_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == PNG_SIG, 'not a png'
    pos = 8
    idat = bytearray()
    palette = None
    trns = None
    ihdr = None
    while pos < len(data):
        (length,) = struct.unpack('>I', data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if ctype == b'IHDR':
            ihdr = struct.unpack('>IIBBBBB', chunk[:13])
        elif ctype == b'PLTE':
            palette = chunk
        elif ctype == b'tRNS':
            trns = chunk
        elif ctype == b'IDAT':
            idat += chunk
        elif ctype == b'IEND':
            break
    width, height, depth, color_type, comp, filt, interlace = ihdr
    assert depth == 8, 'only 8bit supported (got %d)' % depth
    assert interlace == 0, 'interlaced png not supported'
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    out = bytearray(height * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(height):
        ft = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if ft == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ft == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line

    # RGBA へ展開
    rgba = bytearray(width * height * 4)
    for i in range(width * height):
        if color_type == 6:
            r, g, b, a = out[i * 4:i * 4 + 4]
        elif color_type == 2:
            r, g, b = out[i * 3:i * 3 + 3]
            a = 255
        elif color_type == 3:
            idx = out[i]
            r, g, b = palette[idx * 3:idx * 3 + 3]
            a = trns[idx] if trns and idx < len(trns) else 255
        elif color_type == 4:
            v, a = out[i * 2:i * 2 + 2]
            r = g = b = v
        else:
            r = g = b = out[i]
            a = 255
        rgba[i * 4:i * 4 + 4] = bytes((r, g, b, a))
    return {'w': width, 'h': height, 'px': rgba, 'color_type': color_type}


def crop(img, x, y, w, h):
    src, sw = img['px'], img['w']
    out = bytearray(w * h * 4)
    for row in range(h):
        s = ((y + row) * sw + x) * 4
        out[row * w * 4:(row + 1) * w * 4] = src[s:s + w * 4]
    return {'w': w, 'h': h, 'px': out}


def pixel(img, x, y):
    o = (y * img['w'] + x) * 4
    return tuple(img['px'][o:o + 4])


def _contributions(src_len, dst_len):
    scale = dst_len / src_len
    support = 1.0 if scale >= 1 else 1.0 / scale
    table = []
    for i in range(dst_len):
        center = (i + 0.5) / scale
        start = max(0, int(math.floor(center - support)))
        end = min(src_len, int(math.ceil(center + support)))
        weights, total = [], 0.0
        for j in range(start, end):
            d = abs((j + 0.5) - center)
            wgt = max(0.0, 1.0 - d / support)
            if wgt > 0:
                weights.append((j, wgt))
                total += wgt
        if total <= 0:
            j = min(src_len - 1, max(0, int(center)))
            weights, total = [(j, 1.0)], 1.0
        table.append([(j, w / total) for j, w in weights])
    return table


def resize(img, dw, dh):
    w, h, px = img['w'], img['h'], img['px']
    ct = _contributions(w, dw)
    tmp = bytearray(dw * h * 4)
    for y in range(h):
        base = y * w * 4
        for i in range(dw):
            r = g = b = a = 0.0
            for j, wgt in ct[i]:
                o = base + j * 4
                r += px[o] * wgt
                g += px[o + 1] * wgt
                b += px[o + 2] * wgt
                a += px[o + 3] * wgt
            o = (y * dw + i) * 4
            tmp[o:o + 4] = bytes((int(r + .5), int(g + .5), int(b + .5), int(a + .5)))
    ct = _contributions(h, dh)
    out = bytearray(dw * dh * 4)
    for x in range(dw):
        for i in range(dh):
            r = g = b = a = 0.0
            for j, wgt in ct[i]:
                o = (j * dw + x) * 4
                r += tmp[o] * wgt
                g += tmp[o + 1] * wgt
                b += tmp[o + 2] * wgt
                a += tmp[o + 3] * wgt
            o = (i * dw + x) * 4
            out[o:o + 4] = bytes((int(r + .5), int(g + .5), int(b + .5), int(a + .5)))
    return {'w': dw, 'h': dh, 'px': out}


def _inside_rounded_rect(x, y, w, h, radius):
    """点 (x, y) が角丸四角形の内側か（四隅は半径 radius の円弧で判定する）"""
    cx = min(max(x, radius), w - radius)
    cy = min(max(y, radius), h - radius)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= radius * radius


def round_corners(img, radius_ratio=ICON_CORNER_RATIO, samples=4):
    """四隅を丸く抜き、切り出しに残った OGP の背景色も透明にする（favicon 用）。

    - 角丸は旧 favicon（assets/quadtecho-mark.svg の rx=17 / viewBox 64）と同じ比率。
    - 境界は 4x4 サンプリングの被覆率からアルファを作り、ギザギザを抑える。
    - 正方形で切り出した四隅には「タイル自身の角丸の外側（OGPの背景色）」が残るため、
      それを透明にして、角丸が二重に見えないようにする。
       タイル #EAF2E6 は g > r、背景 #F1EADD は r > g なので、r > g を条件にすると
      タイルの薄緑を消さずに背景だけを抜ける。
    """
    w, h, px = img['w'], img['h'], img['px']
    radius = min(w, h) * radius_ratio
    bg = OGP_BACKGROUND
    tol = BACKGROUND_TOLERANCE
    out = bytearray(px)
    for y in range(h):
        for x in range(w):
            o = (y * w + x) * 4
            r, g, b = px[o], px[o + 1], px[o + 2]
            if (r - g >= 4 and abs(r - bg[0]) <= tol and abs(g - bg[1]) <= tol and abs(b - bg[2]) <= tol):
                out[o + 3] = 0  # OGP の背景色（タイルの外側）→ 透明
                continue
            inside = 0
            for sy in range(samples):
                for sx in range(samples):
                    if _inside_rounded_rect(x + (sx + 0.5) / samples,
                                            y + (sy + 0.5) / samples, w, h, radius):
                        inside += 1
            coverage = inside / (samples * samples)
            if coverage < 1.0:
                out[o + 3] = min(out[o + 3], int(round(255 * coverage)))
    return {'w': w, 'h': h, 'px': out}


def save_png(path, img):
    w, h, px = img['w'], img['h'], img['px']
    opaque = all(px[i] == 255 for i in range(3, len(px), 4))
    channels = 3 if opaque else 4
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        row = px[y * w * 4:(y + 1) * w * 4]
        if channels == 3:
            for x in range(w):
                raw += row[x * 4:x * 4 + 3]
        else:
            raw += row

    def chunk(tag, payload):
        return (struct.pack('>I', len(payload)) + tag + payload
                + struct.pack('>I', zlib.crc32(tag + payload) & 0xFFFFFFFF))

    body = (PNG_SIG
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2 if channels == 3 else 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk(b'IEND', b''))
    open(path, 'wb').write(body)
    return len(body)


def find_tile_box(img, x0, y0, x1, y1):
    """指定領域内で「彩度のある画素（アイコンの絵）」と「タイル背景 #EAF2E6 系」の範囲を返す"""
    art = [x1, y1, x0, y0]
    tile = [x0, y0, x0, y0]
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, _ = pixel(img, x, y)
            if max(r, g, b) - min(r, g, b) > 20:                    # 色が付いた絵の部分
                art[0] = min(art[0], x); art[1] = min(art[1], y)
                art[2] = max(art[2], x); art[3] = max(art[3], y)
            if r < 241 and g > 236 and b > 224 and abs(r - g) < 12:  # タイルの薄い緑背景
                tile[0] = min(tile[0], x); tile[1] = min(tile[1], y)
                tile[2] = max(tile[2], x); tile[3] = max(tile[3], y)
    return {'art': art, 'tile': tile}


def solid(w, h, color):
    r, g, b = color
    return {'w': w, 'h': h, 'px': bytearray(bytes((r, g, b, 255)) * (w * h))}


def paste(canvas, img, x, y):
    """canvas の (x, y) へ img をそのまま重ねる（どちらも RGBA）"""
    cw, ch, cpx = canvas['w'], canvas['h'], canvas['px']
    iw, ih, ipx = img['w'], img['h'], img['px']
    for row in range(ih):
        cy = y + row
        if cy < 0 or cy >= ch:
            continue
        for col in range(iw):
            cx = x + col
            if cx < 0 or cx >= cw:
                continue
            s = (row * iw + col) * 4
            d = (cy * cw + cx) * 4
            cpx[d:d + 4] = ipx[s:s + 4]
    return canvas


def detect_tile(src):
    """OGP画像からアイコンタイル（薄緑の角丸スクエア #EAF2E6）の範囲を求める。

    ページ背景は #F1EADD 系（r > g）なので、g > r を条件に加えて確実に区別する。
    """
    x0, y0, x1, y1 = TILE_WINDOW
    left, top, right, bottom = x1, y1, x0, y0
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, _ = pixel(src, x, y)
            if (g - r >= 4 and abs(r - 234) <= 12 and abs(g - 242) <= 12 and abs(b - 230) <= 12):
                left, top = min(left, x), min(top, y)
                right, bottom = max(right, x), max(bottom, y)
    if left > right:
        raise SystemExit('アイコンタイルを検出できませんでした（--inspect で確認してください）')
    return left, top, right + 1, bottom + 1


def main():
    root = pathlib.Path(__file__).resolve().parent.parent
    source = root / 'assets' / 'ogp.png'
    outdir = source.parent / 'icons'
    outdir.mkdir(exist_ok=True)

    src = load_png(str(source))
    left, top, right, bottom = detect_tile(src)
    print('ogp.png %dx%d / タイル x=%d..%d y=%d..%d (%dx%d)'
          % (src['w'], src['h'], left, right - 1, top, bottom - 1, right - left, bottom - top))

    # 正方形に切り出す（タイルの周囲に OGP と同じ薄いクリーム色の余白を少し残す）
    size = max(right - left, bottom - top)
    pad = max(2, round(size * 0.05))
    side = size + pad * 2
    cx, cy = (left + right) // 2, (top + bottom) // 2
    x = min(max(0, cx - side // 2), src['w'] - side)
    y = min(max(0, cy - side // 2), src['h'] - side)
    base = crop(src, x, y, side, side)
    print('切り出し: %dx%d (x=%d, y=%d)' % (side, side, x, y))

    written = []
    # favicon・PWA(any) は角丸にして透明の四隅にする（旧 quadtecho-mark.svg と同じ角丸）
    for size_px in FAVICON_SIZES:
        written.append(('favicon-%d.png' % size_px,
                        save_png(str(outdir / ('favicon-%d.png' % size_px)),
                                 round_corners(resize(base, size_px, size_px)))))
    for size_px in LARGE_SIZES:
        written.append(('icon-%d.png' % size_px,
                        save_png(str(outdir / ('icon-%d.png' % size_px)),
                                 round_corners(resize(base, size_px, size_px)))))
    # apple-touch-icon は iOS が自前でマスクするため、透明を残さず正方形のまま出力する
    written.append(('apple-touch-icon.png',
                    save_png(str(outdir / 'apple-touch-icon.png'),
                             resize(base, APPLE_TOUCH_SIZE, APPLE_TOUCH_SIZE))))

    # Android のマスカブルアイコン: 背景を OGP と同じ色で埋め、タイルを安全領域(72%)に収める
    maskable = solid(512, 512, pixel(src, 600, 600)[:3])
    inner = resize(base, round(512 * 0.72), round(512 * 0.72))
    paste(maskable, inner, (512 - inner['w']) // 2, (512 - inner['h']) // 2)
    written.append(('icon-maskable-512.png',
                    save_png(str(outdir / 'icon-maskable-512.png'), maskable)))

    for name, nbytes in written:
        print('  %-24s %6.1f KB' % (name, nbytes / 1024))
    print('出力先: %s' % outdir)


def inspect(path):
    src = load_png(path)
    print('image: %dx%d color_type=%d' % (src['w'], src['h'], src['color_type']))
    print('bg sample (600,600):', pixel(src, 600, 600))
    box = find_tile_box(src, *TILE_WINDOW)
    for key, (bx0, by0, bx1, by1) in box.items():
        print('%-5s x=%d..%d (w=%d)  y=%d..%d (h=%d)'
              % (key, bx0, bx1, bx1 - bx0 + 1, by0, by1, by1 - by0 + 1))
    print('detect_tile():', detect_tile(src))


if __name__ == '__main__':
    if '--inspect' in sys.argv:
        inspect(sys.argv[-1] if sys.argv[-1].endswith('.png') else 'assets/ogp.png')
    else:
        main()
