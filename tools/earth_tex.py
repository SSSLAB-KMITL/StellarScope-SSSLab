# Regenerate assets/earth.png from Natural Earth GeoJSON (public domain).
# Usage: download ne_50m_land, ne_50m_lakes and ne_50m_admin_0_boundary_lines_land .geojson
# from https://github.com/nvkelso/natural-earth-vector/tree/master/geojson into a folder, then:
#   python3 tools/earth_tex.py <folder> assets/earth.png   (requires Pillow)
import json, sys
from PIL import Image, ImageDraw, ImageFilter
W, H = 4096, 2048
SS = 2  # supersample
ne = sys.argv[1]; out = sys.argv[2]
def xy(lon, lat):
    return ((lon + 180.0) / 360.0 * W * SS, (90.0 - lat) / 180.0 * H * SS)
def rings(geom):
    t = geom["type"]; c = geom["coordinates"]
    if t == "Polygon": return [c]
    if t == "MultiPolygon": return c
    return []
def lines(geom):
    t = geom["type"]; c = geom["coordinates"]
    if t == "LineString": return [c]
    if t == "MultiLineString": return c
    return []
# ocean: vertical gradient deep navy
img = Image.new("RGB", (W*SS, H*SS))
d = ImageDraw.Draw(img)
for y in range(H*SS):
    f = abs(y/(H*SS) - 0.5) * 2
    r = int(14 + 6*f); g = int(38 + 10*f); b = int(72 + 14*f)
    d.line([(0, y), (W*SS, y)], fill=(r, g, b))
land = Image.new("L", (W*SS, H*SS), 0)
ld = ImageDraw.Draw(land)
for feat in json.load(open(f"{ne}/ne_50m_land.geojson"))["features"]:
    for poly in rings(feat["geometry"]):
        ld.polygon([xy(*p[:2]) for p in poly[0]], fill=255)
        for hole in poly[1:]:
            ld.polygon([xy(*p[:2]) for p in hole], fill=0)
for feat in json.load(open(f"{ne}/ne_50m_lakes.geojson"))["features"]:
    for poly in rings(feat["geometry"]):
        ld.polygon([xy(*p[:2]) for p in poly[0]], fill=0)
# land colour: latitude-tinted (greener tropics, paler poles)
landcol = Image.new("RGB", (W*SS, H*SS))
lc = ImageDraw.Draw(landcol)
for y in range(H*SS):
    lat = 90 - y/(H*SS)*180
    a = abs(lat)
    t = min(a/60, 1.0)
    base = (52 + 66*t, 92 + 36*t, 60 + 26*t)
    s = min(max((a-62)/14, 0.0), 1.0)
    snow = (205, 212, 216)
    col = tuple(int(base[i]*(1-s) + snow[i]*s) for i in range(3))
    lc.line([(0, y), (W*SS, y)], fill=col)
img.paste(landcol, (0, 0), land)
# coastline stroke
edge = land.filter(ImageFilter.FIND_EDGES)
img.paste((150, 190, 210), (0, 0), edge)
# borders
for feat in json.load(open(f"{ne}/ne_50m_admin_0_boundary_lines_land.geojson"))["features"]:
    for ln in lines(feat["geometry"]):
        d.line([xy(*p[:2]) for p in ln], fill=(170, 175, 150), width=2)
img = img.resize((W, H), Image.LANCZOS)
img.save(out, optimize=True)
print("ok", out)
