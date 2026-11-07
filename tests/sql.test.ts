// SQL unit tests: mask_email, check constraints, and the maths of the computed
// stats views.
import { beforeAll, describe, expect, it } from "vitest";
import { ago, anon, DAY_MS, member, must, profileStats, service, stats, trackCohort, uniq, type Member } from "./helpers";

describe("mask_email", () => {
  it.each([
    ["budi.santoso@gmail.com", "bu*****@gmail.com"],
    ["ab@gmail.com", "ab*****@gmail.com"],
    ["a@gmail.com", "a*****@gmail.com"],
    ["Siti.Rahma@Gmail.com", "si*****@gmail.com"],
    ["  dewi@yahoo.co.id ", "de*****@yahoo.co.id"],
  ])("%s -> %s", async (input, expected) => {
    expect(await must(anon().rpc("mask_email", { email: input }))).toBe(expected);
  });

  it("always uses five asterisks regardless of local-part length", async () => {
    expect(await must(anon().rpc("mask_email", { email: "abcdefghijklmnopqrstuvwxyz@gmail.com" }))).toBe("ab*****@gmail.com");
  });

  it("never leaks more than two characters of the local part", async () => {
    const masked = (await must(anon().rpc("mask_email", { email: "rahasia.sekali@gmail.com" }))) as string;
    expect(masked).not.toContain("rahasia");
    expect(masked.split("@")[0].replace(/\*/g, "")).toHaveLength(2);
  });

  it("keeps multi-byte characters whole", async () => {
    expect(await must(anon().rpc("mask_email", { email: "ñúñez@gmail.com" }))).toBe("ñú*****@gmail.com");
  });

  it.each(["", "budi", "@gmail.com", "budi@"])("rejects %j", async (input) => {
    const { error } = await anon().rpc("mask_email", { email: input });
    expect(error?.hint).toBe("invalid-argument");
  });
});

describe("check constraints (database rejects bad data even without the RPC layer)", () => {
  let creator: Member;
  let appId: string;

  beforeAll(async () => {
    creator = await member("rina", "Rina Kusumawati");
    appId = await must(service.from("apps").insert(appRow(creator.id)).select("id").single()).then((r) => r.id);
  });

  function appRow(creatorId: string, over: Record<string, unknown> = {}) {
    const n = uniq();
    return {
      name: "Kas RT Digital",
      description: "Catat iuran warga.",
      opt_in_url: `https://play.google.com/apps/testing/id.rina.kasrt${n}`,
      package_name: `id.rina.kasrt${n}`,
      creator_id: creatorId,
      ...over,
    };
  }
  const testerRow = (over: Record<string, unknown> = {}) => ({
    app_id: appId,
    display_name: "Wulan Sari",
    masked_email: "wu*****@gmail.com",
    opted_in_at: new Date().toISOString(),
    added_by: "creator",
    ...over,
  });
  const buildRow = (over: Record<string, unknown> = {}) => ({
    app_id: appId,
    version_name: "1.0.0",
    uploaded_at: new Date().toISOString(),
    changelog: "Rilis awal",
    ...over,
  });
  const violates = async (table: string, row: Record<string, unknown>) => {
    const { error } = await service.from(table).insert(row);
    expect(error?.code).toBe("23514");
  };

  it("apps: lengths, URL prefixes, package format, status", async () => {
    await violates("apps", appRow(creator.id, { name: "x".repeat(51) }));
    await violates("apps", appRow(creator.id, { name: "   " }));
    await violates("apps", appRow(creator.id, { description: "x".repeat(281) }));
    await violates("apps", appRow(creator.id, { feedback_guide: "x".repeat(501) }));
    await violates("apps", appRow(creator.id, { opt_in_url: "https://play.google.com/store/apps/details?id=a.b" }));
    await violates("apps", appRow(creator.id, { opt_in_url: "https://play.google.com/apps/testing/" }));
    await violates("apps", appRow(creator.id, { store_url: "https://apkpure.com/kasrt" }));
    await violates("apps", appRow(creator.id, { package_name: "bukan paket" }));
    await violates("apps", appRow(creator.id, { status: "approved" }));
    await must(service.from("apps").insert(appRow(creator.id, { name: "x".repeat(50), package_name: null })));
  });

  it("apps: one live app per package name", async () => {
    const pkg = `id.rina.unik${uniq()}`;
    await must(service.from("apps").insert(appRow(creator.id, { package_name: pkg })));
    const { error } = await service.from("apps").insert(appRow(creator.id, { package_name: pkg }));
    expect(error?.code).toBe("23505");
  });

  it("testers: masked_email can never hold a full address", async () => {
    await violates("testers", testerRow({ masked_email: "wulan.sari@gmail.com" }));
    await violates("testers", testerRow({ masked_email: "wul*****@gmail.com" }));
    await violates("testers", testerRow({ masked_email: "wu****@gmail.com" }));
  });

  it("testers: note 140, summary 500, status and added_by sets", async () => {
    await violates("testers", testerRow({ note: "x".repeat(141) }));
    await violates("testers", testerRow({ feedback_summary: "x".repeat(501) }));
    await violates("testers", testerRow({ status: "banned" }));
    await violates("testers", testerRow({ added_by: "admin" }));
    await must(service.from("testers").insert(testerRow({ note: "x".repeat(140), feedback_summary: "x".repeat(500) })));
  });

  it("profiles: masked_email can never hold a full address", async () => {
    const { error } = await service.from("profiles").update({ masked_email: creator.email }).eq("id", creator.id);
    expect(error?.code).toBe("23514");
  });

  it("builds: versionName 40, changelog 140", async () => {
    await violates("builds", buildRow({ version_name: "v".repeat(41) }));
    await violates("builds", buildRow({ changelog: "c".repeat(141) }));
    await violates("builds", buildRow({ changelog: " " }));
    await must(service.from("builds").insert(buildRow({ version_name: "v".repeat(40), changelog: "c".repeat(140) })));
  });

  describe("cohorts and check-ins", () => {
    const now = () => new Date().toISOString();
    const cohort = async (over: Record<string, unknown> = {}) =>
      trackCohort((await must(service.from("cohorts").insert({ name: "Cohort uji", ...over }).select("id").single())).id);
    const code = async (p: PromiseLike<{ error: { code: string } | null }>) => (await p).error?.code;

    it("cohorts: name 50, status set, Day 0 only once started, closed_at only when closed", async () => {
      await violates("cohorts", { name: "x".repeat(51) });
      await violates("cohorts", { name: "  " });
      await violates("cohorts", { name: "Cohort", status: "paused" });
      await violates("cohorts", { name: "Cohort", status: "forming", day0_at: now() });
      await violates("cohorts", { name: "Cohort", status: "active" });
      await violates("cohorts", { name: "Cohort", status: "active", day0_at: now(), closed_at: now() });
      await violates("cohorts", { name: "Cohort", status: "closed", day0_at: now() });
      await cohort({ name: "x".repeat(50) });
      await cohort({ status: "active", day0_at: now() });
      await cohort({ status: "closed", day0_at: now(), closed_at: now() });
    });

    it("cohort_members: one row per member, one member per app, ring position only with an app, settled_at only when Settled", async () => {
      const id = await cohort();
      const other = await member("bayu", "Bayu Pratama");
      await must(service.from("cohort_members").insert({ cohort_id: id, user_id: creator.id, app_id: appId, ring_position: 0 }));
      expect(await code(service.from("cohort_members").insert({ cohort_id: id, user_id: creator.id }))).toBe("23505");
      expect(await code(service.from("cohort_members").insert({ cohort_id: id, user_id: other.id, app_id: appId }))).toBe("23505");
      await violates("cohort_members", { cohort_id: id, user_id: other.id, ring_position: 1 });
      await violates("cohort_members", { cohort_id: id, user_id: other.id, standing: "excellent" });
      await violates("cohort_members", { cohort_id: id, user_id: other.id, standing: "settled" });
      await violates("cohort_members", { cohort_id: id, user_id: other.id, standing: "owing", settled_at: now() });
      await must(service.from("cohort_members").insert({ cohort_id: id, user_id: other.id, standing: "settled", settled_at: now() }));
    });

    it("assignments: only for cohort members, once per member and app, reassigned_to only when reassigned", async () => {
      const id = await cohort({ status: "active", day0_at: now() });
      const other = await member("sari", "Sari Dewi");
      expect(await code(service.from("assignments").insert({ cohort_id: id, tester_user_id: other.id, app_id: appId }))).toBe("23503");
      await must(service.from("cohort_members").insert({ cohort_id: id, user_id: other.id }));
      const first = (await must(service.from("assignments").insert({ cohort_id: id, tester_user_id: other.id, app_id: appId }).select("id").single())).id;
      expect(await code(service.from("assignments").insert({ cohort_id: id, tester_user_id: other.id, app_id: appId }))).toBe("23505");
      await violates("assignments", { cohort_id: id, tester_user_id: other.id, app_id: appId, state: "moved" });
      expect(await code(service.from("assignments").update({ state: "reassigned" }).eq("id", first))).toBe("23514");
    });

    it("cohort_links: WhatsApp group URL only", async () => {
      const id = await cohort();
      await violates("cohort_links", { cohort_id: id, whatsapp_group_url: "https://wa.me/628123456789" });
      await violates("cohort_links", { cohort_id: id, whatsapp_group_url: "https://chat.whatsapp.com/" });
      await violates("cohort_links", { cohort_id: id, whatsapp_group_url: `https://chat.whatsapp.com/${"x".repeat(500)}` });
      await must(service.from("cohort_links").insert({ cohort_id: id, whatsapp_group_url: "https://chat.whatsapp.com/AbC123" }));
    });

    it("check_ins: build only for 'updated_build', each kind once per entry and once per build", async () => {
      const tester = (await must(service.from("testers").insert(testerRow()).select("id").single())).id;
      const build = (await must(service.from("builds").insert(buildRow()).select("id").single())).id;
      const build2 = (await must(service.from("builds").insert(buildRow({ version_name: "1.0.1" })).select("id").single())).id;
      await violates("check_ins", { tester_id: tester, kind: "opened" });
      await violates("check_ins", { tester_id: tester, kind: "updated_build" });
      await violates("check_ins", { tester_id: tester, kind: "used_app", build_id: build });
      await must(service.from("check_ins").insert({ tester_id: tester, kind: "used_app" }));
      expect(await code(service.from("check_ins").insert({ tester_id: tester, kind: "used_app" }))).toBe("23505");
      await must(service.from("check_ins").insert({ tester_id: tester, kind: "updated_build", build_id: build }));
      await must(service.from("check_ins").insert({ tester_id: tester, kind: "updated_build", build_id: build2 }));
      expect(await code(service.from("check_ins").insert({ tester_id: tester, kind: "updated_build", build_id: build }))).toBe("23505");
    });
  });
});

describe("app_stats", () => {
  let creator: Member;

  beforeAll(async () => {
    creator = await member("fajar", "Fajar Nugroho");
  });

  async function newApp(creatorId = creator.id, over: Record<string, unknown> = {}) {
    const n = uniq();
    const row = await must(
      service
        .from("apps")
        .insert({
          name: "Stat App",
          description: "Uji statistik.",
          opt_in_url: `https://play.google.com/apps/testing/id.stat.app${n}`,
          creator_id: creatorId,
          ...(over.deleted ? { deleted_at: new Date().toISOString() } : {}),
          ...over,
        })
        .select("id")
        .single(),
    );
    return row.id as string;
  }
  const entry = (appId: string, over: Record<string, unknown>) => ({
    app_id: appId,
    display_name: "Tester",
    masked_email: "te*****@gmail.com",
    opted_in_at: ago(3 * DAY_MS),
    added_by: "creator",
    ...over,
  });

  it("is all zero for an app without testers or builds", async () => {
    const appId = await newApp();
    expect(await stats(appId)).toMatchObject({
      active_tester_count: 0,
      eligible_count: 0,
      feedback_sent_count: 0,
      feedback_verified_count: 0,
      replied_count: 0,
      build_count: 0,
      last_build_at: null,
    });
  });

  it("counts only active testers; eligible at 14 days, not at 13 days 23 h", async () => {
    const appId = await newApp();
    await must(
      service.from("testers").insert([
        entry(appId, { opted_in_at: ago(14 * DAY_MS + 60_000), feedback_sent: true, feedback_verified: true, replied: true }),
        entry(appId, { opted_in_at: ago(14 * DAY_MS - 3_600_000), feedback_sent: true }),
        entry(appId, {}),
        entry(appId, { status: "left", opted_in_at: ago(30 * DAY_MS), left_at: ago(DAY_MS), feedback_sent: true, feedback_verified: true, replied: true }),
        entry(appId, { status: "removed", opted_in_at: ago(30 * DAY_MS), feedback_sent: true, feedback_verified: true, replied: true }),
      ], { defaultToNull: false }),
    );
    expect(await stats(appId)).toMatchObject({
      active_tester_count: 3,
      eligible_count: 1,
      feedback_sent_count: 2,
      feedback_verified_count: 1,
      replied_count: 1,
    });
  });

  it("counted_days is the slot-th most senior active tester's days, 0 while seats are open", async () => {
    const appId = await newApp(creator.id, { tester_slots: 2 });
    expect(await stats(appId)).toMatchObject({ counted_days: 0 });
    await must(
      service.from("testers").insert([
        entry(appId, { opted_in_at: ago(20 * DAY_MS) }),
        entry(appId, { status: "left", opted_in_at: ago(15 * DAY_MS), left_at: ago(DAY_MS) }),
      ], { defaultToNull: false }),
    );
    // One active tester for two slots: nothing counts yet, however long the first has been in.
    expect(await stats(appId)).toMatchObject({ counted_days: 0 });
    await must(
      service.from("testers").insert([
        entry(appId, { opted_in_at: ago(4 * DAY_MS + 60_000) }),
        entry(appId, { opted_in_at: ago(DAY_MS) }),
      ], { defaultToNull: false }),
    );
    // Seniority 20, 4, 1 days; the 2nd seat sets the clock. Left testers never count.
    expect(await stats(appId)).toMatchObject({ active_tester_count: 3, counted_days: 4 });
  });

  it("build_count and last_build_at use the max uploaded_at, not insertion order", async () => {
    const appId = await newApp();
    const now = Date.now();
    const at = (d: number) => new Date(now - d * DAY_MS).toISOString();
    await must(
      service.from("builds").insert(
        [at(2), at(9), at(5)].map((uploaded_at, i) => ({ app_id: appId, version_name: `1.0.${i}`, uploaded_at, changelog: "x" })),
      ),
    );
    const s = await stats(appId);
    expect(s.build_count).toBe(3);
    expect(new Date(s.last_build_at as string).toISOString()).toBe(at(2));
  });

  it("is hidden for soft-deleted apps (visitors), visible to admin", async () => {
    const appId = await newApp(creator.id, { deleted: true });
    const { data } = await anon().from("app_stats").select("app_id").eq("app_id", appId);
    expect(data).toEqual([]);
    const admin = await member("yusuf", "Yusuf Hidayat", "admin");
    const { data: seen } = await admin.db.from("app_stats").select("app_id").eq("app_id", appId);
    expect(seen).toHaveLength(1);
  });

  describe("profile_stats (reciprocity) and the creator numbers on app_stats", () => {
    let tester: Member;
    let ownAppId: string;

    beforeAll(async () => {
      tester = await member("bayu", "Bayu Pratama");
      const opted = Date.now() - 30 * DAY_MS;
      const iso = (ms: number) => new Date(ms).toISOString();
      const rows = [
        { status: "active", opted_in_at: ago(DAY_MS), feedback_sent: true, feedback_verified: true },
        { status: "left", opted_in_at: iso(opted), left_at: iso(opted + 14 * DAY_MS), feedback_sent: true },
        { status: "left", opted_in_at: iso(opted), left_at: iso(opted + 14 * DAY_MS - 1000), feedback_sent: true },
        { status: "left", opted_in_at: ago(40 * DAY_MS), left_at: null },
        { status: "removed", opted_in_at: ago(40 * DAY_MS), left_at: ago(DAY_MS), feedback_sent: true, feedback_verified: true },
      ];
      for (const r of rows) {
        const appId = await newApp();
        await must(service.from("testers").insert(entry(appId, { ...r, user_id: tester.id, added_by: "self" })));
      }
      const deletedApp = await newApp(creator.id, { deleted: true });
      await must(
        service
          .from("testers")
          .insert(entry(deletedApp, { user_id: tester.id, added_by: "self", feedback_sent: true, feedback_verified: true })),
      );
      ownAppId = await newApp(tester.id);
    });

    it("counts Active, and Left only after 14+ days; never Removed or deleted apps", async () => {
      expect(await profileStats(tester.id)).toMatchObject({
        testing_count: 2,
        feedback_sent_count: 3,
        feedback_verified_count: 1,
        apps_created_count: 1,
      });
    });

    it("apps_created_count excludes soft-deleted apps", async () => {
      const ps = await profileStats(creator.id);
      const { count } = await service.from("apps").select("id", { count: "exact", head: true }).eq("creator_id", creator.id).eq("deleted", false);
      expect(ps.apps_created_count).toBe(count);
    });

    it("app_stats carries the creator's reciprocity numbers", async () => {
      expect(await stats(ownAppId)).toMatchObject({
        creator_testing_count: 2,
        creator_feedback_sent_count: 3,
        creator_feedback_verified_count: 1,
      });
    });

    it("apps_tested_count counts only entries that reached 14 days (PRD FR-27g)", async () => {
      // Of the fixtures above only the Left-after-exactly-14-days entry qualifies:
      // Active 1 day, Left 1 s short of 14 days, Left without left_at, Removed and
      // the deleted app never count.
      expect(await profileStats(tester.id)).toMatchObject({ apps_tested_count: 1, badge_tier: "none", next_tier_at: 3 });
      expect(await stats(ownAppId)).toMatchObject({ creator_badge_tier: "none" });
    });
  });

  describe("badges (PRD FR-27g–l)", () => {
    let m: Member;
    const add = async (over: Record<string, unknown>) => {
      const appId = await newApp();
      await must(service.from("testers").insert(entry(appId, { user_id: m.id, added_by: "self", ...over })));
    };
    const tested = () => add({ status: "active", opted_in_at: ago(14 * DAY_MS + 60_000) });

    beforeAll(async () => {
      m = await member("rina", "Rina Wulandari");
    });

    it("Active at 13 days does not count; Active at 14 days does", async () => {
      await add({ status: "active", opted_in_at: ago(14 * DAY_MS - 60_000) });
      expect((await profileStats(m.id)).apps_tested_count).toBe(0);
      await tested();
      expect((await profileStats(m.id)).apps_tested_count).toBe(1);
    });

    it("Removed after 14 days never counts", async () => {
      await add({ status: "removed", opted_in_at: ago(30 * DAY_MS), left_at: ago(DAY_MS) });
      expect((await profileStats(m.id)).apps_tested_count).toBe(1);
    });

    it("tiers change exactly at 3, 7, 14 and 25 apps tested", async () => {
      const expectations: [number, string, number | null][] = [
        [2, "none", 3],
        [3, "bronze", 7],
        [6, "bronze", 7],
        [7, "silver", 14],
        [13, "silver", 14],
        [14, "gold", 25],
        [24, "gold", 25],
        [25, "platinum", null],
      ];
      let count = (await profileStats(m.id)).apps_tested_count;
      for (const [target, tier, next] of expectations) {
        while (count < target) {
          await tested();
          count++;
        }
        expect(await profileStats(m.id), `${target} apps tested`).toMatchObject({
          apps_tested_count: target,
          badge_tier: tier,
          next_tier_at: next,
        });
      }
    });

    it("app_stats shows the creator's badge", async () => {
      const own = await newApp(m.id);
      expect(await stats(own)).toMatchObject({ creator_badge_tier: "platinum" });
    });
  });
});
