import io

# 1) case-profile.ts — dob, processingMonths, age-from-dob helper
p = 'src/lib/case-profile.ts'
s = io.open(p, encoding='utf-8').read()

s = s.replace('''export interface ApplicantDetails {
  fullName: string;
  dob?: string;
  age?: number;''', '''export interface ApplicantDetails {
  fullName: string;
  dob?: string;          // ISO date — drives the age-based tenure cap
  age?: number;          // manual fallback when DOB is unknown
  disbursementMonths?: number; // expected application->disbursement lag (months)''')

s = s.replace('''export interface CaseProfile {
  primary: ApplicantDetails;
  property: PropertyDetails;
  secondParty: SecondPartyDetails;
}''', '''export interface CaseProfile {
  primary: ApplicantDetails;
  property: PropertyDetails;
  secondParty: SecondPartyDetails;
  /** expected months from application to first EMI — banks take 2-4 months;
      tenure must be measured at disbursement, not application. Default 3. */
  processingMonths?: number;
}

/** Age in whole years from an ISO dob, as of today. */
export function ageFromDob(dob?: string | null): number | undefined {
  if (!dob) return undefined;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return undefined;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a >= 0 && a < 120 ? a : undefined;
}''')

# parser: derive age from dob
s = s.replace('''        dob: p.primary.dob ?? undefined,
        age: typeof p.primary.age === "number" ? p.primary.age : undefined,''', '''        dob: p.primary.dob ?? undefined,
        age: ageFromDob(p.primary.dob) ?? (typeof p.primary.age === "number" ? p.primary.age : undefined),''')
s = s.replace('''        dob: p.secondParty?.dob ?? undefined,
        age: typeof p.secondParty?.age === "number" ? p.secondParty?.age : undefined,''', '''        dob: p.secondParty?.dob ?? undefined,
        age: ageFromDob(p.secondParty?.dob) ?? (typeof p.secondParty?.age === "number" ? p.secondParty?.age : undefined),''')
s = s.replace('''  } catch {
    return defaultCaseProfile(fallbackCase);
  }
}''', '''  } catch {
    return defaultCaseProfile(fallbackCase);
  }
}''')
s = s.replace('''      },
    };
  } catch {
    return defaultCaseProfile(fallbackCase);
  }
}''', '''      },
      processingMonths: Number(p.processingMonths) || 3,
    };
  } catch {
    return defaultCaseProfile(fallbackCase);
  }
}''')
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("case-profile ok")
