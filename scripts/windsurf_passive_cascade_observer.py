from __future__ import annotations

import argparse
import base64
import json
import pathlib
import re
from copy import deepcopy
import os
from typing import Any

CASCADE_METHODS = {"StartCascade", "SendUserCascadeMessage"}
TRACE_EVENT_NAME = "TRACE_COUNT_DELTA"
WAITING_STATUS = {"status": "waiting", "reason": "no cascade emission detected", "events": []}
CURRENT_EPOCH_PATTERN = re.compile(r"(?:^|[\\/])logs[\\/](\d{8}T\d{6})(?:[\\/]|$)", re.IGNORECASE)
SYNTHETIC_PATH_MARKERS = (
    "\\tmp\\",
    "\\temp\\",
    "/tmp/",
    "/temp/",
    "\\tmp_",
    "/tmp_",
    "\\matrix\\",
    "/matrix/",
    "\\scratch\\",
    "/scratch/",
    "executive_summary.md",
    "integration_guide.md",
    "readme_auth_toolkit.md",
)


def read_jsonl_records(path: str | pathlib.Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    file_path = pathlib.Path(path)
    if not file_path.exists():
        return records
    for line in file_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            records.append(payload)
    return records


def _har_headers_to_dict(headers: list[dict[str, Any]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for header in headers:
        if not isinstance(header, dict):
            continue
        name = header.get("name")
        value = header.get("value")
        if isinstance(name, str) and isinstance(value, str):
            out[name] = value
    return out


def _build_fixed_line_window(lines: list[str], index: int, radius: int = 1) -> str:
    start = max(0, index - radius)
    end = min(len(lines), index + radius + 1)
    return "\n".join(lines[start:end])


def _extract_explicit_session_id(text: str) -> str | None:
    patterns = (
        r'"sessionId"\s*:\s*"([^"]+)"',
        r'"session_id"\s*:\s*"([^"]+)"',
        r"sessionId\s*[:=]\s*['\"]?([^'\"\s,]+)",
        r"session_id\s*[:=]\s*['\"]?([^'\"\s,]+)",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    return None


def _extract_session_id_from_plaintext_window(lines: list[str], index: int) -> str | None:
    # Try same-line explicit first
    same_line = lines[index]
    session_id = _extract_explicit_session_id(same_line)
    if session_id:
        return session_id

    # Collect adjacent explicit identities
    adjacent_explicit: set[str] = set()
    for offset in [-1, 1]:
        adj_index = index + offset
        if 0 <= adj_index < len(lines):
            adj_session = _extract_explicit_session_id(lines[adj_index])
            if adj_session:
                adjacent_explicit.add(adj_session)

    if len(adjacent_explicit) == 1:
        return next(iter(adjacent_explicit))
    if len(adjacent_explicit) > 1:
        return None  # Conflicting adjacent identities

    # Try same-line JWT
    session_id = extract_session_id_from_har_post_data_text(same_line)
    if session_id:
        return session_id

    # Collect adjacent JWT identities
    adjacent_jwt: set[str] = set()
    for offset in [-1, 1]:
        adj_index = index + offset
        if 0 <= adj_index < len(lines):
            adj_session = extract_session_id_from_har_post_data_text(lines[adj_index])
            if adj_session:
                adjacent_jwt.add(adj_session)

    if len(adjacent_jwt) == 1:
        return next(iter(adjacent_jwt))

    return None


BOOTSTRAP_LOG_PATTERNS = {
    "LS_START": re.compile(
        r"^(?P<date>\d{4}-\d{2}-\d{2})\s+(?P<time>\d{2}:\d{2}:\d{2}\.\d{3}).*?Starting language server process with pid (?P<pid>\d+)"
    ),
    "LS_PORT_BOUND": re.compile(
        r"^(?P<date>\d{4}-\d{2}-\d{2})\s+(?P<time>\d{2}:\d{2}:\d{2}\.\d{3}).*?Language server listening on random port at (?P<host>[^\s:]+):(?P<port>\d+)"
    ),
    "EXTENSION_SERVER_CLIENT_CREATED": re.compile(
        r"^(?P<date>\d{4}-\d{2}-\d{2})\s+(?P<time>\d{2}:\d{2}:\d{2}\.\d{3}).*?Created extension server client at port (?P<port>\d+)"
    ),
    "ACP_AGENT_REGISTERED": re.compile(
        r"^(?P<date>\d{4}-\d{2}-\d{2})\s+(?P<time>\d{2}:\d{2}:\d{2}\.\d{3}).*?Registering agent \"(?P<agent>[^\"]+)\""
    ),
    "SUBMIT_PROXIMATE_SIGNAL": re.compile(
        r"^(?P<date>\d{4}-\d{2}-\d{2})\s+(?P<time>\d{2}:\d{2}:\d{2}\.\d{3}).*?ExtensionService#_doActivateExtension codeium\.windsurf"
    ),
}


def read_plaintext_runtime_records(path: str | pathlib.Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    file_path = pathlib.Path(path)
    if not file_path.exists():
        return records

    lines = file_path.read_text(encoding="utf-8").splitlines()
    for line in lines:
        for event_type, pattern in BOOTSTRAP_LOG_PATTERNS.items():
            match = pattern.search(line)
            if not match:
                continue

            record: dict[str, Any] = {
                "event": "PlaintextRuntimeBootstrap",
                "type": event_type,
                "timestamp": f"{match.group('date')}T{match.group('time')}Z",
                "surface": "live_runtime_log",
                "metadata": {},
            }

            if event_type == "LS_START":
                record["metadata"]["pid"] = int(match.group("pid"))
            elif event_type == "LS_PORT_BOUND":
                record["metadata"]["host"] = match.group("host")
                record["metadata"]["port"] = int(match.group("port"))
            elif event_type == "EXTENSION_SERVER_CLIENT_CREATED":
                record["metadata"]["port"] = int(match.group("port"))
            elif event_type == "ACP_AGENT_REGISTERED":
                record["metadata"]["agent"] = match.group("agent")
            elif event_type == "SUBMIT_PROXIMATE_SIGNAL":
                record["metadata"]["reason"] = "codeium.windsurf extension activation"

            records.append(record)
            break

    return records


def read_plaintext_log_records(path: str | pathlib.Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    file_path = pathlib.Path(path)
    if not file_path.exists():
        return records

    pattern = re.compile(
        r"^(?P<date>\d{4}-\d{2}-\d{2})\s+(?P<time>\d{2}:\d{2}:\d{2}\.\d{3}).*?/(?P<service>exa\.language_server_pb\.LanguageServerService)/(?P<method>StartCascade|SendUserCascadeMessage)\b"
    )
    lines = file_path.read_text(encoding="utf-8").splitlines()
    for index, line in enumerate(lines):
        match = pattern.search(line)
        if not match:
            continue
        session_id = _extract_session_id_from_plaintext_window(lines, index)
        record = {
            "event": "PlaintextLogRpcCall",
            "timestamp": f"{match.group('date')}T{match.group('time')}Z",
            "surface": "live_runtime_log",
            "pid": None,
            "rpc": {
                "serviceTypeName": match.group("service"),
                "serviceMethodName": match.group("method"),
            },
        }
        if session_id:
            record["metadata"] = {
                "sessionId": session_id,
            }
        records.append(record)
    return records


def _decode_jwt_payload(token: str) -> dict[str, Any] | None:
    parts = token.split(".")
    if len(parts) < 2:
        return None
    payload = parts[1]
    padding = "=" * (-len(payload) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload + padding).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    parsed = json.loads(decoded)
    return parsed if isinstance(parsed, dict) else None


def extract_session_id_from_har_post_data_text(text: str | None) -> str | None:
    if not isinstance(text, str) or not text:
        return None
    match = re.search(r"devin-session-token\$([A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+)", text)
    if not match:
        return None
    payload = _decode_jwt_payload(match.group(1))
    if not isinstance(payload, dict):
        return None
    session_id = payload.get("session_id")
    return session_id if isinstance(session_id, str) else None


def read_har_records(path: str | pathlib.Path) -> list[dict[str, Any]]:
    file_path = pathlib.Path(path)
    if not file_path.exists():
        return []
    payload = json.loads(file_path.read_text(encoding="utf-8"))
    log = payload.get("log") if isinstance(payload, dict) else None
    entries = log.get("entries") if isinstance(log, dict) else None
    if not isinstance(entries, list):
        return []

    records: list[dict[str, Any]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        request = entry.get("request")
        if not isinstance(request, dict):
            continue
        url = request.get("url")
        if not isinstance(url, str):
            continue
        if "localhost" not in url and entry.get("serverIPAddress") != "127.0.0.1":
            continue

        headers = _har_headers_to_dict(request.get("headers", []))
        post_data = request.get("postData") if isinstance(request.get("postData"), dict) else {}
        post_data_text = post_data.get("text") if isinstance(post_data.get("text"), str) else None
        session_id = extract_session_id_from_har_post_data_text(post_data_text)
        records.append(
            {
                "event": "HarRequest",
                "timestamp": entry.get("startedDateTime"),
                "surface": "har",
                "pid": None,
                "rpc": {
                    "serviceMethodName": url.rsplit("/", 1)[-1],
                },
                "request": {
                    "url": url,
                    "metadata": {
                        "sessionId": session_id,
                    } if session_id else {},
                },
                "headers": headers,
                "csrfToken": headers.get("x-codeium-csrf-token") or headers.get("X-Codeium-Csrf-Token"),
            }
        )
    return records


def extract_service_method_name(record: dict[str, Any]) -> str | None:
    payload = record.get("payload")
    if isinstance(payload, dict):
        rpc = payload.get("rpc")
        if isinstance(rpc, dict) and isinstance(rpc.get("serviceMethodName"), str):
            return rpc["serviceMethodName"]
    rpc = record.get("rpc")
    if isinstance(rpc, dict) and isinstance(rpc.get("serviceMethodName"), str):
        return rpc["serviceMethodName"]
    structured_log = record.get("structuredLog")
    if isinstance(structured_log, dict) and isinstance(structured_log.get("rpc_name"), str):
        return structured_log["rpc_name"]
    request = record.get("request")
    if isinstance(request, dict) and isinstance(request.get("url"), str):
        url = request["url"]
        method = url.rsplit("/", 1)[-1]
        return method or None
    return None


def extract_session_id(record: dict[str, Any]) -> str | None:
    payload = record.get("payload")
    if isinstance(payload, dict):
        payload_value = payload.get("payload")
        if isinstance(payload_value, dict) and isinstance(payload_value.get("sessionId"), str):
            return payload_value["sessionId"]
        metadata = payload.get("metadata")
        if isinstance(metadata, dict) and isinstance(metadata.get("sessionId"), str):
            return metadata["sessionId"]
    nested_payload = record.get("payload")
    if isinstance(nested_payload, dict) and isinstance(nested_payload.get("sessionId"), str):
        return nested_payload["sessionId"]
    metadata = record.get("metadata")
    if isinstance(metadata, dict) and isinstance(metadata.get("sessionId"), str):
        return metadata["sessionId"]
    request = record.get("request")
    if isinstance(request, dict):
        metadata = request.get("metadata")
        if isinstance(metadata, dict) and isinstance(metadata.get("sessionId"), str):
            return metadata["sessionId"]
    return None


def extract_csrf_token(record: dict[str, Any]) -> str | None:
    for key in ("csrfToken", "csrf_token"):
        value = record.get(key)
        if isinstance(value, str):
            return value
    payload = record.get("payload")
    if isinstance(payload, dict):
        for key in ("csrfToken", "csrf_token"):
            value = payload.get(key)
            if isinstance(value, str):
                return value
        headers = payload.get("headers")
        if isinstance(headers, dict):
            for key in headers:
                if key.lower() == "x-codeium-csrf-token" and isinstance(headers[key], str):
                    return headers[key]
    headers = record.get("headers")
    if isinstance(headers, dict):
        for key in headers:
            if key.lower() == "x-codeium-csrf-token" and isinstance(headers[key], str):
                return headers[key]
    return None


def extract_trace_count_delta(record: dict[str, Any]) -> int:
    payload = record.get("payload")
    if isinstance(payload, dict):
        delta = payload.get("delta")
        if isinstance(delta, int):
            return delta
        if isinstance(delta, str) and delta.lstrip("-").isdigit():
            return int(delta)
    delta = record.get("delta")
    if isinstance(delta, int):
        return delta
    if isinstance(delta, str) and delta.lstrip("-").isdigit():
        return int(delta)
    return 0


def extract_timestamp(record: dict[str, Any]) -> str | None:
    for key in ("observed_at", "timestamp", "at"):
        value = record.get(key)
        if isinstance(value, str):
            return value
    return None


def classify_evidence_source(path: str | pathlib.Path) -> dict[str, str | None]:
    raw_path = str(path)
    normalized_path = raw_path.replace("/", "\\").replace("\\\\", "\\")
    normalized_path_lower = normalized_path.lower()
    epoch_match = CURRENT_EPOCH_PATTERN.search(normalized_path)

    if epoch_match:
        return {
            "kind": "live_runtime",
            "epoch": epoch_match.group(1),
            "reason": "path is under a Windsurf logs epoch directory",
        }

    if any(marker in normalized_path_lower for marker in SYNTHETIC_PATH_MARKERS):
        return {
            "kind": "synthetic_reference",
            "epoch": None,
            "reason": "path matches tmp/scratch/docs markers associated with replay, matrix, or reference artifacts",
        }

    return {
        "kind": "workspace_artifact",
        "epoch": None,
        "reason": "path is not under a live Windsurf logs epoch and does not match synthetic/reference markers",
    }



def normalize_observed_event(record: dict[str, Any], source_path: str | pathlib.Path) -> dict[str, Any] | None:
    event_name = record.get("event") if isinstance(record.get("event"), str) else None
    record_type = record.get("type") if isinstance(record.get("type"), str) else None
    method_name = extract_service_method_name(record)
    evidence_source = classify_evidence_source(source_path)

    if event_name == "PlaintextRuntimeBootstrap":
        event_type = record.get("type")
        if event_type not in ("LS_START", "LS_PORT_BOUND", "EXTENSION_SERVER_CLIENT_CREATED", "ACP_AGENT_REGISTERED"):
            return None
        return {
            "kind": "runtime_current",
            "type": event_type,
            "timestamp": record.get("timestamp"),
            "surface": record.get("surface"),
            "pid": None,
            "metadata": record.get("metadata", {}),
            "source_event": event_name,
            "source_path": str(source_path),
            "evidenceSource": evidence_source,
            "raw": deepcopy(record),
        }

    if method_name in CASCADE_METHODS:
        return {
            "kind": "rpc",
            "rpc": method_name,
            "timestamp": extract_timestamp(record),
            "surface": record.get("surface"),
            "pid": record.get("pid"),
            "sessionId": extract_session_id(record),
            "csrfToken": extract_csrf_token(record),
            "traceId": record.get("traceId") or (record.get("payload") or {}).get("traceId") if isinstance(record.get("payload"), dict) else None,
            "source_event": event_name or record_type,
            "source_path": str(source_path),
            "evidenceSource": evidence_source,
            "raw": deepcopy(record),
        }

    if record_type == TRACE_EVENT_NAME or event_name == TRACE_EVENT_NAME:
        delta = extract_trace_count_delta(record)
        return {
            "kind": "trace",
            "rpc": None,
            "timestamp": extract_timestamp(record),
            "surface": record.get("surface"),
            "pid": record.get("pid"),
            "sessionId": extract_session_id(record),
            "csrfToken": None,
            "traceId": record.get("traceId") or (record.get("payload") or {}).get("traceId") if isinstance(record.get("payload"), dict) else None,
            "source_event": event_name or record_type,
            "traceDelta": delta,
            "source_path": str(source_path),
            "evidenceSource": evidence_source,
            "raw": deepcopy(record),
        }

    return None


def correlate_observed_events(records: list[dict[str, Any]]) -> dict[str, Any]:
    observed_events: list[dict[str, Any]] = []
    runtime_current_events: list[dict[str, Any]] = []
    running_trace_count = 0
    pending_start_event: dict[str, Any] | None = None
    active_session_id: str | None = None
    evidence_summary: dict[str, dict[str, Any]] = {}

    for record in records:
        source_path = record.get("_observer_source_path")
        normalized = normalize_observed_event(record, source_path or "unknown")
        if normalized is None:
            continue

        evidence_source = normalized.get("evidenceSource") or {}
        evidence_kind = evidence_source.get("kind") if isinstance(evidence_source, dict) else None
        if isinstance(evidence_kind, str):
            summary = evidence_summary.setdefault(
                evidence_kind,
                {
                    "count": 0,
                    "paths": [],
                    "reasons": [],
                },
            )
            summary["count"] += 1
            source_path_value = normalized.get("source_path")
            if isinstance(source_path_value, str) and source_path_value not in summary["paths"]:
                summary["paths"].append(source_path_value)
            reason = evidence_source.get("reason")
            if isinstance(reason, str) and reason not in summary["reasons"]:
                summary["reasons"].append(reason)

        if normalized["kind"] == "runtime_current":
            runtime_current_events.append(
                {
                    "type": normalized["type"],
                    "timestamp": normalized["timestamp"],
                    "surface": normalized["surface"],
                    "pid": normalized["pid"],
                    "source": normalized["source_event"],
                    "sourcePath": normalized.get("source_path"),
                    "evidenceSource": normalized.get("evidenceSource"),
                    "metadata": normalized.get("metadata", {}),
                }
            )
            continue

        if normalized["kind"] == "trace":
            running_trace_count += normalized.get("traceDelta", 0)
            if observed_events:
                observed_events.append(
                    {
                        "type": "TRACE_COUNT_DELTA",
                        "timestamp": normalized["timestamp"],
                        "sessionId": normalized["sessionId"] or active_session_id,
                        "traceCount": running_trace_count,
                        "traceDelta": normalized.get("traceDelta", 0),
                        "surface": normalized["surface"],
                        "pid": normalized["pid"],
                        "source": normalized["source_event"],
                        "sourcePath": normalized.get("source_path"),
                        "evidenceSource": normalized.get("evidenceSource"),
                    }
                )
            continue

        rpc_name = normalized["rpc"]
        if rpc_name == "StartCascade":
            active_session_id = normalized["sessionId"] or active_session_id
            pending_start_event = {
                "type": "START_CASCADE",
                "timestamp": normalized["timestamp"],
                "sessionId": normalized["sessionId"],
                "csrfToken": normalized["csrfToken"],
                "traceCount": running_trace_count,
                "surface": normalized["surface"],
                "pid": normalized["pid"],
                "source": normalized["source_event"],
                "sourcePath": normalized.get("source_path"),
                "evidenceSource": normalized.get("evidenceSource"),
            }
            observed_events.append(pending_start_event)
            continue

        if rpc_name == "SendUserCascadeMessage":
            active_session_id = normalized["sessionId"] or active_session_id
            event = {
                "type": "SEND_USER_CASCADE_MESSAGE",
                "timestamp": normalized["timestamp"],
                "sessionId": normalized["sessionId"] or active_session_id,
                "csrfToken": normalized["csrfToken"],
                "traceCount": running_trace_count,
                "surface": normalized["surface"],
                "pid": normalized["pid"],
                "source": normalized["source_event"],
                "sourcePath": normalized.get("source_path"),
                "evidenceSource": normalized.get("evidenceSource"),
            }
            if pending_start_event is not None:
                event["precededBy"] = {
                    "type": pending_start_event["type"],
                    "timestamp": pending_start_event["timestamp"],
                    "sessionId": pending_start_event["sessionId"],
                }
            observed_events.append(event)
            continue

    all_events = runtime_current_events + observed_events

    if not all_events:
        waiting = deepcopy(WAITING_STATUS)
        waiting["evidenceSummary"] = evidence_summary
        return waiting

    if observed_events:
        return {
            "status": "observed",
            "events": all_events,
            "evidenceSummary": evidence_summary,
        }

    return {
        "status": "observed",
        "events": all_events,
        "evidenceSummary": evidence_summary,
    }


def _evidence_priority(path: str | pathlib.Path) -> tuple[int, str]:
    evidence = classify_evidence_source(path)
    kind = evidence.get("kind")
    epoch = evidence.get("epoch") if isinstance(evidence.get("epoch"), str) else ""
    if kind == "live_runtime":
        return (0, epoch)
    if kind == "workspace_artifact":
        return (1, "")
    return (2, "")


def prioritize_observer_paths(paths: list[str | pathlib.Path]) -> list[pathlib.Path]:
    unique_paths: list[pathlib.Path] = []
    seen: set[str] = set()
    for path in paths:
        normalized = str(pathlib.Path(path))
        if normalized in seen:
            continue
        seen.add(normalized)
        unique_paths.append(pathlib.Path(path))
    return sorted(unique_paths, key=lambda path: _evidence_priority(path))


def discover_live_runtime_paths() -> list[pathlib.Path]:
    appdata = os.environ.get("APPDATA")
    if not appdata:
        return []
    logs_root = pathlib.Path(appdata) / "Windsurf" / "logs"
    if not logs_root.exists():
        return []

    discovered: list[pathlib.Path] = []
    for epoch_dir in sorted(logs_root.iterdir(), reverse=True):
        if not epoch_dir.is_dir():
            continue
        if not CURRENT_EPOCH_PATTERN.search(str(epoch_dir)):
            continue
        for pattern in ("*.jsonl", "*.log"):
            for candidate in epoch_dir.rglob(pattern):
                discovered.append(candidate)
    return prioritize_observer_paths(discovered)


def observe_passive_cascade_from_jsonl(paths: list[str | pathlib.Path]) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    for path in prioritize_observer_paths(paths):
        file_path = pathlib.Path(path)
        suffix = file_path.suffix.lower()
        if suffix == ".har":
            path_records = read_har_records(file_path)
        elif suffix == ".log":
            # Check if this is a runtime bootstrap log or cascade RPC log
            if "Windsurf.log" in str(file_path) or "Windsurf ACP.log" in str(file_path):
                runtime_records = read_plaintext_runtime_records(file_path)
                cascade_records = read_plaintext_log_records(file_path)
                path_records = runtime_records + cascade_records
            else:
                path_records = read_plaintext_log_records(file_path)
        else:
            path_records = read_jsonl_records(file_path)
        for record in path_records:
            record["_observer_source_path"] = str(path)
        records.extend(path_records)
    return correlate_observed_events(records)


def observe_preferred_passive_cascade(paths: list[str | pathlib.Path] | None = None) -> dict[str, Any]:
    candidate_paths: list[pathlib.Path] = []
    candidate_paths.extend(discover_live_runtime_paths())
    if paths:
        candidate_paths.extend(pathlib.Path(path) for path in paths)
    return observe_passive_cascade_from_jsonl(candidate_paths)


def build_workspace_candidates() -> list[pathlib.Path]:
    workspace_candidates = [
        pathlib.Path("C:/Users/amine/OmniRoute/windsurf-model-runtime-capture.jsonl"),
        pathlib.Path("C:/Users/amine/OmniRoute/windsurf-auth-runtime-capture.jsonl"),
        pathlib.Path("C:/Users/amine/OmniRoute/windsurf-live-csrf-capture.jsonl"),
        pathlib.Path("C:/Users/amine/OmniRoute/fiddler/new.har"),
    ]
    return [path for path in workspace_candidates if path.exists()]


def build_debug_sources_report(paths: list[str | pathlib.Path] | None = None) -> dict[str, Any]:
    discovered_live = discover_live_runtime_paths()
    provided_paths = [pathlib.Path(path) for path in paths] if paths else []
    retained_paths = prioritize_observer_paths([*discovered_live, *provided_paths])

    return {
        "discoveredLiveRuntimePaths": [
            {
                "path": str(path),
                "classification": classify_evidence_source(path),
            }
            for path in discovered_live
        ],
        "providedPaths": [
            {
                "path": str(path),
                "classification": classify_evidence_source(path),
            }
            for path in provided_paths
        ],
        "retainedPaths": [
            {
                "path": str(path),
                "classification": classify_evidence_source(path),
            }
            for path in retained_paths
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--debug-sources", action="store_true")
    args = parser.parse_args()

    existing_candidates = build_workspace_candidates()
    if args.debug_sources:
        print(json.dumps(build_debug_sources_report(existing_candidates), indent=2))
        return

    snapshot = observe_preferred_passive_cascade(existing_candidates)
    print(json.dumps(snapshot, indent=2))


if __name__ == "__main__":
    main()
