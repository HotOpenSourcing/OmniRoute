import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "scratch" / "windsurf_assignmodel_doe.py"
spec = importlib.util.spec_from_file_location("windsurf_assignmodel_doe", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


class AssignModelDoeRunnerTests(unittest.TestCase):
    def test_run_scenario_preserves_response_observability_and_time_bins(self):
        runner = module.DoeRunner.__new__(module.DoeRunner)
        runner.base_env = {
            "WINDSURF_ASSIGN_MODEL_ROUTER_UID": "adaptive",
            "WINDSURF_ASSIGN_MODEL_VARIANT": "router-cascade-prompt",
            "WINDSURF_CHAT_BASE_URL": "https://server.codeium.com",
        }
        runner.token_source = {"token": "test-token", "source": "env:test"}

        class Probe:
            @staticmethod
            def build_assign_model_probe_request(_token):
                return object(), {"timestampUtc": "2026-05-02T12:34:56+00:00"}

            @staticmethod
            def run_request(_request):
                return 0, {
                    "status": 200,
                    "bodyHex": "00",
                    "responseObservability": {
                        "instanceHints": {
                            "x-request-id": "req-123",
                            "trace-id": None,
                            "server-timing": "edge;dur=12",
                            "alt-svc": None,
                            "server": None,
                        },
                        "responseHeaders": {
                            "x-request-id": "req-123",
                            "server-timing": "edge;dur=12",
                        },
                    },
                }

            @staticmethod
            def decode_assign_model_response(_body):
                return {
                    "assignment": {
                        "assignmentJwt": "jwt-123",
                        "assignedModelUid": "kimi-k2-5",
                        "harnessUid": "strawberry-pancake",
                        "modelRouterUid": None,
                    }
                }

        runner.probe = Probe()
        runner._scenario_env = lambda scenario: {}

        row = runner._run_scenario(
            module.Scenario(
                name="burst-1",
                prompt_text="hello",
                cascade_id="c-1",
                message_id="m-1",
            )
        )

        self.assertEqual(row["responseObservability"]["instanceHints"]["x-request-id"], "req-123")
        self.assertEqual(row["timeBin10s"], "2026-05-02T12:34:50+00:00")
        self.assertEqual(row["timeBin30s"], "2026-05-02T12:34:30+00:00")

    def test_run_scenario_keeps_existing_routing_and_jwt_fields(self):
        runner = module.DoeRunner.__new__(module.DoeRunner)
        runner.base_env = {
            "WINDSURF_ASSIGN_MODEL_ROUTER_UID": "adaptive",
            "WINDSURF_ASSIGN_MODEL_VARIANT": "router-cascade-prompt",
            "WINDSURF_CHAT_BASE_URL": "https://server.codeium.com",
        }
        runner.token_source = {"token": "test-token", "source": "env:test"}

        class Probe:
            @staticmethod
            def build_assign_model_probe_request(_token):
                return object(), {"timestampUtc": "2026-05-02T12:34:56+00:00"}

            @staticmethod
            def run_request(_request):
                return 0, {"status": 200, "bodyHex": "00"}

            @staticmethod
            def decode_assign_model_response(_body):
                return {
                    "assignment": {
                        "assignmentJwt": "jwt-123",
                        "assignedModelUid": "MODEL_SWE_1_5",
                        "harnessUid": "swe-1p5",
                        "modelRouterUid": None,
                    }
                }

        runner.probe = Probe()
        runner._scenario_env = lambda scenario: {}

        row = runner._run_scenario(
            module.Scenario(
                name="burst-2",
                prompt_text="hello",
                cascade_id="c-2",
                message_id="m-2",
            )
        )

        self.assertEqual(row["assignedModelUid"], "MODEL_SWE_1_5")
        self.assertEqual(row["harnessUid"], "swe-1p5")
        self.assertIsNotNone(row["assignmentJwtSha256_16"])

    def test_build_split_stream_test_tags_runs_with_stream_labels(self):
        runner = module.DoeRunner.__new__(module.DoeRunner)
        calls = []

        def fake_run_scenario(scenario):
            calls.append((scenario.name, scenario.message_id))
            return {
                "name": scenario.name,
                "messageId": scenario.message_id,
                "streamLabel": scenario.name.split("-")[0].upper(),
                "assignedModelUid": "kimi-k2-5",
                "harnessUid": "strawberry-pancake",
            }

        runner._run_scenario = fake_run_scenario

        result = runner._build_split_stream_test()

        self.assertEqual(result["test"], "split-stream")
        self.assertEqual([run["streamLabel"] for run in result["runs"]], ["A", "B", "A", "B"])
        self.assertEqual(len(calls), 4)

    def test_build_washout_test_groups_pre_pause_and_post_pause_runs(self):
        runner = module.DoeRunner.__new__(module.DoeRunner)
        calls = []

        def fake_run_scenario(scenario):
            calls.append(scenario.name)
            return {
                "name": scenario.name,
                "assignedModelUid": "kimi-k2-5",
                "harnessUid": "strawberry-pancake",
            }

        runner._run_scenario = fake_run_scenario

        original_sleep = module.time.sleep
        module.time.sleep = lambda seconds: None
        try:
            result = runner._build_washout_test()
        finally:
            module.time.sleep = original_sleep

        self.assertEqual(result["test"], "washout-reburst")
        self.assertEqual([run["name"] for run in result["prePauseRuns"]], ["pre-1", "pre-2"])
        self.assertEqual([run["name"] for run in result["postPauseRuns"]], ["post-1", "post-2"])
        self.assertEqual(len(calls), 4)


if __name__ == "__main__":
    unittest.main()
