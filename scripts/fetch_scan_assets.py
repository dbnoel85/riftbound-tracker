"""Collect reference card images + embedding models into ./scan-assets (pushed to the scan-assets branch, for testing)."""
import json, os, io, requests
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

OUT = "scan-assets"
os.makedirs(f"{OUT}/img", exist_ok=True)
os.makedirs(f"{OUT}/models", exist_ok=True)
s = requests.Session(); s.headers["User-Agent"] = "riftbound-tracker"
cards = json.load(open("data/cards.json"))
fix = json.load(open("data/imgfix.json")) if os.path.exists("data/imgfix.json") else {}
todo = {}
for it in cards["items"]:
    if it.get("sealed") or not it.get("img"):
        continue
    todo[str(it["p"])] = fix.get(str(it["p"])) or it["img"]

def one(kv):
    pid, url = kv
    urls = [url.replace("_200w.jpg", "_in_1000x1000.jpg"), url] if "tcgplayer" in url else [url]
    for u in urls:
        try:
            r = s.get(u, timeout=30)
            if r.status_code == 200 and len(r.content) > 2000:
                im = Image.open(io.BytesIO(r.content)).convert("RGB")
                im.thumbnail((640, 640))
                im.save(f"{OUT}/img/{pid}.jpg", quality=88)
                return 1
        except Exception as e:  # noqa: BLE001
            print(pid, u, e)
    return 0

with ThreadPoolExecutor(8) as ex:
    n = sum(ex.map(one, todo.items()))
print("images", n, "of", len(todo))
for name, url in {
    "mnv3_small.tflite": "https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/latest/mobilenet_v3_small.tflite",
    "mnv3_large.tflite": "https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_large/float32/latest/mobilenet_v3_large.tflite",
}.items():
    r = s.get(url, timeout=60); print(name, r.status_code, len(r.content))
    if r.ok:
        open(f"{OUT}/models/{name}", "wb").write(r.content)
