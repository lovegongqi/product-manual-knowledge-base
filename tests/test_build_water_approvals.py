import unittest

from scripts.build_water_approvals import (
    allocate_report_filenames,
    classify_report,
    merge_report_records,
    report_filename,
)


class ReportClassificationTests(unittest.TestCase):
    def test_classifies_only_supported_report_documents(self):
        fixtures = [
            ({"type": "文档", "title": "ERO208-3 水批报告", "keyword": ""}, "水批报告"),
            ({"type": "文档", "title": "ERH-X10&ERH-X20 CCC证书", "keyword": "产品认证证书"}, "认证证书"),
            ({"type": "文档", "title": "ERO630-3L 水效报告", "keyword": "ERO630-3L"}, "水效报告"),
            ({"type": "文档", "title": "X10 检测报告", "keyword": "Ultra 全能系列 X10"}, "检测报告"),
            ({"type": "文档", "title": "ERO162 检验报告", "keyword": "产品认证/检验报告"}, "检测报告"),
            ({"type": "文档", "title": "水效标识怎么看？", "keyword": "产品知识问答"}, None),
            ({"type": "图文", "title": "认证证书", "keyword": "产品认证证书"}, None),
        ]

        for record, expected in fixtures:
            with self.subTest(title=record["title"]):
                self.assertEqual(classify_report(record), expected)

    def test_merges_search_results_without_duplicate_content_ids(self):
        first = [
            {"id": 10, "type": "文档", "title": "A 水批报告"},
            {"id": 20, "type": "文档", "title": "B 水效报告"},
        ]
        second = [
            {"id": 20, "type": "文档", "title": "B 水效报告"},
            {"id": 30, "type": "文档", "title": "C 检测报告"},
        ]

        merged = merge_report_records(first, second)

        self.assertEqual([record["id"] for record in merged], [10, 20, 30])
        self.assertEqual(
            [record["category"] for record in merged],
            ["水批报告", "水效报告", "检测报告"],
        )

    def test_filename_uses_the_real_report_type_and_disambiguates_collisions(self):
        report = {
            "id": 42,
            "type": "文档",
            "title": "ERO630-3L 水效报告",
            "category": "水效报告",
        }

        self.assertEqual(report_filename(report, set()), "ERO630-3L 水效报告.pdf")
        self.assertEqual(
            report_filename(report, {"ERO630-3L 水效报告.pdf"}),
            "ERO630-3L 水效报告-42.pdf",
        )

    def test_water_approval_filename_remains_compatible_with_existing_links(self):
        report = {
            "id": 77,
            "type": "文档",
            "title": "X10 水批",
            "category": "水批报告",
        }

        self.assertEqual(report_filename(report, set()), "X10 水批报告.pdf")

    def test_filename_allocation_avoids_three_way_collisions(self):
        reports = [
            {"id": 1, "type": "文档", "title": "A 检测报告", "category": "检测报告"},
            {"id": 2, "type": "文档", "title": "A 检测报告", "category": "检测报告"},
            {"id": 3, "type": "文档", "title": "A 检测报告-1", "category": "检测报告"},
        ]

        filenames = allocate_report_filenames(reports)

        self.assertEqual(len(filenames), len(set(filenames)))
        self.assertEqual(filenames[2], "A 检测报告-1.pdf")


if __name__ == "__main__":
    unittest.main()
