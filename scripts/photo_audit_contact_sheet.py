#!/usr/bin/env python3
"""Read-only 65-photo visual QA; generate contact sheets and per-image checks."""
import concurrent.futures
import io
import json
import re
import statistics
from pathlib import Path
from urllib.parse import urlparse

import requests
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageStat

root=Path(__file__).resolve().parent.parent
html=(root/'index.html').read_text(encoding='utf-8')
match=re.search(r'const __CATALOG__=(\[.*?\]);\s*start\(__CATALOG__\);',html,re.S)
if not match: raise RuntimeError("Embedded catalog missing")
items=json.loads(match.group(1))
if len(items)!=65: raise RuntimeError(f"Expected 65 active items got {len(items)}")
out=root/'photo_audit'
out.mkdir(exist_ok=True)
try:
  font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',15)
  small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',12)
except OSError:
  font=ImageFont.load_default()
  small=font

def fetch(args):
  idx,item=args
  url=item['photo']
  record=dict(id=item['id'],city=item['city'],title=item['title'],url=url,host=urlparse(url).netloc)
  try:
    resp=requests.get(url,headers={'User-Agent':'Mozilla/5.0 (compatible; HG-Wedding-Photo-QA/1.0)'},timeout=22)
    resp.raise_for_status()
    im=Image.open(io.BytesIO(resp.content))
    im.load()
    im=im.convert("RGB")
    record['width'],record['height']=im.size
    low=im.copy();low.thumbnail((128,128))
    record['average_brightness']=round(statistics.mean(ImageStat.Stat(low.convert("L")).mean),1)
    record['bytes']=len(resp.content)
    record['ok']=True
    record['potentially_dark']=record['average_brightness'] < 67
    return (idx,record,im)
  except Exception as exc:
    record.update(ok=False,error=f"{type(exc).__name__}: {str(exc)[:170]}")
    return(idx,record,None)

with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
  results=sorted(pool.map(fetch,enumerate(items)),key=lambda x:x[0])
report=[r for _,r,_ in results]
(out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
card_w,card_h=284,230
img_w,img_h=274,170
cols=5
for page in range(2):
  subset=results[page*35:(page+1)*35]
  rows=(len(subset)+cols-1)//cols
  board=Image.new("RGB",(card_w*cols,card_h*rows),(248,246,241))
  draw=ImageDraw.Draw(board)
  for i,(idx,info,im) in enumerate(subset):
    x=(i%cols)*card_w;y=(i//cols)*card_h
    if im is None:
      draw.rectangle((x+4,y+4,x+img_w+4,y+img_h+4),fill=(120,50,50))
      draw.text((x+12,y+65),"NO CARGÓ FOTO",font=font,fill="white")
    else:
      thumb=ImageOps.fit(im,(img_w,img_h),method=Image.Resampling.LANCZOS,centering=(0.5,0.5))
      board.paste(thumb,(x+4,y+4))
    draw.rectangle((x+4,y+174,x+img_w+4,y+card_h-1),fill=(255,255,255))
    txt=info['title']
    if len(txt)>33:txt=txt[:32]+'…'
    draw.text((x+9,y+180),info['id']+" "+info['city'],font=font,fill=(15,38,54))
    draw.text((x+9,y+200),txt,font=small,fill=(18,47,70))
    if not info['ok'] or info.get('potentially_dark'):
      draw.rectangle((x+257,y+5,x+278,y+26),fill=(182,55,35))
      draw.text((x+261,y+6),"!",font=font,fill="white")
  board.save(out/f"contact_sheet_{page+1}.jpg",quality=88,subsampling=0,optimize=True)
print(json.dumps({"pictures":len(report),"ok":sum(r['ok'] for r in report),"failed":[r['id'] for r in report if not r['ok']],"dark":[r['id'] for r in report if r.get('potentially_dark')]}))
