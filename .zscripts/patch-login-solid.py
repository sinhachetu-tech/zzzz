import io

p = 'src/app/client/login.tsx'
s = io.open(p, encoding='utf-8').read()

# 1) form cards: SOLID (no transparency, no blur)
s = s.replace('''background: "color-mix(in srgb, var(--raised) 58%, transparent)", backdropFilter: "blur(14px)", border: "1px solid color-mix(in srgb, var(--line) 55%, rgba(255,255,255,0.18))", boxShadow: "0 20px 50px -20px rgba(0,0,0,0.6)"''',
'''background: "var(--raised)", border: "1px solid var(--line)", boxShadow: "0 24px 60px -24px rgba(0,0,0,0.55)"''')

# 2) mode chips: solid
s = s.replace('''background: "rgba(242,176,76,0.3)", borderColor: "var(--amber)", color: "var(--amber)", backdropFilter: "blur(8px)"''',
'''background: "color-mix(in srgb, var(--amber) 24%, var(--raised))", borderColor: "var(--amber)", color: "var(--amber)"''')
s = s.replace('''background: "rgba(67,214,155,0.28)", borderColor: "var(--mint)", color: "var(--mint)", backdropFilter: "blur(8px)"''',
'''background: "color-mix(in srgb, var(--mint) 22%, var(--raised))", borderColor: "var(--mint)", color: "var(--mint)"''')
s = s.replace('''background: "color-mix(in srgb, var(--raised) 60%, transparent)", borderColor: "var(--line)", color: "var(--ink)", backdropFilter: "blur(8px)"''',
'''background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink)"''')

# 3) HFMC badge: solid
s = s.replace('''background: "rgba(6,13,17,0.45)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.14)"''',
'''background: "var(--raised)", border: "1px solid var(--line)"''')
s = s.replace('''<div className="font-disp font-bold text-[18px] tracking-[0.04em] leading-none text-white">HFMC</div>''',
'''<div className="font-disp font-bold text-[18px] tracking-[0.04em] leading-none" style={{ color: "var(--amber)" }}>HFMC</div>''')
s = s.replace('''style={{ color: "rgba(255,255,255,0.75)" }}>Client Portal</div>''',
'''style={{ color: "var(--ink-faint)" }}>Client Portal</div>''')

# 4) photo: brighter + more saturated; overlay much lighter (just edge vignette for card contrast)
s = s.replace('''          background: "linear-gradient(180deg, rgba(6,13,17,0.55) 0%, rgba(6,13,17,0.35) 45%, rgba(6,13,17,0.75) 100%)",''',
'''          background: "linear-gradient(180deg, rgba(6,13,17,0.18) 0%, rgba(6,13,17,0.10) 45%, rgba(6,13,17,0.45) 100%)",''')
s = s.replace('''          animation: "kenburns 26s ease-in-out infinite alternate",''',
'''          filter: "brightness(1.16) saturate(1.22) contrast(1.03)",
          animation: "kenburns 26s ease-in-out infinite alternate",''')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("solid + bright ok")
