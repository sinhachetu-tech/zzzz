import io

p = 'src/app/client/dashboard.tsx'
s = io.open(p, encoding='utf-8').read()

# 1) tab state + icons import
s = s.replace('''import { LogoMark, ICheck, IClock, IWhatsapp, IDownload, IUpload, ILogout } from "@/components/icons";''',
'''import { LogoMark, ICheck, IClock, IWhatsapp, IDownload, IUpload, ILogout, IUsers, IHome, IPlus } from "@/components/icons";
import { ageFromDob, parseCaseProfile } from "@/lib/case-profile";''')

s = s.replace('''  const hour = new Date().getHours();''','''  const [tab, setTab] = useState<"journey" | "docs" | "details" | "more">("journey");
  const hour = new Date().getHours();''')

# 2) wrap main content per tab: Journey = hero..timeline; Docs = DocUploadCards; Details/More = new components
# find the main open and the doc/advisor/footer ordering: restructure by moving DocUploadCards out of main flow
s = s.replace('''        {/* advisor — right up top where it belongs */}''','''        {/* advisor — right up top where it belongs */}
        {tab === "journey" && (''')

s = s.replace('''            )}
          </div>
        )}

        {/* latest update */}''','''            )}
          </div>
        )}

        )}

        {/* latest update */}''')

# simpler robust approach: rebuild via markers — replace whole main content wrapper start/end markers
# Instead of surgical nesting, gate each block by tab using prefix replacements:
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("stage 1 ok")
