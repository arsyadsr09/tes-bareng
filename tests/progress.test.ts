// Client-side domain logic (CLAUDE.md "Domain logic"): days active, eligibility,
// ready / low-engagement flags. Pure functions from web/src/lib/progress.ts.
import { describe, expect, it } from "vitest";
import { computeProgress, daysActive, isEligible, isNewBuild, openSeats, relDay } from "../web/src/lib/progress";
import type { AppDoc, BuildDoc, TesterDoc } from "../web/src/lib/types";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 31, 12);
const daysAgo = (n: number) => NOW - n * DAY;

let seq = 0;
function tester(over: Partial<TesterDoc> = {}): TesterDoc {
  seq += 1;
  return {
    id: `t${seq}`,
    appId: "a",
    uid: `u${seq}`,
    displayName: `Tester ${seq}`,
    maskedEmail: "te*****@gmail.com",
    optedInAt: daysAgo(3),
    leftAt: null,
    status: "active",
    addedBy: "self",
    feedbackSent: false,
    feedbackVerified: false,
    replied: false,
    ...over,
  };
}

const app = (over: Partial<AppDoc> = {}): AppDoc => ({
  id: "a",
  name: "Kas RT Digital",
  description: "x",
  optInUrl: "https://play.google.com/apps/testing/id.a.b",
  creatorUid: "c",
  creatorName: "Rina",
  status: "testing",
  testerSlots: 12,
  activeTesterCount: 0,
  eligibleCount: 0,
  countedDays: 0,
  feedbackSentCount: 0,
  feedbackVerifiedCount: 0,
  repliedCount: 0,
  buildCount: 0,
  createdAt: daysAgo(20),
  deleted: false,
  ...over,
});
const build = (d: number): BuildDoc => ({ id: `b${d}`, versionName: "1.0", uploadedAt: daysAgo(d), changelog: "x" });

describe("daysActive / isEligible", () => {
  it("is eligible from day 14 when active", () => {
    expect(isEligible(tester({ optedInAt: daysAgo(14) }), NOW)).toBe(true);
    expect(isEligible(tester({ optedInAt: daysAgo(14) + 1 }), NOW)).toBe(false);
  });

  it("stops counting at leftAt for Left entries", () => {
    const t = tester({ status: "left", optedInAt: daysAgo(20), leftAt: daysAgo(15) });
    expect(daysActive(t, NOW)).toBe(5);
    expect(isEligible(t, NOW)).toBe(false);
  });

  it("is never negative", () => {
    expect(daysActive(tester({ optedInAt: NOW + DAY }), NOW)).toBe(0);
  });

  it("Removed is never eligible", () => {
    expect(isEligible(tester({ status: "removed", optedInAt: daysAgo(30), leftAt: daysAgo(1) }), NOW)).toBe(false);
  });
});

describe("computeProgress", () => {
  it("counts active testers only and flags ready at 12 eligible", () => {
    const list = [
      ...Array.from({ length: 12 }, () => tester({ optedInAt: daysAgo(15), feedbackSent: true })),
      tester({ status: "left", optedInAt: daysAgo(30), leftAt: daysAgo(1), feedbackSent: true }),
      tester({ status: "removed", feedbackSent: true }),
    ];
    const p = computeProgress(app(), list, [build(2)], NOW);
    expect(p).toMatchObject({ active: 12, eligible: 12, feedbackSent: 12, ready: true, lowEngagement: false, builds: 1 });
  });

  it("uses the app's tester slots as the target (ADR-012)", () => {
    const list = Array.from({ length: 3 }, () => tester({ optedInAt: daysAgo(15), feedbackSent: true }));
    expect(computeProgress(app({ testerSlots: 4 }), list, [build(2)], NOW)).toMatchObject({ target: 4, ready: false });
    expect(computeProgress(app({ testerSlots: 3 }), list, [build(2)], NOW)).toMatchObject({ target: 3, ready: true });
  });

  it("openSeats: slots minus active testers; full at 0 or less", () => {
    expect(openSeats(app({ testerSlots: 4, activeTesterCount: 1 }))).toBe(3);
    expect(openSeats(app({ testerSlots: 4, activeTesterCount: 6 }))).toBe(-2);
  });

  it("low engagement: fewer than half of eligible sent feedback, or no build", () => {
    const list = [tester({ optedInAt: daysAgo(15), feedbackSent: true }), tester({ optedInAt: daysAgo(15) }), tester({ optedInAt: daysAgo(15) })];
    expect(computeProgress(app(), list, [build(1)], NOW).lowEngagement).toBe(true);
    expect(computeProgress(app(), [tester()], [], NOW).lowEngagement).toBe(true);
    expect(computeProgress(app(), [], [], NOW).lowEngagement).toBe(false);
  });

  it("counts builds from the test start date (one day of slack)", () => {
    const p = computeProgress(app({ testStartDate: daysAgo(5) }), [], [build(1), build(5), build(6), build(9)], NOW);
    expect(p.builds).toBe(3);
  });

  it("test day: 0 until every slot is filled, then days of the slot-th tester", () => {
    const two = [tester({ optedInAt: daysAgo(9) }), tester({ optedInAt: daysAgo(4) })];
    expect(computeProgress(app({ testerSlots: 3, testStartDate: daysAgo(4) }), two, [], NOW).testDay).toBe(0);
    expect(computeProgress(app({ testerSlots: 2 }), two, [], NOW).testDay).toBe(4);
  });

  it("seats are sorted by days active, most first", () => {
    const p = computeProgress(app(), [tester({ optedInAt: daysAgo(2) }), tester({ optedInAt: daysAgo(16) })], [], NOW);
    expect(p.seats.map((s) => s.days)).toEqual([16, 2]);
    expect(p.seats[0].eligible).toBe(true);
  });
});

describe("new build banner and relative days", () => {
  it("shows for 3 days after a build", () => {
    expect(isNewBuild({ lastBuildAt: daysAgo(2) }, NOW)).toBe(true);
    expect(isNewBuild({ lastBuildAt: daysAgo(3) }, NOW)).toBe(false);
    expect(isNewBuild({ lastBuildAt: null }, NOW)).toBe(false);
  });

  it("relDay", () => {
    expect(relDay(NOW, NOW)).toBe("hari ini");
    expect(relDay(daysAgo(1), NOW)).toBe("kemarin");
    expect(relDay(daysAgo(4), NOW)).toBe("4 hari yang lalu");
    expect(relDay(null, NOW)).toBe("—");
  });
});
