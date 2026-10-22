"""Local-only rollback checks for verify_worker.sql; requires prepared local roles.

Run: python3 supabase/admin/test_worker_verifier.py /path/to/docker
No connection secrets are read or emitted; each drift is rolled back on disconnect.
"""
from pathlib import Path
import subprocess
import sys

SQL = Path(__file__).with_name("verify_worker.sql").read_text()
COMMAND = [sys.argv[1] if len(sys.argv) > 1 else "docker", "exec", "-i",
           "supabase_db_atelier-aurelia-studio", "psql", "-U", "postgres",
           "-d", "postgres", "-v", "ON_ERROR_STOP=1"]
CASES = [
    ("table access", "grant select on public.products to atelier_worker;",
     "direct application/Auth table privileges"),
    ("login table access", "grant select on auth.users to atelier_worker_login;",
     "direct application/Auth table privileges"),
    ("schema create", "grant create on schema public to atelier_worker;",
     "must not create application objects"),
    ("database create", "grant create on database postgres to atelier_worker_login;",
     "must not own application functions/schemas or create schemas"),
    ("role bypass", "alter role atelier_worker_login bypassrls;", "unsafe role attributes"),
    ("membership admin", "grant atelier_worker to atelier_worker_login with admin true;",
     "membership is missing or excessive"),
    ("membership inherit", "grant atelier_worker to atelier_worker_login with inherit true;",
     "membership is missing or excessive"),
    ("membership set", "grant atelier_worker to atelier_worker_login with set false;",
     "membership is missing or excessive"),
    ("function ownership", "grant atelier_worker to postgres; grant create on schema private to atelier_worker; "
     "alter function private.worker_claim_outbox(uuid) owner to atelier_worker;",
     "must not own application functions/schemas or create schemas"),
    ("missing RPC", "revoke execute on function private.worker_claim_outbox(uuid) from atelier_worker;",
     "Worker RPC grant is missing"),
]


def run(sql):
    return subprocess.run(COMMAND, input=sql, text=True, capture_output=True, check=False)


baseline = run(SQL)
if baseline.returncode:
    raise SystemExit("Baseline verification failed: " + baseline.stderr)
for name, mutation, expected in CASES:
    result = run(SQL.replace("begin read only;", "begin;\n" + mutation, 1))
    if result.returncode == 0 or expected not in result.stderr:
        raise SystemExit("Drift assertion failed for " + name + ": " + result.stderr)
    # The failed transaction is rolled back when psql disconnects.
    if run(SQL).returncode:
        raise SystemExit("Rollback verification failed after " + name)
    print("PASS " + name + " rejected; rollback verified")
print("PASS baseline and 10 privilege-drift cases")
