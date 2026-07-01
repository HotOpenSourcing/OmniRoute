import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "runtime_ls_state.py"
spec = importlib.util.spec_from_file_location("runtime_ls_state", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


class RuntimeLSRegistryTests(unittest.TestCase):
    def test_started_event_creates_pending_binding(self):
        registry = module.RuntimeLSRegistry()

        binding = registry.on_language_server_started(
            session_id="session-1",
            window_id="window-1",
            host="127.0.0.1",
            port=63565,
            lifecycle_nonce="nonce-1",
            timestamp=1714560000.0,
            csrf_token="csrf-1",
        )

        self.assertEqual(binding.state, "pending")
        self.assertEqual(binding.url, "http://127.0.0.1:63565")
        self.assertEqual(registry.get_current().lifecycle_nonce, "nonce-1")

    def test_confirm_marks_binding_confirmed(self):
        registry = module.RuntimeLSRegistry()
        binding = registry.on_language_server_started(
            session_id="session-1",
            window_id="window-1",
            host="127.0.0.1",
            port=63565,
            lifecycle_nonce="nonce-1",
            timestamp=1714560000.0,
            csrf_token=None,
        )

        confirmed = registry.confirm("nonce-1")

        self.assertEqual(confirmed.state, "confirmed")
        self.assertEqual(registry.get_current().state, "confirmed")
        self.assertEqual(confirmed.lifecycle_nonce, binding.lifecycle_nonce)

    def test_stopped_event_expires_binding_immediately(self):
        registry = module.RuntimeLSRegistry()
        registry.on_language_server_started(
            session_id="session-1",
            window_id="window-1",
            host="127.0.0.1",
            port=63565,
            lifecycle_nonce="nonce-1",
            timestamp=1714560000.0,
            csrf_token=None,
        )
        registry.confirm("nonce-1")

        expired = registry.on_language_server_stopped(
            session_id="session-1",
            window_id="window-1",
            lifecycle_nonce="nonce-1",
            timestamp=1714560010.0,
        )

        self.assertEqual(expired.state, "expired")
        self.assertIsNone(registry.get_current())

    def test_new_started_event_replaces_previous_binding(self):
        registry = module.RuntimeLSRegistry()
        first = registry.on_language_server_started(
            session_id="session-1",
            window_id="window-1",
            host="127.0.0.1",
            port=63565,
            lifecycle_nonce="nonce-1",
            timestamp=1714560000.0,
            csrf_token=None,
        )
        second = registry.on_language_server_started(
            session_id="session-1",
            window_id="window-1",
            host="127.0.0.1",
            port=63566,
            lifecycle_nonce="nonce-2",
            timestamp=1714560001.0,
            csrf_token=None,
        )

        self.assertEqual(first.state, "expired")
        self.assertEqual(second.state, "pending")
        self.assertEqual(registry.get_current().lifecycle_nonce, "nonce-2")


if __name__ == "__main__":
    unittest.main()
