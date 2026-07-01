import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).resolve().parents[2] / "tmp_windsurf_runtime_liveness_watch_20260502.py"
spec = importlib.util.spec_from_file_location("windsurf_runtime_liveness_watch", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


class WindsurfRuntimeLivenessWatchTests(unittest.TestCase):
    def test_build_output_prefers_ls_parent_linked_runtime_tuple(self):
        snap = {
            "runtime": {
                "ls_pid": 15288,
                "ls_port": 59602,
                "ext_port": 59599,
                "session_log": "C:/fake/Windsurf.log",
                "last_termination": None,
            },
            "ls_process": {
                "ProcessId": 15288,
                "ParentProcessId": 4444,
                "Name": "language_server_windows_x64.exe",
                "CreationDate": "/Date(1777730890300)/",
            },
            "ls_listener": [
                {
                    "LocalAddress": "127.0.0.1",
                    "LocalPort": 59602,
                    "OwningProcess": 15288,
                    "State": 2,
                }
            ],
            "ls_reachable": True,
            "node_services": [
                {"ProcessId": 32340, "ParentProcessId": 29276, "Name": "Windsurf.exe", "CreationDate": "a"},
                {"ProcessId": 24640, "ParentProcessId": 29276, "Name": "Windsurf.exe", "CreationDate": "b"},
                {"ProcessId": 4444, "ParentProcessId": 29276, "Name": "Windsurf.exe", "CreationDate": "c"},
                {"ProcessId": 30240, "ParentProcessId": 29276, "Name": "Windsurf.exe", "CreationDate": "d"},
            ],
            "exthosts": [
                {"ProcessId": 16404, "ParentProcessId": 29276, "Name": "Windsurf.exe", "CreationDate": "a"},
                {"ProcessId": 17404, "ParentProcessId": 29276, "Name": "Windsurf.exe", "CreationDate": "b"},
                {"ProcessId": 15456, "ParentProcessId": 29276, "Name": "Windsurf.exe", "CreationDate": "c"},
                {"ProcessId": 15068, "ParentProcessId": 29276, "Name": "Windsurf.exe", "CreationDate": "d"},
                {"ProcessId": 32340, "ParentProcessId": 29276, "Name": "Windsurf.exe", "CreationDate": "e"},
                {"ProcessId": 24640, "ParentProcessId": 29276, "Name": "Windsurf.exe", "CreationDate": "f"},
                {"ProcessId": 4444, "ParentProcessId": 29276, "Name": "Windsurf.exe", "CreationDate": "g"},
                {"ProcessId": 30240, "ParentProcessId": 29276, "Name": "Windsurf.exe", "CreationDate": "h"},
            ],
        }
        decision = {
            "runtime_status": "LIVE",
            "attach_allowed": True,
            "reason_if_blocked": None,
        }

        output = module.build_output(snap, decision)

        self.assertEqual(output["selected_pid_tuple"]["ls_pid"], 15288)
        self.assertEqual(output["selected_pid_tuple"]["node_service_pids"], [4444])
        self.assertEqual(output["selected_pid_tuple"]["extension_host_pids"], [4444])


if __name__ == "__main__":
    unittest.main()
