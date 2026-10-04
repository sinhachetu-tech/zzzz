// Phase F access-control tests. These exercise the REAL visibleCases()/canEditCase()
// from src/lib/domain.ts — a re-implementation here would pass while the shipped code
// was broken, which is exactly the mistake Phase 5's test made.
import { visibleCases, canEditCase, spansAllDepartments, canEditDepartment } from "../src/lib/domain.ts";
import type { LoanCase, User, RoleFlags } from "../src/lib/types.ts";

const flags = (over: Partial<RoleFlags>): RoleFlags => ({
  scope: "own", serviceLineIds: [], issueTasks: false, admin: false, super: false,
  viewRevenue: false, editEibor: false, manageDocs: true, clientChat: true, ...over,
});

const user = (over: Partial<User>): User => ({
  id: 1, name: "U", email: "u@x", password: "", role: "Mortgage Officer",
  team: "Dubai", active: true, createdAt: "2024-01-01", ...over,
} as User);

const kase = (over: Partial<LoanCase>): LoanCase => ({
  id: 1, caseNumber: "HFMC-1", customer: "Ahmed", banks: [], wonBank: null, bankRef: null,
  parentCaseId: null, loanAmount: 1000, propertyValue: null, stage: "Doc", caseStatus: "Active",
  closedDate: null, ownerId: 2, source: "Direct", legStatus: "Active",
  decidedAt: null, decidedById: null, serviceLineId: 1, productId: null, legCount: 0,
  createdAt: "2024-01-01", updatedAt: "2024-01-01", backup1Id: null, backup2Id: null,
  advisorId: null, vrmId: null, clientId: null, secondPartyClientId: null, ...over,
} as LoanCase);

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log("FAIL " + name + " got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)); }
};
const ids = (cs: LoanCase[]) => cs.map((c) => c.id).sort((a, b) => a - b);

const MORT = "MORTGAGE", WILLS = "WILS_LEGAL";

// 1-5. Empty serviceLineIds must mean UNRESTRICTED, so upgrading the app grants
// access rather than silently removing it from every existing colleague.
check("1 empty ids spans all", spansAllDepartments(flags({ serviceLineIds: [] })), true);
check("2 super spans all", spansAllDepartments(flags({ super: true, serviceLineIds: [WILLS] })), true);
check("3 admin spans all", spansAllDepartments(flags({ admin: true, serviceLineIds: [WILLS] })), true);
check("4 restricted detects", spansAllDepartments(flags({ serviceLineIds: [WILLS] })), false);
check("5 null flags fail open", spansAllDepartments(null), true);

// 6-8. Department membership.
check("6 no line editable", canEditDepartment(flags({ serviceLineIds: [WILLS] }), null), true);
check("7 wrong dept blocked", canEditDepartment(flags({ serviceLineIds: [WILLS] }), MORT), false);
check("8 right dept allowed", canEditDepartment(flags({ serviceLineIds: [WILLS] }), WILLS), true);

// 9-12. THE REGRESSION GUARD. Every real designation today is "[]", so visibleCases
// must behave EXACTLY as it did before Phase F was written.
const legacyUsers = [user({ id: 2 }), user({ id: 3 }), user({ id: 9, team: "Abu Dhabi" })];
const legacyCases = [kase({ id: 1, ownerId: 2 }), kase({ id: 2, ownerId: 3 }), kase({ id: 3, ownerId: 9 })];
check("9 legacy own", ids(visibleCases(legacyCases, legacyUsers, user({ id: 2 }), flags({ scope: "own" }))), [1]);
check("10 legacy all", ids(visibleCases(legacyCases, legacyUsers, user({ id: 2 }), flags({ scope: "all" }))), [1, 2, 3]);
check("11 legacy team", ids(visibleCases(legacyCases, legacyUsers, user({ id: 2 }), flags({ scope: "team" }))), [1, 2]);
// Backup assignment has always granted access at every scope; Phase F must not break it.
check("12 backup sees", ids(visibleCases([kase({ id: 5, ownerId: 3, backup1Id: 2 })], legacyUsers, user({ id: 2 }), flags({ scope: "own" }))), [5]);

// 13-17. Department restriction + READ-ACROSS, WRITE-LOCAL.
const deptCases = [
  kase({ id: 10, ownerId: 2, clientId: 100, serviceLineCode: WILLS, serviceLineId: 5 }),
  kase({ id: 11, ownerId: 3, clientId: 100, serviceLineCode: MORT, serviceLineId: 1 }),
  kase({ id: 12, ownerId: 3, clientId: 999, serviceLineCode: MORT, serviceLineId: 1 }),
  kase({ id: 13, ownerId: 3, clientId: 999, serviceLineCode: WILLS, serviceLineId: 5 }),
];
const willsOfficer = user({ id: 2 });
const willsFlags = flags({ scope: "own", serviceLineIds: [WILLS] });

// 10 = own case. 11 = READ-ACROSS (same client 100, other department).
// 12 = another client entirely -> hidden. 13 = right department, someone else's file.
check("13 read-across", ids(visibleCases(deptCases, legacyUsers, willsOfficer, willsFlags)), [10, 11]);

// 14. THE POINT OF THE WHOLE PHASE: case 11 is readable but NOT editable. Read-across
// without an edit lock is the same mistake as handing everyone the login.
check("14 read-across not editable", canEditCase(deptCases[1], legacyUsers, willsOfficer, willsFlags), false);
check("15 own dept editable", canEditCase(deptCases[0], legacyUsers, willsOfficer, willsFlags), true);

// 16. A mortgage officer must not see an unrelated client's will.
check("16 other dept hidden", ids(visibleCases(deptCases, legacyUsers, user({ id: 3 }), flags({ scope: "all", serviceLineIds: [MORT] }))), [11, 12]);

// 17. Read-across follows the co-borrower link too (secondPartyClientId), which is
// how a co-borrower's own mortgage becomes visible to the wills team.
check("17 read-across via 2nd party", ids(visibleCases(
  [kase({ id: 20, ownerId: 2, secondPartyClientId: 55, serviceLineCode: WILLS, serviceLineId: 5 }),
   kase({ id: 21, ownerId: 3, clientId: 55, serviceLineCode: MORT, serviceLineId: 1 })],
  legacyUsers, willsOfficer, willsFlags)), [20, 21]);

console.log("PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);