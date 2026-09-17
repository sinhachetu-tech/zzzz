import io

p = 'src/app/client/login.tsx'
s = io.open(p, encoding='utf-8').read()

# 1) theme toggle import
s = s.replace('''import { LogoMark } from "@/components/icons";''',
'''import { LogoMark } from "@/components/icons";
import { ThemeToggle } from "@/components/hfmc/ui";''')

# 2) full-screen Dubai backdrop with Ken Burns + overlay + floating theme toggle;
#    the form becomes a glass card
old = '''  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div className="app-bg" />
      <div className="w-full max-w-[400px] anim-fade-up">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <LogoMark size={36} />
          <div>
            <div className="font-disp font-bold text-[18px] tracking-[0.04em] leading-none">HFMC</div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)] mt-0.5">Client Portal</div>
          </div>
        </div>'''
new = '''  return (
    <div className="min-h-screen relative flex items-center justify-center px-4 overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* Dubai backdrop — slow Ken Burns drift (zoom + pan), Unsplash license */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute inset-0" style={{
          backgroundImage: "url(/dubai-login.jpg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          animation: "kenburns 26s ease-in-out infinite alternate",
        }} />
        <div className="absolute inset-0" style={{
          background: "linear-gradient(180deg, rgba(6,13,17,0.55) 0%, rgba(6,13,17,0.35) 45%, rgba(6,13,17,0.75) 100%)",
        }} />
      </div>
      <style>{`@keyframes kenburns { 0%{transform:scale(1) translate(0,0)} 100%{transform:scale(1.12) translate(-1.5%,1.5%)} }`}</style>
      <div className="absolute top-3 right-3 z-20"><ThemeToggle compact /></div>
      <div className="w-full max-w-[400px] anim-fade-up relative z-10">
        <div className="flex items-center gap-2.5 mb-6 justify-center">
          <div className="rounded-xl px-4 py-2.5 flex items-center gap-2.5" style={{ background: "rgba(6,13,17,0.45)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.14)" }}>
            <LogoMark size={34} />
            <div>
              <div className="font-disp font-bold text-[18px] tracking-[0.04em] leading-none text-white">HFMC</div>
              <div className="text-[9px] uppercase tracking-[0.18em] mt-0.5" style={{ color: "rgba(255,255,255,0.75)" }}>Client Portal</div>
            </div>
          </div>
        </div>'''
assert old in s, "login header anchor missing"
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("backdrop ok")
