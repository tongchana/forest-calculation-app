from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from deploy_ops import (
    TOKENS_FILE,
    github_create_pr,
    github_merge_pr,
    load_env_file,
    render_list_deploys,
    render_service,
    render_trigger_deploy,
    require_keys,
    vercel_list_deployments,
)


ROOT_DIR = Path(__file__).resolve().parents[1]


def git_output(*args: str) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=ROOT_DIR,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def current_branch() -> str:
    return git_output("branch", "--show-current")


def latest_commit_subject() -> str:
    return git_output("log", "-1", "--pretty=%s")


def latest_commit_body() -> str:
    return git_output("log", "-1", "--pretty=%b")


def build_default_body(head: str) -> str:
    latest_subject = latest_commit_subject()
    latest_body = latest_commit_body()
    parts = [
        f"Automated release from `{head}`.",
        "",
        f"Latest commit: {latest_subject}",
    ]
    if latest_body:
        parts.extend(["", latest_body])
    return "\n".join(parts)


def summarize_vercel(data: dict[str, Any]) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for item in data.get("deployments", []):
        summaries.append(
            {
                "url": item.get("url"),
                "target": item.get("target"),
                "state": item.get("state"),
                "readyState": item.get("readyState"),
                "commitRef": item.get("meta", {}).get("githubCommitRef"),
                "commitSha": item.get("meta", {}).get("githubCommitSha"),
                "commitMessage": item.get("meta", {}).get("githubCommitMessage"),
            }
        )
    return summaries


def summarize_render(data: list[dict[str, Any]]) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for item in data:
        deploy = item.get("deploy", {})
        commit = deploy.get("commit", {})
        summaries.append(
            {
                "id": deploy.get("id"),
                "status": deploy.get("status"),
                "trigger": deploy.get("trigger"),
                "commitId": commit.get("id"),
                "commitMessage": commit.get("message"),
                "createdAt": deploy.get("createdAt"),
                "finishedAt": deploy.get("finishedAt"),
            }
        )
    return summaries


def main() -> int:
    parser = argparse.ArgumentParser(description="Create PR, merge, and trigger deploys in one flow.")
    parser.add_argument("--head", default=None, help="Branch to release. Defaults to current branch.")
    parser.add_argument("--base", default="main", help="Base branch for the PR.")
    parser.add_argument("--title", default=None, help="PR title. Defaults to latest commit subject.")
    parser.add_argument("--body", default=None, help="PR body. Defaults to an auto summary.")
    parser.add_argument("--pr-number", type=int, default=None, help="Use an existing PR number instead of creating a new PR.")
    parser.add_argument("--commit-title", default=None, help="Custom merge commit title.")
    parser.add_argument("--skip-merge", action="store_true", help="Create or reuse the PR but do not merge it.")
    parser.add_argument("--skip-render-deploy", action="store_true", help="Do not trigger a Render deploy after merge.")
    parser.add_argument("--skip-status", action="store_true", help="Do not fetch Render/Vercel status at the end.")
    parser.add_argument("--status-wait-seconds", type=int, default=8, help="Wait time before checking deploy status.")
    args = parser.parse_args()

    try:
        values = load_env_file(TOKENS_FILE)
        require_keys(
            values,
            [
                "GITHUB_TOKEN",
                "GITHUB_REPO",
                "VERCEL_TOKEN",
                "VERCEL_PROJECT_NAME",
                "RENDER_API_KEY",
                "RENDER_SERVICE_ID",
            ],
        )

        head = args.head or current_branch()
        title = args.title or latest_commit_subject()
        body = args.body or build_default_body(head)

        summary: dict[str, Any] = {
            "head": head,
            "base": args.base,
        }

        pr_number = args.pr_number
        if pr_number is None:
            created_pr = github_create_pr(values, args.base, head, title, body)
            pr_number = created_pr["number"]
            summary["pullRequest"] = {
                "number": created_pr["number"],
                "url": created_pr["html_url"],
                "created": True,
            }
        else:
            summary["pullRequest"] = {
                "number": pr_number,
                "created": False,
            }

        if not args.skip_merge:
            merge_result = github_merge_pr(values, pr_number, args.commit_title)
            summary["merge"] = merge_result

            if not args.skip_render_deploy:
                deploy_result = render_trigger_deploy(values)
                summary["renderDeploy"] = {
                    "id": deploy_result.get("id"),
                    "status": deploy_result.get("status"),
                    "commitId": deploy_result.get("commit", {}).get("id"),
                }

        if not args.skip_status:
            if args.status_wait_seconds > 0:
                time.sleep(args.status_wait_seconds)

            render_info = render_service(values)
            render_deploys = render_list_deploys(values, limit=3)
            vercel_deploys = vercel_list_deployments(values, limit=3)

            summary["renderService"] = {
                "id": render_info.get("id"),
                "name": render_info.get("name"),
                "url": render_info.get("serviceDetails", {}).get("url"),
                "branch": render_info.get("branch"),
            }
            summary["renderDeploys"] = summarize_render(render_deploys)
            summary["vercelDeployments"] = summarize_vercel(vercel_deploys)

        print(json.dumps(summary, ensure_ascii=False, indent=2))
    except subprocess.CalledProcessError as exc:
        print(exc.stderr or str(exc), file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
