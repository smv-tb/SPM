"""
Tests for smartvie_backup.py — run with:  python3 -m unittest discover -s deploy/backup -v

Retention and file safety are tested hardest: a bug there is how a backup
system quietly keeps nothing, or deletes something it should not.
"""
import datetime as dt
import json
import os
import tempfile
import unittest
from pathlib import Path

import smartvie_backup as sb

UTC = dt.timezone.utc


def t(y, mo, d, h=2, mi=30) -> dt.datetime:
    return dt.datetime(y, mo, d, h, mi, tzinfo=UTC)


def nightly(start: dt.datetime, nights: int, skip=()) -> list[dt.datetime]:
    return [start + dt.timedelta(days=i) for i in range(nights) if i not in skip]


GOOD_KEY = "age1nvc7qt99afmmyw82ulja8pdcgz95yktzlqdcxne8nx6ywpf2p3hsthx3gv"


class Naming(unittest.TestCase):
    def test_round_trip(self):
        when = t(2026, 10, 1, 17, 33)
        self.assertEqual(sb.parse_backup_time(sb.backup_name(when)), when)

    def test_only_our_own_names_are_recognised(self):
        for bad in [
            "smartvie_pm-20261001-173300.dump",          # not encrypted
            "smartvie_pm-20261001-173300.dump.age.bak",
            "other_app-20261001-173300.dump.age",
            "../smartvie_pm-20261001-173300.dump.age",    # path traversal
            "smartvie_pm-20261301-173300.dump.age",       # month 13
            "smartvie_pm-20261001-253300.dump.age",       # hour 25
            "smartvie_pm-20261001-173300.dump.age\n",
            "",
        ]:
            self.assertIsNone(sb.parse_backup_time(bad), bad)


class SelectKeep(unittest.TestCase):
    policy = sb.Policy()  # 7 daily, 4 weekly, 12 monthly, 7 yearly, FY ends October

    def test_empty_and_single(self):
        self.assertEqual(sb.select_keep([], self.policy), set())
        one = t(2026, 1, 1)
        self.assertEqual(sb.select_keep([one], self.policy), {one})

    def test_the_newest_backup_is_always_kept_even_with_everything_set_to_zero(self):
        times = nightly(t(2026, 1, 1), 30)
        keep = sb.select_keep(times, sb.Policy(daily=0, weekly=0, monthly=0, yearly=0))
        self.assertEqual(keep, {max(times)})

    def test_keeps_the_last_seven_days(self):
        times = nightly(t(2026, 3, 1), 20)
        keep = sb.select_keep(times, sb.Policy(daily=7, weekly=0, monthly=0, yearly=0))
        self.assertEqual(sorted(keep), sorted(times[-7:]))

    def test_daily_means_seven_days_that_have_a_backup_not_seven_calendar_days(self):
        # Missed nights must not shrink the window: keep the newest seven days that exist.
        times = nightly(t(2026, 3, 1), 20, skip={15, 16, 17})
        keep = sb.select_keep(times, sb.Policy(daily=7, weekly=0, monthly=0, yearly=0))
        self.assertEqual(len({k.date() for k in keep}), 7)
        self.assertIn(max(times), keep)

    def test_two_backups_in_a_day_keep_only_the_later(self):
        early, late = t(2026, 5, 5, 1, 0), t(2026, 5, 5, 23, 0)
        keep = sb.select_keep([early, late], sb.Policy(daily=7, weekly=0, monthly=0, yearly=0))
        self.assertEqual(keep, {late})

    def test_a_year_of_nightly_backups_is_thinned_to_a_bounded_set(self):
        times = nightly(t(2025, 1, 1), 365 * 2)
        keep = sb.select_keep(times, self.policy)
        self.assertLessEqual(len(keep), 7 + 4 + 12 + 7)
        self.assertGreaterEqual(len(keep), 20)
        self.assertIn(max(times), keep)

    def test_weekly_and_monthly_survive_beyond_the_daily_window(self):
        times = nightly(t(2026, 1, 1), 200)
        keep = sb.select_keep(times, self.policy)
        oldest_daily = sorted(times)[-7]
        older = [k for k in keep if k < oldest_daily]
        self.assertGreater(len(older), 4, "weekly + monthly copies should reach back past the daily window")
        # the latest backup of January is the month's survivor
        jan = [x for x in times if (x.year, x.month) == (2026, 1)]
        self.assertTrue(max(jan) in keep or any((k.year, k.month) == (2026, 1) for k in keep))

    def test_financial_year_end_copy_is_kept_for_seven_years(self):
        # Nightly from 1 Nov 2018 to 31 Oct 2026 (the end of FY2026), so the newest seven financial
        # years are FY2020-FY2026 and the last backup of each must survive.
        times = nightly(t(2018, 11, 1), (dt.date(2026, 10, 31) - dt.date(2018, 11, 1)).days + 1)
        keep = sb.select_keep(times, self.policy)
        for fy in range(2020, 2027):
            in_fy = [x for x in times if sb._financial_year(x, 10) == fy]
            self.assertIn(max(in_fy), keep, f"FY{fy} year-end copy was thrown away")
        self.assertEqual(max(x for x in times if sb._financial_year(x, 10) == 2026), t(2026, 10, 31))
        # ... and the oldest FY is dropped once there are more than `yearly` of them
        self.assertEqual(max(times), t(2026, 10, 31))
        in_fy_2019 = [x for x in times if sb._financial_year(x, 10) == 2019]
        self.assertNotIn(max(in_fy_2019), keep)

    def test_year_end_month_is_configurable(self):
        self.assertEqual(sb._financial_year(t(2026, 10, 31), 10), 2026)
        self.assertEqual(sb._financial_year(t(2026, 11, 1), 10), 2027)
        self.assertEqual(sb._financial_year(t(2026, 12, 31), 12), 2026)
        self.assertEqual(sb._financial_year(t(2026, 1, 1), 3), 2026)
        self.assertEqual(sb._financial_year(t(2026, 4, 1), 3), 2027)

    def test_duplicates_are_harmless(self):
        times = nightly(t(2026, 1, 1), 10)
        self.assertEqual(sb.select_keep(times + times, self.policy), sb.select_keep(times, self.policy))

    def test_input_order_does_not_matter(self):
        times = nightly(t(2026, 1, 1), 90)
        shuffled = times[::-1][::2] + times[::2]
        self.assertEqual(sb.select_keep(shuffled, self.policy), sb.select_keep(times, self.policy))


class PlanPrune(unittest.TestCase):
    def test_files_that_are_not_backups_are_never_planned_for_deletion(self):
        names = ["notes.txt", "smartvie_pm-20260101-020000.dump", "../etc/passwd", ".lock", "last_run.json",
                 "smartvie_pm-20260101-020000.dump.age.manifest.json"]
        keep, delete = sb.plan_prune(names, sb.Policy())
        self.assertEqual((keep, delete), ([], []))

    def test_old_backups_are_deleted_and_newest_kept(self):
        names = [sb.backup_name(x) for x in nightly(t(2026, 1, 1), 400)]
        keep, delete = sb.plan_prune(names, sb.Policy())
        self.assertIn(names[-1], keep)
        self.assertTrue(set(keep).isdisjoint(delete))
        self.assertEqual(set(keep) | set(delete), set(names))
        self.assertGreater(len(delete), 300)


class DatabaseEnv(unittest.TestCase):
    def test_password_goes_in_the_environment_not_an_argument(self):
        env = sb.database_env("postgresql://app:p%40ss%2Fword@db.internal:5433/smartvie_pm?schema=public", base={})
        self.assertEqual(env["PGPASSWORD"], "p@ss/word")
        self.assertEqual((env["PGHOST"], env["PGPORT"], env["PGUSER"], env["PGDATABASE"]), ("db.internal", "5433", "app", "smartvie_pm"))

    def test_prisma_schema_parameter_is_ignored_and_sslmode_kept(self):
        env = sb.database_env("postgresql://u:p@h/db?schema=public&sslmode=require", base={})
        self.assertEqual(env["PGSSLMODE"], "require")
        self.assertNotIn("schema", " ".join(env))

    def test_defaults(self):
        env = sb.database_env("postgres://u@h/db", base={})
        self.assertEqual(env["PGPORT"], "5432")
        self.assertNotIn("PGPASSWORD", env)

    def test_other_schemes_are_refused(self):
        with self.assertRaises(sb.ConfigError):
            sb.database_env("mysql://u:p@h/db", base={})


class ConfigLoading(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.env = self.tmp / ".env"
        self.conf = self.tmp / "backup.conf"
        self.env.write_text('# app settings\nexport DATABASE_URL="postgresql://u:p@h:5432/d?schema=public"\nAUTH_SECRET=x\n')

    def load(self, **extra):
        return sb.Config.load(self.env, self.conf, environ=extra)

    def test_reads_the_app_env_and_the_backup_config(self):
        self.conf.write_text(f"BACKUP_AGE_RECIPIENT={GOOD_KEY}\nBACKUP_DIR=/tmp/x\nBACKUP_KEEP_DAILY=3\n")
        cfg = self.load()
        self.assertEqual(cfg.backup_dir, Path("/tmp/x"))
        self.assertEqual(cfg.policy.daily, 3)
        self.assertTrue(cfg.database_url.startswith("postgresql://"))

    def test_a_private_key_is_refused_as_the_recipient(self):
        # The most dangerous mistake: putting the SECRET key on the server.
        self.conf.write_text("BACKUP_AGE_RECIPIENT=AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ\n")
        with self.assertRaises(sb.ConfigError):
            self.load()

    def test_a_recipient_with_trailing_junk_is_refused(self):
        self.assertIsNone(sb.AGE_RECIPIENT.match(GOOD_KEY + "\n"))
        self.assertIsNone(sb.AGE_RECIPIENT.match(GOOD_KEY + "x"))
        self.assertTrue(sb.AGE_RECIPIENT.match(GOOD_KEY))

    def test_garbage_recipient_missing_recipient_and_missing_database_are_refused(self):
        self.conf.write_text("BACKUP_AGE_RECIPIENT=hello\n")
        with self.assertRaises(sb.ConfigError):
            self.load()
        self.conf.write_text("")
        with self.assertRaises(sb.ConfigError):
            self.load()
        self.env.write_text("AUTH_SECRET=x\n")
        self.conf.write_text(f"BACKUP_AGE_RECIPIENT={GOOD_KEY}\n")
        with self.assertRaises(sb.ConfigError):
            self.load()

    def test_environment_overrides_files(self):
        self.conf.write_text(f"BACKUP_AGE_RECIPIENT={GOOD_KEY}\nBACKUP_DIR=/from/file\n")
        self.assertEqual(self.load(BACKUP_DIR="/from/env").backup_dir, Path("/from/env"))

    def test_bad_year_end_month_is_refused(self):
        self.conf.write_text(f"BACKUP_AGE_RECIPIENT={GOOD_KEY}\nBACKUP_YEAR_END_MONTH=13\n")
        with self.assertRaises(sb.ConfigError):
            self.load()

    def test_inline_comments_are_not_part_of_the_value(self):
        p = self.tmp / "inline"
        p.write_text('A=200     # megabytes\nB="keep # this"\nC=https://x.example/p#frag\nD=5\t# tab\n')
        self.assertEqual(sb.read_kv_file(p), {"A": "200", "B": "keep # this", "C": "https://x.example/p#frag", "D": "5"})

    def test_the_installers_own_config_template_loads_and_validates(self):
        # install.sh writes this file on every fresh install; if the parser can't read it, no backup ever runs.
        import re, subprocess
        script = (Path(__file__).parent / "install.sh").read_text()
        template = re.search(r'cat > "\$DIR/backup.conf" <<CONF\n(.*?)\nCONF', script, re.S).group(1)
        filled = (template.replace("$RECIPIENT", GOOD_KEY).replace("$DIR", "/tmp/x")
                  .replace("$KEEP_DAILY", "2").replace("$KEEP_WEEKLY", "0"))
        self.conf.write_text(filled)
        cfg = self.load()
        self.assertEqual((cfg.policy.daily, cfg.policy.weekly, cfg.policy.monthly, cfg.policy.yearly), (2, 0, 12, 7))
        self.assertEqual(cfg.max_total_bytes, 200 * 1024 * 1024)
        self.assertEqual(cfg.min_free_bytes, 1024 * 1024 * 1024)

    def test_kv_parser_handles_quotes_comments_and_blank_lines(self):
        p = self.tmp / "x"
        p.write_text("# c\n\nA=1\nB='two words'\nexport C=\"3\"\nnoequals\n")
        self.assertEqual(sb.read_kv_file(p), {"A": "1", "B": "two words", "C": "3"})
        self.assertEqual(sb.read_kv_file(self.tmp / "missing"), {})


class PruneAndCheckOnDisk(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.cfg = sb.Config(
            database_url="postgresql://u:p@h/d", backup_dir=self.dir, recipient=GOOD_KEY,
            webhook_url=None, policy=sb.Policy(daily=2, weekly=0, monthly=0, yearly=0),
        )

    def make(self, when: dt.datetime, content=b"encrypted", manifest=True) -> str:
        name = sb.backup_name(when)
        (self.dir / name).write_bytes(content)
        if manifest:
            (self.dir / (name + sb.MANIFEST_SUFFIX)).write_text(
                json.dumps({"sha256": sb.sha256_file(self.dir / name)}))
        return name

    def test_dry_run_deletes_nothing(self):
        names = [self.make(t(2026, 3, d)) for d in range(1, 6)]
        sb.do_prune(self.cfg, dry_run=True)
        self.assertEqual(sorted(sb.list_backups(self.dir)), sorted(names))

    def test_prune_removes_old_backups_with_their_manifests_and_nothing_else(self):
        names = [self.make(t(2026, 3, d)) for d in range(1, 6)]
        (self.dir / "notes.txt").write_text("mine")
        (self.dir / "last_run.json").write_text("{}")
        (self.dir / "smartvie_pm-20260301-023000.dump").write_text("plain, not ours")  # no .age
        sb.do_prune(self.cfg, dry_run=False)
        self.assertEqual(sb.list_backups(self.dir), names[-2:])
        left = {p.name for p in self.dir.iterdir()}
        for gone in names[:3]:
            self.assertNotIn(gone, left)
            self.assertNotIn(gone + sb.MANIFEST_SUFFIX, left)
        for kept in names[-2:]:
            self.assertIn(kept + sb.MANIFEST_SUFFIX, left)
        self.assertTrue({"notes.txt", "last_run.json", "smartvie_pm-20260301-023000.dump"} <= left)

    def test_check_passes_for_a_fresh_intact_backup(self):
        now = t(2026, 3, 10, 9, 0)
        self.make(t(2026, 3, 10, 2, 30))
        sb.do_check(self.cfg, 26, now=now)

    def test_check_fails_when_the_newest_backup_is_too_old(self):
        self.make(t(2026, 3, 8, 2, 30))
        with self.assertRaisesRegex(sb.BackupError, "old"):
            sb.do_check(self.cfg, 26, now=t(2026, 3, 10, 9, 0))

    def test_check_fails_with_no_backups_no_manifest_or_a_damaged_file(self):
        with self.assertRaisesRegex(sb.BackupError, "no backups"):
            sb.do_check(self.cfg, 26, now=t(2026, 3, 10))
        name = self.make(t(2026, 3, 10, 2, 30), manifest=False)
        with self.assertRaisesRegex(sb.BackupError, "manifest"):
            sb.do_check(self.cfg, 26, now=t(2026, 3, 10, 9))
        (self.dir / (name + sb.MANIFEST_SUFFIX)).write_text(json.dumps({"sha256": "0" * 64}))
        with self.assertRaisesRegex(sb.BackupError, "does not match"):
            sb.do_check(self.cfg, 26, now=t(2026, 3, 10, 9))


class AuditChain(unittest.TestCase):
    OK = {"rows": 10, "headSeq": 10, "headHash": "h10", "brokenAt": None}

    def test_a_sound_first_run_passes(self):
        self.assertIsNone(sb.judge_audit_chain(self.OK, None, None))

    def test_a_broken_link_is_reported_with_its_position(self):
        msg = sb.judge_audit_chain({**self.OK, "brokenAt": 7}, None, None)
        self.assertIn("entry 7", msg)

    def test_growth_since_the_recorded_head_passes(self):
        prev = {"headSeq": 8, "headHash": "h8"}
        self.assertIsNone(sb.judge_audit_chain(self.OK, prev, "h8"))

    def test_a_shorter_log_is_reported(self):
        prev = {"headSeq": 12, "headHash": "h12"}
        self.assertIn("shorter", sb.judge_audit_chain(self.OK, prev, None))

    def test_a_rewritten_history_is_reported_even_if_the_chain_is_self_consistent(self):
        prev = {"headSeq": 8, "headHash": "h8"}
        self.assertIn("rewritten", sb.judge_audit_chain(self.OK, prev, "other"))


class ToolSelection(unittest.TestCase):
    """The Debian wrapper picked a different PostgreSQL version for dump and verify; never again."""

    def probe_from(self, table: dict):
        return lambda d: table.get(d)

    def test_an_exact_match_wins_over_a_newer_one(self):
        probe = self.probe_from({"/usr/lib/postgresql/15/bin": 15, "": 17})
        self.assertEqual(sb.pick_tool_dir(15, probe), "/usr/lib/postgresql/15/bin")

    def test_a_tie_goes_to_the_explicit_directory_not_the_bare_path_name(self):
        # The real-world case: Debian's /usr/lib/postgresql/15/bin and the bare `pg_dump` wrapper both
        # report 15. The bare name must lose, because the wrapper picks versions from the environment.
        probe = self.probe_from({"/usr/lib/postgresql/15/bin": 15, "": 15})
        self.assertEqual(sb.pick_tool_dir(15, probe), "/usr/lib/postgresql/15/bin")
        probe = self.probe_from({"": 15, "/opt/homebrew/opt/postgresql@15/bin": 15})
        self.assertEqual(sb.pick_tool_dir(15, probe), "/opt/homebrew/opt/postgresql@15/bin")

    def test_falls_back_to_the_oldest_newer_version(self):
        probe = self.probe_from({"": 17, "/usr/pgsql-15/bin": None})
        self.assertEqual(sb.pick_tool_dir(15, probe), "")
        probe = self.probe_from({"/opt/homebrew/opt/postgresql@15/bin": 17, "": 18})
        self.assertEqual(sb.pick_tool_dir(15, probe), "/opt/homebrew/opt/postgresql@15/bin")

    def test_never_an_older_version_than_the_server(self):
        self.assertIsNone(sb.pick_tool_dir(15, self.probe_from({"": 14})))
        self.assertIsNone(sb.pick_tool_dir(15, self.probe_from({})))

    def test_candidate_directories_cover_debian_and_homebrew(self):
        dirs = sb.tool_dir_candidates(15)
        self.assertIn("/usr/lib/postgresql/15/bin", dirs)
        self.assertTrue(any("postgresql@15" in d for d in dirs))

    def test_tool_builds_an_explicit_path_or_falls_back_to_the_bare_name(self):
        self.assertEqual(sb.tool("/usr/lib/postgresql/15/bin", "pg_dump"), "/usr/lib/postgresql/15/bin/pg_dump")
        self.assertEqual(sb.tool("", "pg_dump"), "pg_dump")


class SpaceLimits(unittest.TestCase):
    MB = 1024 * 1024

    def entries(self, n, size_mb=1, start=t(2026, 1, 1)):
        return {sb.backup_name(start + dt.timedelta(days=30 * i)): size_mb * self.MB for i in range(n)}

    def test_nothing_is_deleted_while_under_budget(self):
        delete, over = sb.enforce_budget(self.entries(10), sb.Policy(), budget_bytes=100 * self.MB)
        self.assertEqual((delete, over), ([], False))

    def test_oldest_go_first_until_it_fits(self):
        e = self.entries(10, size_mb=10)               # 100 MB
        delete, over = sb.enforce_budget(e, sb.Policy(yearly=0), budget_bytes=55 * self.MB)
        names = sorted(e)
        self.assertEqual(delete, names[:5])            # five oldest -> 50 MB left
        self.assertFalse(over)

    def test_the_newest_two_are_never_deleted(self):
        e = self.entries(6, size_mb=10)
        delete, over = sb.enforce_budget(e, sb.Policy(yearly=0), budget_bytes=1)
        names = sorted(e)
        self.assertEqual(delete, names[:4])
        self.assertNotIn(names[-1], delete)
        self.assertNotIn(names[-2], delete)
        self.assertTrue(over, "still over budget, and it says so rather than delete the newest")

    def test_year_end_copies_are_protected_so_the_long_term_record_survives_a_squeeze(self):
        # Oct-31 backups for several years plus noise; a tiny budget must not take the year-end copies.
        year_ends = [t(y, 10, 31) for y in range(2021, 2027)]
        noise = [t(2026, 11, 1) + dt.timedelta(days=i) for i in range(5)]
        e = {sb.backup_name(x): self.MB for x in year_ends + noise}
        delete, over = sb.enforce_budget(e, sb.Policy(yearly=7, year_end_month=10), budget_bytes=3 * self.MB)
        for x in year_ends:
            self.assertNotIn(sb.backup_name(x), delete, f"year-end copy {x:%Y-%m-%d} was deleted")
        self.assertTrue(over)

    def test_unrecognised_names_are_ignored(self):
        e = {"notes.txt": 500 * self.MB, **self.entries(3)}
        delete, _ = sb.enforce_budget(e, sb.Policy(), budget_bytes=2 * self.MB)
        self.assertNotIn("notes.txt", delete)

    def test_space_check_needs_room_for_both_copies_plus_the_reserve(self):
        gb = 1024 * self.MB
        self.assertTrue(sb.space_ok(free_bytes=10 * gb, dump_bytes=5 * self.MB, min_free_bytes=gb))
        self.assertFalse(sb.space_ok(free_bytes=gb + self.MB, dump_bytes=5 * self.MB, min_free_bytes=gb))
        self.assertFalse(sb.space_ok(free_bytes=gb, dump_bytes=0, min_free_bytes=gb + 1))
        self.assertTrue(sb.space_ok(free_bytes=gb, dump_bytes=0, min_free_bytes=gb))

    def test_limits_come_from_the_config_in_megabytes_and_have_safe_defaults(self):
        tmp = Path(tempfile.mkdtemp())
        env = tmp / ".env"; env.write_text("DATABASE_URL=postgresql://u:p@h/d\n")
        conf = tmp / "c"; conf.write_text(f"BACKUP_AGE_RECIPIENT={GOOD_KEY}\n")
        cfg = sb.Config.load(env, conf, environ={})
        self.assertEqual((cfg.max_total_bytes, cfg.max_dump_bytes, cfg.min_free_bytes),
                         (200 * self.MB, 1024 * self.MB, 1024 * self.MB))
        conf.write_text(f"BACKUP_AGE_RECIPIENT={GOOD_KEY}\nBACKUP_MAX_TOTAL_MB=50\nBACKUP_MIN_FREE_MB=2048\n")
        cfg = sb.Config.load(env, conf, environ={})
        self.assertEqual((cfg.max_total_bytes, cfg.min_free_bytes), (50 * self.MB, 2048 * self.MB))

    def test_a_dedicated_backup_database_url_wins_over_the_apps(self):
        tmp = Path(tempfile.mkdtemp())
        env = tmp / ".env"; env.write_text("DATABASE_URL=postgresql://app:p@h/d\n")
        conf = tmp / "c"; conf.write_text(f"BACKUP_AGE_RECIPIENT={GOOD_KEY}\n")
        self.assertEqual(sb.Config.load(env, conf, environ={}).database_url, "postgresql://app:p@h/d")
        conf.write_text(f"BACKUP_AGE_RECIPIENT={GOOD_KEY}\nBACKUP_DATABASE_URL=postgresql://backup:p@h/d\n")
        self.assertEqual(sb.Config.load(env, conf, environ={}).database_url, "postgresql://backup:p@h/d")
        # ...and it alone is enough: the app's URL need not be present.
        env.write_text("AUTH_SECRET=x\n")
        self.assertEqual(sb.Config.load(env, conf, environ={}).database_url, "postgresql://backup:p@h/d")

    def test_only_table_definitions_are_counted_in_a_dump(self):
        toc = [
            "; Archive created at 2026-10-06",
            "203; 1259 16431 TABLE public users smartvie_pm",
            "204; 1259 16440 TABLE public audit_logs smartvie_pm",
            "3400; 0 16431 TABLE DATA public users smartvie_pm",
            "3512; 0 0 ACL public TABLE users smartvie_pm",
            "3513; 0 0 ACL public TABLE audit_logs smartvie_pm",
            "3514; 0 0 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES smartvie_pm",
            "210; 1259 16500 SEQUENCE public some_seq smartvie_pm",
        ]
        self.assertEqual(sb.count_tables(toc), 2)

    def test_nonsense_limits_are_refused(self):
        tmp = Path(tempfile.mkdtemp())
        env = tmp / ".env"; env.write_text("DATABASE_URL=postgresql://u:p@h/d\n")
        conf = tmp / "c"
        for bad in ("0", "-5", "lots", ""):
            conf.write_text(f"BACKUP_AGE_RECIPIENT={GOOD_KEY}\nBACKUP_MAX_TOTAL_MB={bad}\n")
            with self.assertRaises(sb.ConfigError, msg=bad):
                sb.Config.load(env, conf, environ={})


class PruneAppliesBudget(unittest.TestCase):
    MB = 1024 * 1024

    def test_prune_enforces_the_budget_on_disk_and_reports_the_space_used(self):
        d = Path(tempfile.mkdtemp())
        cfg = sb.Config("postgresql://u:p@h/d", d, GOOD_KEY, None, sb.Policy(daily=99, weekly=99, monthly=99, yearly=0),
                        max_total_bytes=5 * self.MB)
        names = []
        for i in range(8):
            n = sb.backup_name(t(2026, 1 + i, 1))
            (d / n).write_bytes(b"x" * self.MB)
            (d / (n + sb.MANIFEST_SUFFIX)).write_text("{}")
            names.append(n)
        keep, delete = sb.do_prune(cfg, dry_run=False)
        left = sb.list_backups(d)
        self.assertLessEqual(sum((d / n).stat().st_size for n in left), 5 * self.MB)
        self.assertEqual(left, names[-len(left):], "the newest survive, the oldest are dropped")
        self.assertIn(names[-1], left)
        self.assertTrue(all(not (d / (n + sb.MANIFEST_SUFFIX)).exists() for n in set(names) - set(left)))


class Locking(unittest.TestCase):
    def test_a_second_run_cannot_overlap_the_first(self):
        d = Path(tempfile.mkdtemp())
        with sb.exclusive_lock(d):
            with self.assertRaisesRegex(sb.BackupError, "already running"):
                with sb.exclusive_lock(d):
                    pass
        with sb.exclusive_lock(d):  # released afterwards
            pass


if __name__ == "__main__":
    unittest.main()
