"""Generate the app's code-native Perch p. mark as dependency-free PNG assets."""
from pathlib import Path
import math
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1] / 'public' / 'icons'

def distance(x, y, ax, ay, bx, by):
    t = max(0, min(1, ((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)))
    return math.hypot(x-ax-t*(bx-ax), y-ay-t*(by-ay))

def draw(size, filename):
    pixels = bytearray()
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            px, py = (x + .5)/size, (y + .5)/size
            ink = min(distance(px,py,.34,.29,.34,.73), distance(px,py,.34,.29,.53,.29), distance(px,py,.53,.29,.62,.37), distance(px,py,.62,.37,.62,.45), distance(px,py,.62,.45,.53,.53), distance(px,py,.53,.53,.34,.53)) - .026
            dot = math.hypot(px-.73,py-.70)-.029
            coverage = max(0, min(1, .5 - min(ink,dot)*size))
            pixels.extend(round(a+(b-a)*coverage) for a,b in zip((37,43,51),(227,232,239)))
    def chunk(kind, data):
        return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data)&0xffffffff)
    content=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(pixels))+chunk(b'IEND',b'')
    (ROOT/filename).write_bytes(content)

for size,name in [(192,'app-192.png'),(512,'app-512.png'),(512,'app-maskable-512.png'),(180,'apple-touch-icon.png')]:
    draw(size,name)
