from __future__ import annotations

import argparse
from pathlib import Path

from cal_EIA.profile_diagram_lib import render_workbook_profiles


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read an Excel tree profile file and render top/profile diagrams."
    )
    parser.add_argument(
        "excel_path",
        nargs="?",
        default="profile.xlsx",
        help="Path to the Excel file. Defaults to profile.xlsx in the current directory.",
    )
    parser.add_argument(
        "--output-dir",
        default="outputs/profile_diagrams",
        help="Directory where PNG files will be saved.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    excel_path = Path(args.excel_path).resolve()
    output_dir = Path(args.output_dir).resolve()
    for output_path in render_workbook_profiles(excel_path, output_dir):
        print(f"Created: {output_path}")


if __name__ == "__main__":
    main()
