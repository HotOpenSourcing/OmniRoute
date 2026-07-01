#!/usr/bin/env python3
import hashlib
import importlib.util
import json
import os
import pathlib
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[2]
PROBE_PATH = ROOT / "scripts" / "windsurf_direct_probe.py"
DEFAULT_TOKEN_ARTIFACT = ROOT / "tmp_assign_followup_20260430.json"
DEFAULT_BASE_URL = "https://server.codeium.com"
DEFAULT_PROMPT_A = "hello isolate baseline"
DEFAULT_PROMPT_B = "hello isolate changed"


@dataclass
class Scenario:
    name: str
    prompt_text: str
    cascade_id: str
    message_id: str
    session_id: str | None = None
    team_id: str | None = None
    user_id: str | None = None


class DoeRunner:
    def __init__(self) -> None:
        self.probe = self._load_probe_module()
        self.base_env = self._build_base_env()
        self.token_source = self._resolve_token_source()

    def _load_probe_module(self):
        spec = importlib.util.spec_from_file_location("windsurf_direct_probe", PROBE_PATH)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Unable to load probe module from {PROBE_PATH}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def _build_base_env(self) -> dict[str, str]:
        env = {
            "WINDSURF_CHAT_BASE_URL": os.environ.get("WINDSURF_CHAT_BASE_URL", DEFAULT_BASE_URL),
            "WINDSURF_PROBE_MODE": "assign-model",
            "WINDSURF_ASSIGN_MODEL_ROUTER_UID": os.environ.get(
                "WINDSURF_ASSIGN_MODEL_ROUTER_UID",
                "adaptive",
            ),
            "WINDSURF_ASSIGN_MODEL_VARIANT": os.environ.get(
                "WINDSURF_ASSIGN_MODEL_VARIANT",
                "router-cascade-prompt",
            ),
            "WINDSURF_IDE_NAME": os.environ.get("WINDSURF_IDE_NAME", "windsurf"),
            "WINDSURF_IDE_VERSION": os.environ.get("WINDSURF_IDE_VERSION", "1.108.2"),
            "WINDSURF_EXTENSION_NAME": os.environ.get("WINDSURF_EXTENSION_NAME", "windsurf"),
            "WINDSURF_EXTENSION_VERSION": os.environ.get(
                "WINDSURF_EXTENSION_VERSION",
                "1.108.2",
            ),
            "WINDSURF_LOCALE": os.environ.get("WINDSURF_LOCALE", "en"),
        }
        for key in ["WINDSURF_ASSIGN_MODEL_METHOD_NAME", "WINDSURF_CHAT_HOST_HEADER"]:
            value = os.environ.get(key)
            if value:
                env[key] = value
        return env

    def _resolve_token_source(self) -> dict[str, str]:
        direct_key = os.environ.get("WINDSURF_DIRECT_KEY", "").strip()
        if direct_key:
            return {"token": direct_key, "source": "env:WINDSURF_DIRECT_KEY"}

        artifact_path = pathlib.Path(
            os.environ.get("WINDSURF_DOE_TOKEN_ARTIFACT", str(DEFAULT_TOKEN_ARTIFACT))
        )
        if artifact_path.exists():
            payload = json.loads(artifact_path.read_text(encoding="utf-8"))
            token = (
                payload.get("requestPreview", {})
                .get("metadata", {})
                .get("apiKey", "")
                .strip()
            )
            if token:
                return {"token": token, "source": f"artifact:{artifact_path}"}

        raise RuntimeError(
            "No token available. Set WINDSURF_DIRECT_KEY or point WINDSURF_DOE_TOKEN_ARTIFACT at an artifact containing requestPreview.metadata.apiKey."
        )

    def _scenario_env(self, scenario: Scenario) -> dict[str, str]:
        env = dict(self.base_env)
        env["WINDSURF_DIRECT_KEY"] = self.token_source["token"]
        env["WINDSURF_ASSIGN_MODEL_PROMPT_TEXT"] = scenario.prompt_text
        env["WINDSURF_ASSIGN_MODEL_CASCADE_ID"] = scenario.cascade_id
        env["WINDSURF_ASSIGN_MODEL_MESSAGE_ID"] = scenario.message_id
        env["WINDSURF_CONVERSATION_ID"] = os.environ.get(
            "WINDSURF_DOE_CONVERSATION_ID",
            "doe-preview-fixed",
        )

        for key, value in {
            "WINDSURF_SESSION_ID": scenario.session_id,
            "WINDSURF_TEAM_ID": scenario.team_id,
            "WINDSURF_USER_ID": scenario.user_id,
        }.items():
            if value:
                env[key] = value

        return env

    def _build_input_fingerprint(self, scenario: Scenario) -> dict[str, Any]:
        payload = {
            "promptText": scenario.prompt_text,
            "cascadeId": scenario.cascade_id,
            "messageId": scenario.message_id,
            "sessionId": scenario.session_id,
            "teamId": scenario.team_id,
            "userId": scenario.user_id,
            "routerUid": self.base_env.get("WINDSURF_ASSIGN_MODEL_ROUTER_UID"),
            "variant": self.base_env.get("WINDSURF_ASSIGN_MODEL_VARIANT"),
            "baseUrl": self.base_env.get("WINDSURF_CHAT_BASE_URL"),
        }
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return {
            "sha256_16": hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16],
            "canonical": payload,
        }

    def _build_time_bins(self, timestamp_utc: str | None) -> dict[str, str | None]:
        if not timestamp_utc:
            return {"timeBin10s": None, "timeBin30s": None}
        dt = datetime.fromisoformat(timestamp_utc)
        dt_10 = dt.replace(second=(dt.second // 10) * 10, microsecond=0)
        dt_30 = dt.replace(second=(dt.second // 30) * 30, microsecond=0)
        return {
            "timeBin10s": dt_10.isoformat(),
            "timeBin30s": dt_30.isoformat(),
        }

    def _run_scenario(self, scenario: Scenario) -> dict[str, Any]:
        previous = dict(os.environ)
        try:
            scenario_env = self._scenario_env(scenario)
            os.environ.update(scenario_env)
            for key in ["WINDSURF_SESSION_ID", "WINDSURF_TEAM_ID", "WINDSURF_USER_ID"]:
                if key not in scenario_env:
                    os.environ.pop(key, None)
            request, preview = self.probe.build_assign_model_probe_request(self.token_source["token"])
            exit_code, result = self.probe.run_request(request)
        finally:
            os.environ.clear()
            os.environ.update(previous)

        request_timestamp = preview.get("timestampUtc")
        response_observability = result.get("responseObservability")
        row: dict[str, Any] = {
            "name": scenario.name,
            "promptText": scenario.prompt_text,
            "cascadeId": scenario.cascade_id,
            "messageId": scenario.message_id,
            "sessionId": scenario.session_id,
            "teamId": scenario.team_id,
            "userId": scenario.user_id,
            "inputFingerprint": self._build_input_fingerprint(scenario),
            "exitCode": exit_code,
            "status": result.get("status"),
            "requestTimestampUtc": request_timestamp,
            "responseObservability": response_observability,
            **self._build_time_bins(request_timestamp),
        }

        if exit_code == 0 and isinstance(result.get("bodyHex"), str):
            decoded = self.probe.decode_assign_model_response(bytes.fromhex(result["bodyHex"]))
            assignment = decoded.get("assignment") or {}
            jwt = assignment.get("assignmentJwt")
            row.update(
                {
                    "assignedModelUid": assignment.get("assignedModelUid"),
                    "harnessUid": assignment.get("harnessUid"),
                    "modelRouterUid": assignment.get("modelRouterUid"),
                    "assignmentJwtLength": len(jwt) if isinstance(jwt, str) else None,
                    "assignmentJwtSha256_16": hashlib.sha256(jwt.encode()).hexdigest()[:16]
                    if isinstance(jwt, str)
                    else None,
                }
            )
        else:
            row["error"] = {
                "status": result.get("status"),
                "reason": result.get("reason"),
                "error": result.get("error"),
                "message": result.get("message"),
                "body": result.get("body"),
            }
        return row

    def _compare_routing(self, label: str, first: dict[str, Any], second: dict[str, Any]) -> dict[str, Any]:
        return {
            "comparison": label,
            "sameAssignedModelUid": first.get("assignedModelUid") == second.get("assignedModelUid"),
            "sameHarnessUid": first.get("harnessUid") == second.get("harnessUid"),
            "sameRouting": (
                first.get("assignedModelUid") == second.get("assignedModelUid")
                and first.get("harnessUid") == second.get("harnessUid")
            ),
            "sameJwtHash": first.get("assignmentJwtSha256_16") == second.get("assignmentJwtSha256_16"),
            "sameJwtLength": first.get("assignmentJwtLength") == second.get("assignmentJwtLength"),
            "firstAssignedModelUid": first.get("assignedModelUid"),
            "secondAssignedModelUid": second.get("assignedModelUid"),
            "firstHarnessUid": first.get("harnessUid"),
            "secondHarnessUid": second.get("harnessUid"),
        }

    def _build_prompt_test(self) -> dict[str, Any]:
        fixed_cascade = os.environ.get("WINDSURF_DOE_PROMPT_BLOCK_CASCADE_ID", "doe-prompt-block")
        fixed_message = os.environ.get("WINDSURF_DOE_PROMPT_BLOCK_MESSAGE_ID", "doe-prompt-message")
        fixed_session = os.environ.get("WINDSURF_DOE_PROMPT_BLOCK_SESSION_ID", "") or None
        fixed_team = os.environ.get("WINDSURF_DOE_PROMPT_BLOCK_TEAM_ID", "") or None
        fixed_user = os.environ.get("WINDSURF_DOE_PROMPT_BLOCK_USER_ID", "") or None

        runs = [
            self._run_scenario(
                Scenario(
                    name="prompt-a",
                    prompt_text=os.environ.get("WINDSURF_DOE_PROMPT_A", DEFAULT_PROMPT_A),
                    cascade_id=fixed_cascade,
                    message_id=fixed_message,
                    session_id=fixed_session,
                    team_id=fixed_team,
                    user_id=fixed_user,
                )
            ),
            self._run_scenario(
                Scenario(
                    name="prompt-b",
                    prompt_text=os.environ.get("WINDSURF_DOE_PROMPT_B", DEFAULT_PROMPT_B),
                    cascade_id=fixed_cascade,
                    message_id=fixed_message,
                    session_id=fixed_session,
                    team_id=fixed_team,
                    user_id=fixed_user,
                )
            ),
        ]
        return {
            "test": "prompt-only",
            "purpose": "Measure routing decision sensitivity to promptText with execution context blocked as tightly as this probe allows.",
            "runs": runs,
            "comparison": self._compare_routing("prompt-only", runs[0], runs[1]),
        }

    def _build_repeat_test(self) -> dict[str, Any]:
        fixed_prompt = os.environ.get("WINDSURF_DOE_REPEAT_PROMPT", DEFAULT_PROMPT_A)
        fixed_cascade = os.environ.get("WINDSURF_DOE_REPEAT_BLOCK_CASCADE_ID", "doe-repeat-block")
        fixed_message = os.environ.get("WINDSURF_DOE_REPEAT_BLOCK_MESSAGE_ID", "doe-repeat-message")
        fixed_session = os.environ.get("WINDSURF_DOE_REPEAT_BLOCK_SESSION_ID", "") or None
        fixed_team = os.environ.get("WINDSURF_DOE_REPEAT_BLOCK_TEAM_ID", "") or None
        fixed_user = os.environ.get("WINDSURF_DOE_REPEAT_BLOCK_USER_ID", "") or None

        runs = [
            self._run_scenario(
                Scenario(
                    name="repeat-a",
                    prompt_text=fixed_prompt,
                    cascade_id=fixed_cascade,
                    message_id=fixed_message,
                    session_id=fixed_session,
                    team_id=fixed_team,
                    user_id=fixed_user,
                )
            ),
            self._run_scenario(
                Scenario(
                    name="repeat-b",
                    prompt_text=fixed_prompt,
                    cascade_id=fixed_cascade,
                    message_id=fixed_message,
                    session_id=fixed_session,
                    team_id=fixed_team,
                    user_id=fixed_user,
                )
            ),
        ]
        return {
            "test": "identical-repeat",
            "purpose": "Measure routing stability under repeated identical inputs and separate it from JWE minting noise.",
            "runs": runs,
            "comparison": self._compare_routing("identical-repeat", runs[0], runs[1]),
        }

    def _build_identity_test(self) -> dict[str, Any]:
        prompt_text = os.environ.get("WINDSURF_DOE_IDENTITY_PROMPT", DEFAULT_PROMPT_A)
        fixed_cascade = os.environ.get("WINDSURF_DOE_IDENTITY_BLOCK_CASCADE_ID", "doe-identity-block")
        fixed_message = os.environ.get("WINDSURF_DOE_IDENTITY_BLOCK_MESSAGE_ID", "doe-identity-message")
        fixed_session = os.environ.get("WINDSURF_DOE_IDENTITY_BLOCK_SESSION_ID", "") or None

        team_a = os.environ.get("WINDSURF_DOE_TEAM_ID_A", "").strip() or None
        team_b = os.environ.get("WINDSURF_DOE_TEAM_ID_B", "").strip() or None
        user_a = os.environ.get("WINDSURF_DOE_USER_ID_A", "").strip() or None
        user_b = os.environ.get("WINDSURF_DOE_USER_ID_B", "").strip() or None

        if team_a == team_b and user_a == user_b:
            return {
                "test": "identity-only",
                "purpose": "Measure routing bias from identity metadata when alternate values are provided.",
                "skipped": True,
                "reason": "Set WINDSURF_DOE_TEAM_ID_A/B and/or WINDSURF_DOE_USER_ID_A/B to run the identity bias test.",
            }

        runs = [
            self._run_scenario(
                Scenario(
                    name="identity-a",
                    prompt_text=prompt_text,
                    cascade_id=fixed_cascade,
                    message_id=fixed_message,
                    session_id=fixed_session,
                    team_id=team_a,
                    user_id=user_a,
                )
            ),
            self._run_scenario(
                Scenario(
                    name="identity-b",
                    prompt_text=prompt_text,
                    cascade_id=fixed_cascade,
                    message_id=fixed_message,
                    session_id=fixed_session,
                    team_id=team_b,
                    user_id=user_b,
                )
            ),
        ]
        return {
            "test": "identity-only",
            "purpose": "Measure routing sensitivity to identity metadata with prompt and blocked execution context held constant.",
            "runs": runs,
            "comparison": self._compare_routing("identity-only", runs[0], runs[1]),
        }

    def _build_temporal_test(self) -> dict[str, Any]:
        prompt_text = os.environ.get("WINDSURF_DOE_TEMPORAL_PROMPT", DEFAULT_PROMPT_A)
        fixed_cascade = os.environ.get("WINDSURF_DOE_TEMPORAL_BLOCK_CASCADE_ID", "doe-temporal-block")
        fixed_message = os.environ.get("WINDSURF_DOE_TEMPORAL_BLOCK_MESSAGE_ID", "doe-temporal-message")
        fixed_session = os.environ.get("WINDSURF_DOE_TEMPORAL_BLOCK_SESSION_ID", "") or None
        fixed_team = os.environ.get("WINDSURF_DOE_TEMPORAL_BLOCK_TEAM_ID", "") or None
        fixed_user = os.environ.get("WINDSURF_DOE_TEMPORAL_BLOCK_USER_ID", "") or None
        sleep_seconds = float(os.environ.get("WINDSURF_DOE_TEMPORAL_SLEEP_SECONDS", "0"))
        run_count = max(2, int(os.environ.get("WINDSURF_DOE_TEMPORAL_RUN_COUNT", "3")))

        runs: list[dict[str, Any]] = []
        for index in range(run_count):
            if index > 0 and sleep_seconds > 0:
                time.sleep(sleep_seconds)
            runs.append(
                self._run_scenario(
                    Scenario(
                        name=f"temporal-{index + 1}",
                        prompt_text=prompt_text,
                        cascade_id=fixed_cascade,
                        message_id=fixed_message,
                        session_id=fixed_session,
                        team_id=fixed_team,
                        user_id=fixed_user,
                    )
                )
            )

        routing_pairs = [
            self._compare_routing(
                f"temporal-{index}-vs-{index + 1}",
                runs[index - 1],
                runs[index],
            )
            for index in range(1, len(runs))
        ]
        routing_stable = all(pair["sameRouting"] for pair in routing_pairs)

        return {
            "test": "temporal-stability",
            "purpose": "Measure routing stability across time with identical inputs to detect non-stationarity separately from cryptographic minting noise.",
            "sleepSecondsBetweenRuns": sleep_seconds,
            "runCount": run_count,
            "runs": runs,
            "comparisons": routing_pairs,
            "routingStableAcrossTime": routing_stable,
        }

    def _build_burst_test(self) -> dict[str, Any]:
        prompt_text = os.environ.get("WINDSURF_DOE_BURST_PROMPT", DEFAULT_PROMPT_A)
        fixed_cascade = os.environ.get("WINDSURF_DOE_BURST_BLOCK_CASCADE_ID", "doe-burst-block")
        fixed_message = os.environ.get("WINDSURF_DOE_BURST_BLOCK_MESSAGE_ID", "doe-burst-message")
        fixed_session = os.environ.get("WINDSURF_DOE_BURST_BLOCK_SESSION_ID", "") or None
        fixed_team = os.environ.get("WINDSURF_DOE_BURST_BLOCK_TEAM_ID", "") or None
        fixed_user = os.environ.get("WINDSURF_DOE_BURST_BLOCK_USER_ID", "") or None
        run_count = max(2, int(os.environ.get("WINDSURF_DOE_BURST_RUN_COUNT", "10")))

        runs: list[dict[str, Any]] = []
        for index in range(run_count):
            runs.append(
                self._run_scenario(
                    Scenario(
                        name=f"burst-{index + 1}",
                        prompt_text=prompt_text,
                        cascade_id=fixed_cascade,
                        message_id=fixed_message,
                        session_id=fixed_session,
                        team_id=fixed_team,
                        user_id=fixed_user,
                    )
                )
            )

        assigned_models = [run.get("assignedModelUid") for run in runs]
        harnesses = [run.get("harnessUid") for run in runs]
        jwt_hashes = [run.get("assignmentJwtSha256_16") for run in runs]
        unique_model_pairs = sorted(
            {
                json.dumps(
                    {
                        "assignedModelUid": run.get("assignedModelUid"),
                        "harnessUid": run.get("harnessUid"),
                    },
                    sort_keys=True,
                )
                for run in runs
            }
        )
        timeline = [
            {
                "name": run["name"],
                "requestTimestampUtc": run.get("requestTimestampUtc"),
                "assignedModelUid": run.get("assignedModelUid"),
                "harnessUid": run.get("harnessUid"),
                "assignmentJwtSha256_16": run.get("assignmentJwtSha256_16"),
                "inputFingerprintSha256_16": (run.get("inputFingerprint") or {}).get("sha256_16"),
            }
            for run in runs
        ]

        return {
            "test": "burst-stationarity",
            "purpose": "Run a burst of identical requests to prove input constancy, measure routing stability, and document non-stationarity without attributing it to a specific latent cause.",
            "runCount": run_count,
            "runs": runs,
            "inputFingerprintSha256_16": (runs[0].get("inputFingerprint") or {}).get("sha256_16") if runs else None,
            "routingStableAcrossBurst": len(set((model, harness) for model, harness in zip(assigned_models, harnesses))) == 1,
            "uniqueRoutingOutcomes": [json.loads(item) for item in unique_model_pairs],
            "uniqueRoutingOutcomeCount": len(unique_model_pairs),
            "uniqueJwtHashCount": len({value for value in jwt_hashes if value is not None}),
            "timeline": timeline,
        }

    def _build_split_stream_test(self) -> dict[str, Any]:
        prompt_text = os.environ.get("WINDSURF_DOE_SPLIT_STREAM_PROMPT", DEFAULT_PROMPT_A)
        fixed_cascade = os.environ.get("WINDSURF_DOE_SPLIT_STREAM_BLOCK_CASCADE_ID", "doe-split-stream-block")
        fixed_session = os.environ.get("WINDSURF_DOE_SPLIT_STREAM_BLOCK_SESSION_ID", "") or None
        fixed_team = os.environ.get("WINDSURF_DOE_SPLIT_STREAM_BLOCK_TEAM_ID", "") or None
        fixed_user = os.environ.get("WINDSURF_DOE_SPLIT_STREAM_BLOCK_USER_ID", "") or None
        pair_count = max(2, int(os.environ.get("WINDSURF_DOE_SPLIT_STREAM_PAIR_COUNT", "2")))

        runs: list[dict[str, Any]] = []
        for index in range(pair_count):
            for stream_label in ("A", "B"):
                scenario = Scenario(
                    name=f"{stream_label.lower()}-{index + 1}",
                    prompt_text=prompt_text,
                    cascade_id=fixed_cascade,
                    message_id=f"split-{stream_label.lower()}-{index + 1}",
                    session_id=fixed_session,
                    team_id=fixed_team,
                    user_id=fixed_user,
                )
                run = self._run_scenario(scenario)
                run["streamLabel"] = stream_label
                runs.append(run)

        return {
            "test": "split-stream",
            "purpose": "Compare two parallel logical streams with the same visible inputs to detect hidden affinity or stream-level stickiness.",
            "pairCount": pair_count,
            "runs": runs,
        }

    def _build_washout_test(self) -> dict[str, Any]:
        prompt_text = os.environ.get("WINDSURF_DOE_WASHOUT_PROMPT", DEFAULT_PROMPT_A)
        fixed_cascade = os.environ.get("WINDSURF_DOE_WASHOUT_BLOCK_CASCADE_ID", "doe-washout-block")
        fixed_session = os.environ.get("WINDSURF_DOE_WASHOUT_BLOCK_SESSION_ID", "") or None
        fixed_team = os.environ.get("WINDSURF_DOE_WASHOUT_BLOCK_TEAM_ID", "") or None
        fixed_user = os.environ.get("WINDSURF_DOE_WASHOUT_BLOCK_USER_ID", "") or None
        run_count = max(2, int(os.environ.get("WINDSURF_DOE_WASHOUT_RUN_COUNT", "2")))
        pause_seconds = float(os.environ.get("WINDSURF_DOE_WASHOUT_PAUSE_SECONDS", "30"))

        pre_pause_runs: list[dict[str, Any]] = []
        post_pause_runs: list[dict[str, Any]] = []

        for index in range(run_count):
            pre_pause_runs.append(
                self._run_scenario(
                    Scenario(
                        name=f"pre-{index + 1}",
                        prompt_text=prompt_text,
                        cascade_id=fixed_cascade,
                        message_id=f"washout-pre-{index + 1}",
                        session_id=fixed_session,
                        team_id=fixed_team,
                        user_id=fixed_user,
                    )
                )
            )

        if pause_seconds > 0:
            time.sleep(pause_seconds)

        for index in range(run_count):
            post_pause_runs.append(
                self._run_scenario(
                    Scenario(
                        name=f"post-{index + 1}",
                        prompt_text=prompt_text,
                        cascade_id=fixed_cascade,
                        message_id=f"washout-post-{index + 1}",
                        session_id=fixed_session,
                        team_id=fixed_team,
                        user_id=fixed_user,
                    )
                )
            )

        return {
            "test": "washout-reburst",
            "purpose": "Compare pre-pause and post-pause routing behavior under the same visible inputs to detect short-lived persistence.",
            "pauseSeconds": pause_seconds,
            "prePauseRuns": pre_pause_runs,
            "postPauseRuns": post_pause_runs,
        }

    def run(self) -> dict[str, Any]:
        tests = [
            self._build_prompt_test(),
            self._build_repeat_test(),
            self._build_temporal_test(),
            self._build_burst_test(),
            self._build_split_stream_test(),
            self._build_washout_test(),
            self._build_identity_test(),
        ]
        return {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "script": str(pathlib.Path(__file__).resolve()),
            "probeModule": str(PROBE_PATH),
            "tokenSource": self.token_source["source"],
            "baseUrl": self.base_env["WINDSURF_CHAT_BASE_URL"],
            "routingMetrics": ["assignedModelUid", "harnessUid"],
            "cryptoMetrics": ["assignmentJwtLength", "assignmentJwtSha256_16"],
            "notes": [
                "cascadeId is treated as a blocked run identifier in this runner, not as a primary causal factor.",
                "assignmentJwt metrics are emitted only to document minting noise and cryptographic side-effects.",
            ],
            "tests": tests,
        }


def main() -> int:
    result = DoeRunner().run()
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
