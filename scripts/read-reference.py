"""Convert the provided editable Dasan20 artwork to a restricted geometric model."""
import json, re, pathlib, xml.etree.ElementTree as ET
root = pathlib.Path(__file__).resolve().parents[1]
svg = ET.parse(next((root/'reference').glob('Dasan20*/*Editable.svg'))).getroot()
palette = {'#393334':'ink', '#686163':'soft', '#b9b1ad':'line'}
items = []
def visit(el, angle=0):
    tag = el.tag.split('}')[-1]
    a = el.attrib
    x,y = (float(a.get(k,0)) for k in ('x','y'))
    if tag=='g' and 'translate' in a.get('transform',''):
        x,y=map(float,re.findall(r'[\d.]+',a['transform']))
        item=dict(kind='flower',x=x,y=y,radius=28)
    elif tag=='g':
        angle=float(re.search(r'rotate\(([-\d.]+)',a['transform'])[1])
        for child in el: visit(child,angle)
        return
    elif tag=='text':
        item=dict(kind='text',text=el.text,x=x,y=y,font='sans' if 'Sans' in a['font-family'] else 'serif',
                  size=float(a['font-size']),weight=int(a['font-weight']),anchor=a['text-anchor'],spacing=float(a['letter-spacing']),angle=angle)
    elif tag=='path':
        pairs=re.findall(r'([-\d.]+),([-\d.]+)',a['d'])
        item=dict(kind='line',points=[[float(x),float(y)] for x,y in pairs],width=float(a['stroke-width']))
        y=min(p[1] for p in item['points'])
    elif tag=='circle':
        item=dict(kind='dot',x=float(a['cx']),y=float(a['cy']),radius=float(a['r']))
    else: return
    item.update(id='ref-'+str(len(items)),tone=palette[a.get('stroke',a.get('fill'))],footer=y>1140,hidden=False)
    items.append(item)
for child in svg: visit(child)
(root/'src/reference.json').write_text(json.dumps(dict(ink='#393334',items=items),ensure_ascii=False,indent=2)+'\n')
