import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('desktop_signing_setup', Path(__file__).resolve().parents[1] / 'scripts/setup-desktop-signing.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SigningSetupChecks(unittest.TestCase):
    def test_existing_certificate_is_retained_without_generation_or_keychain_calls(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            value = {'identitySHA1': 'A' * 40, 'certificatePath': '/already/configured.pem'}
            path = root / 'identity.json'; path.write_text(json.dumps(value))
            before = path.read_bytes()
            with patch.object(setup, 'run', side_effect=AssertionError('Existing identities must not rotate')), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(setup.create(root), value)
            self.assertEqual(path.read_bytes(), before)

    def test_partial_setup_is_preserved_instead_of_replacing_private_material(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            keychain = root / 'TuotieCodeSigning.keychain-db'; keychain.write_bytes(b'existing-keychain')
            with patch.object(setup, 'run', side_effect=AssertionError('Partial state must not be overwritten')):
                with self.assertRaisesRegex(RuntimeError, 'inspect the existing identity'):
                    setup.create(root)
            self.assertEqual(keychain.read_bytes(), b'existing-keychain')
            self.assertFalse((root / 'identity.json').exists())

    def test_generated_secret_file_is_owner_only_and_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'secret'
            setup.write_private(path, 'local-only')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                setup.write_private(path, 'replacement')
            self.assertEqual(path.read_text(), 'local-only')


if __name__ == '__main__':
    unittest.main()
