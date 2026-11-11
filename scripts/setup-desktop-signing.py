#!/usr/bin/env python3
"""Create one persistent local signing identity, isolated from login secrets.

Creating the identity changes no trust settings or TCC records. The separate
--trust-code-signing flag explicitly initializes current-user codeSign trust.
A dedicated keychain contains only this development key; its unlock secret is
owner-readable and never printed. Existing identities never rotate implicitly.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import secrets
import shlex
import ssl
import subprocess
import sys


def run(arguments, binary=False):
    result = subprocess.run(arguments, capture_output=True, text=not binary)
    if result.returncode:
        # Never include command arguments: security receives an unlock secret.
        detail = result.stderr.decode(errors='replace') if binary else result.stderr
        raise RuntimeError(Path(arguments[0]).name + ' failed: ' + detail.strip()[:400])
    return result.stdout


def write_private(path, content):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        output.write(content)


def create(directory):
    config = directory / 'identity.json'
    if config.exists():
        print('Existing signing identity retained; no certificate or key regenerated.')
        return json.loads(config.read_text())
    directory.mkdir(parents=True, exist_ok=True)
    directory.chmod(0o700)
    if any(directory.iterdir()):
        raise RuntimeError('Signing directory is nonempty without identity.json; inspect the existing identity rather than replacing it.')
    os.umask(0o077)
    password = secrets.token_urlsafe(36)
    password_file = directory / '.keychain-password'
    write_private(password_file, password + '\n')
    certificate = directory / 'tuotie-code-signing.pem'
    private_key = directory / 'pending-private-key.pem'
    archive = directory / 'pending-identity.p12'
    keychain = directory / 'TuotieCodeSigning.keychain-db'
    openssl_config = directory / 'certificate.cnf'
    write_private(openssl_config, '''[req]
prompt = no
distinguished_name = subject
x509_extensions = signing
[subject]
CN = Tuotie Local Code Signing
[signing]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
''')
    run(['/usr/bin/openssl', 'req', '-new', '-x509', '-newkey', 'rsa:3072', '-sha256', '-nodes', '-days', '3650', '-config', str(openssl_config), '-keyout', str(private_key), '-out', str(certificate)])
    run(['/usr/bin/openssl', 'pkcs12', '-export', '-name', 'Tuotie Local Code Signing', '-inkey', str(private_key), '-in', str(certificate), '-out', str(archive), '-passout', 'file:' + str(password_file)])
    original_search_list = shlex.split(run(['/usr/bin/security', 'list-keychains', '-d', 'user']))
    try:
        run(['/usr/bin/security', 'create-keychain', '-p', password, str(keychain)])
        run(['/usr/bin/security', 'unlock-keychain', '-p', password, str(keychain)])
        run(['/usr/bin/security', 'set-keychain-settings', '-l', '-u', '-t', '21600', str(keychain)])
        run(['/usr/bin/security', 'import', str(archive), '-k', str(keychain), '-P', password, '-T', '/usr/bin/codesign'])
        # This keychain contains exactly the newly created development key.
        # Never apply partition changes to login/system keychains.
        run(['/usr/bin/security', 'set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', password, str(keychain)])
    finally:
        run(['/usr/bin/security', 'list-keychains', '-d', 'user', '-s', *original_search_list])
    der = ssl.PEM_cert_to_DER_cert(certificate.read_text())
    identity = hashlib.sha1(der).hexdigest().upper()
    matches = run(['/usr/bin/security', 'find-identity', '-p', 'codesigning', str(keychain)])
    if identity not in matches:
        raise RuntimeError('The prepared key is not a matching code-signing identity; no identity configuration written.')
    value = {'identitySHA1': identity, 'keychainPath': str(keychain), 'keychainPasswordFile': str(password_file), 'certificatePath': str(certificate), 'certificateCommonName': 'Tuotie Local Code Signing', 'scope': 'local-development-code-signing-only', 'trustSettingsChanged': False}
    write_private(config, json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    private_key.unlink(); archive.unlink()
    keychain.chmod(0o600)
    print(json.dumps({'created': True, 'identitySHA1': identity, 'certificateCommonName': value['certificateCommonName'], 'keychainIsDedicated': True, 'searchListRestored': True, 'trustSettingsChanged': False, 'configuration': str(config)}, ensure_ascii=False))
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--create', action='store_true', help='Create the persistent development identity once; never rotate an existing certificate.')
    parser.add_argument('--trust-code-signing', action='store_true', help='Explicit one-time current-user trust for this certificate under the codeSign policy only. May require native authentication.')
    args = parser.parse_args()
    directory = Path.home() / 'Library/Application Support/Tuotie/signing'
    if args.create:
        value = create(directory)
    elif (directory / 'identity.json').exists():
        value = json.loads((directory / 'identity.json').read_text())
        print(json.dumps({'configured': True, 'identitySHA1': value['identitySHA1'], 'keychainIsDedicated': bool(value.get('keychainPath')), 'trustSettingsChanged': False}))
    else:
        print('No stable signing identity configured. Run with --create once, or configure an existing Developer ID with TUOTIE_CODESIGN_IDENTITY.')
        return 1
    if args.trust_code_signing:
        certificate = Path(value['certificatePath'])
        identity = hashlib.sha1(ssl.PEM_cert_to_DER_cert(certificate.read_text())).hexdigest().upper()
        if identity != value['identitySHA1']:
            raise RuntimeError('Certificate fingerprint differs from the pinned identity; no trust settings changed.')
        run(['/usr/bin/security', 'add-trusted-cert', '-r', 'trustRoot', '-p', 'codeSign', '-k', value['keychainPath'], str(certificate)])
        run(['/usr/bin/security', 'verify-cert', '-c', str(certificate), '-p', 'codeSign'])
        value['trustSettingsChanged'] = True
        value['trustPolicy'] = 'current-user-codeSign-only'
        (directory / 'identity.json').write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
        (directory / 'identity.json').chmod(0o600)
        print('Current-user codeSign trust configured for the pinned certificate; no SSL/system trust configured.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
