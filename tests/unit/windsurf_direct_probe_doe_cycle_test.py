import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "windsurf_direct_probe.py"
spec = importlib.util.spec_from_file_location("windsurf_direct_probe", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


class DirectProbeDoeCycleTests(unittest.TestCase):
    def test_run_ls_emulator_cycle_normalizes_observation_and_keeps_start_audit(self):
        original_start_cascade = module.start_cascade
        original_send_user_cascade_message = module.send_user_cascade_message
        original_assign_model_probe = module.assign_model_probe

        def fake_start_cascade(_token, base_url=None):
            self.assertIsNone(base_url)
            return 0, None, {
                "metadata": {
                    "sessionId": "observed-123",
                    "sessionIdProvenance": "observed",
                }
            }, {
                "status": 200,
                "bodyText": "9f0df4db-7fd4-4f37-a7d6-6a8c8fe6f0a1",
                "structuredLog": {
                    "rpc_name": "StartCascade",
                    "rawBodyPreview": "9f0df4db-7fd4-4f37-a7d6-6a8c8fe6f0a1",
                    "extractedCascadeId": "9f0df4db-7fd4-4f37-a7d6-6a8c8fe6f0a1",
                    "cascadeIdSource": "bodyText-regex",
                },
            }

        def fake_send_user_cascade_message(_token, cascade_id):
            self.assertEqual(cascade_id, "9f0df4db-7fd4-4f37-a7d6-6a8c8fe6f0a1")
            return 0, None, {"cascadeId": cascade_id}, {
                "status": 200,
                "structuredLog": {"rpc_name": "SendUserCascadeMessage"},
            }

        def fake_assign_model_probe(_token):
            return 0, None, {"cascadeId": "9f0df4db-7fd4-4f37-a7d6-6a8c8fe6f0a1"}, {
                "status": 200,
                "decodedUnaryProto": {
                    "modelAssignmentInfo": {
                        "assignmentJwt": "jwt-123",
                        "assignedModelUid": "MODEL_SWE_1_5",
                        "harnessUid": "swe-1p5",
                    }
                },
                "structuredLog": {"rpc_name": "AssignModel"},
            }

        try:
            module.start_cascade = fake_start_cascade
            module.send_user_cascade_message = fake_send_user_cascade_message
            module.assign_model_probe = fake_assign_model_probe

            exit_code, payload = module.run_ls_emulator_cycle(
                "devin-session-token-123",
                prompt_text="hello",
                run_id="A",
            )

            self.assertEqual(exit_code, 0)
            self.assertEqual(
                payload["runObservation"],
                {
                    "run": "A",
                    "sessionProvenance": "observed",
                    "cascadeId": "9f0df4db-7fd4-4f37-a7d6-6a8c8fe6f0a1",
                    "assignedModelUid": "MODEL_SWE_1_5",
                    "harnessUid": "swe-1p5",
                    "jwtHash16": module.sha256_16("jwt-123"),
                },
            )
            self.assertEqual(
                payload["startCascade"]["structuredLog"]["cascadeIdSource"],
                "bodyText-regex",
            )
            self.assertEqual(
                payload["startCascade"]["structuredLog"]["extractedCascadeId"],
                "9f0df4db-7fd4-4f37-a7d6-6a8c8fe6f0a1",
            )
        finally:
            module.start_cascade = original_start_cascade
            module.send_user_cascade_message = original_send_user_cascade_message
            module.assign_model_probe = original_assign_model_probe


if __name__ == "__main__":
    unittest.main()
