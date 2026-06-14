from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
TOKENS_FILE = ROOT_DIR / ".env.tokens"


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        raise FileNotFoundError(f"Missing secrets file: {path}")

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def require_keys(values: dict[str, str], keys: list[str]) -> None:
    missing = [key for key in keys if not values.get(key)]
    if missing:
        raise RuntimeError(f"Missing required keys in {TOKENS_FILE.name}: {', '.join(missing)}")


def request_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
) -> Any:
    body = None
    request_headers = {
        "Accept": "application/json",
        "User-Agent": "cal-biomass-ops",
    }
    if headers:
        request_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        request_headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url, data=body, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            content = response.read().decode("utf-8")
            if not content:
                return {}
            return json.loads(content)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed: {exc.code} {detail}") from exc


def github_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def vercel_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def render_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def github_create_pr(values: dict[str, str], base: str, head: str, title: str, body: str) -> None:
    repo = values["GITHUB_REPO"]
    payload = {"title": title, "head": head, "base": base, "body": body}
    data = request_json(
        "POST",
        f"https://api.github.com/repos/{repo}/pulls",
        headers=github_headers(values["GITHUB_TOKEN"]),
        payload=payload,
    )
    print(json.dumps({"number": data["number"], "url": data["html_url"]}, ensure_ascii=False, indent=2))


def github_merge_pr(values: dict[str, str], pr_number: int, commit_title: str | None) -> None:
    repo = values["GITHUB_REPO"]
    payload: dict[str, Any] = {"merge_method": "merge"}
    if commit_title:
        payload["commit_title"] = commit_title
    data = request_json(
        "PUT",
        f"https://api.github.com/repos/{repo}/pulls/{pr_number}/merge",
        headers=github_headers(values["GITHUB_TOKEN"]),
        payload=payload,
    )
    print(json.dumps(data, ensure_ascii=False, indent=2))


def render_trigger_deploy(values: dict[str, str]) -> None:
    service_id = values["RENDER_SERVICE_ID"]
    data = request_json(
        "POST",
        f"https://api.render.com/v1/services/{service_id}/deploys",
        headers=render_headers(values["RENDER_API_KEY"]),
        payload={"clearCache": "do_not_clear"},
    )
    print(json.dumps(data, ensure_ascii=False, indent=2))


def render_service(values: dict[str, str]) -> None:
    service_id = values["RENDER_SERVICE_ID"]
    data = request_json(
        "GET",
        f"https://api.render.com/v1/services/{service_id}",
        headers=render_headers(values["RENDER_API_KEY"]),
    )
    print(json.dumps(data, ensure_ascii=False, indent=2))


def vercel_project(values: dict[str, str]) -> dict[str, Any]:
    project_name = urllib.parse.quote(values["VERCEL_PROJECT_NAME"])
    return request_json(
        "GET",
        f"https://api.vercel.com/v9/projects/{project_name}",
        headers=vercel_headers(values["VERCEL_TOKEN"]),
    )


def vercel_list_deployments(values: dict[str, str], limit: int) -> None:
    project = vercel_project(values)
    project_id = project["id"]
    params = urllib.parse.urlencode({"projectId": project_id, "limit": limit})
    data = request_json(
        "GET",
        f"https://api.vercel.com/v6/deployments?{params}",
        headers=vercel_headers(values["VERCEL_TOKEN"]),
    )
    print(json.dumps(data, ensure_ascii=False, indent=2))


def vercel_promote_target(values: dict[str, str], target: str) -> None:
    project = vercel_project(values)
    project_id = project["id"]
    payload = {"name": values["VERCEL_PROJECT_NAME"], "target": target}
    data = request_json(
        "POST",
        f"https://api.vercel.com/v13/deployments?projectId={project_id}",
        headers=vercel_headers(values["VERCEL_TOKEN"]),
        payload=payload,
    )
    print(json.dumps(data, ensure_ascii=False, indent=2))


def main() -> int:
    parser = argparse.ArgumentParser(description="Deployment helpers for cal_Biomass.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    pr_create = subparsers.add_parser("create-pr")
    pr_create.add_argument("--base", default="main")
    pr_create.add_argument("--head", required=True)
    pr_create.add_argument("--title", required=True)
    pr_create.add_argument("--body", default="")

    pr_merge = subparsers.add_parser("merge-pr")
    pr_merge.add_argument("--number", type=int, required=True)
    pr_merge.add_argument("--commit-title")

    subparsers.add_parser("render-service")
    subparsers.add_parser("render-deploy")

    vercel_deployments = subparsers.add_parser("vercel-deployments")
    vercel_deployments.add_argument("--limit", type=int, default=5)

    vercel_redeploy = subparsers.add_parser("vercel-redeploy")
    vercel_redeploy.add_argument("--target", default="production")

    args = parser.parse_args()

    try:
        values = load_env_file(TOKENS_FILE)

        if args.command in {"create-pr", "merge-pr"}:
            require_keys(values, ["GITHUB_TOKEN", "GITHUB_REPO"])
        if args.command in {"render-service", "render-deploy"}:
            require_keys(values, ["RENDER_API_KEY", "RENDER_SERVICE_ID"])
        if args.command in {"vercel-deployments", "vercel-redeploy"}:
            require_keys(values, ["VERCEL_TOKEN", "VERCEL_PROJECT_NAME"])

        if args.command == "create-pr":
            github_create_pr(values, args.base, args.head, args.title, args.body)
        elif args.command == "merge-pr":
            github_merge_pr(values, args.number, args.commit_title)
        elif args.command == "render-service":
            render_service(values)
        elif args.command == "render-deploy":
            render_trigger_deploy(values)
        elif args.command == "vercel-deployments":
            vercel_list_deployments(values, args.limit)
        elif args.command == "vercel-redeploy":
            vercel_promote_target(values, args.target)
        else:
            parser.error(f"Unknown command: {args.command}")
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
